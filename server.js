// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install `express` and `ws`: npm install express ws
// 3. Install `mysql2`: npm install mysql2
// 4. Set up your MariaDB/MySQL database and environment variables.
// 5. Create the `master_players`, `sessions`, `games`, `game_players`, and `roles_config` tables using SQL.
// 6. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express'); 
const mysql = require('mysql2/promise'); 

const app = express(); 
app.use(express.json()); 

const SERVER_VERSION = "0.10.7"; 

// --- Database Connection Pool ---
let pool;
try {
    pool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 10000 
    });
    console.log("Attempting to connect to MariaDB...");
    pool.getConnection()
        .then(connection => {
            console.log("Successfully connected to MariaDB! Connection ID: " + connection.threadId);
            connection.release();
        })
        .catch(err => {
            console.error("Error establishing initial connection to MariaDB:", err.message);
        });
} catch (error) {
    console.error("Failed to create MariaDB connection pool:", error);
}

// --- In-Memory Data Store for Games (caches loaded games) ---
let gamesCache = {}; 

// This will eventually be replaced by roles_config table for game logic
const ALL_ROLES_SERVER = {
    VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
    WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
    SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
};

// --- Helper Functions ---
async function getMasterPlayerByNameDB(playerName) {
    if (!playerName || !pool) return null;
    try {
        const [rows] = await pool.execute('SELECT id, name FROM master_players WHERE LOWER(name) = LOWER(?)', [playerName.trim()]);
        return rows[0] || null;
    } catch (error) {
        console.error("Error fetching player by name from DB:", error);
        return null;
    }
}

function broadcastToGameClients(gameId, messageObject) {
    console.log("SERVER: Broadcasting to WS clients:", JSON.stringify(messageObject));
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const messageToSend = { ...messageObject, gameId: messageObject.gameId || gameId };
            client.send(JSON.stringify(messageToSend));
        }
    });
}


async function checkWinConditions(game) { 
    if (!game || !game.playersInGame || Object.keys(game.playersInGame).length === 0 || !game.playerOrder) {
        return null; 
    }
    const rolesAssigned = game.playerOrder.some(name => game.playersInGame[name] && game.playersInGame[name].roleDetails);
    if (!rolesAssigned && game.currentPhase !== 'setup' && game.currentPhase !== 'roles_assigned') {
        return null;
    }
    if (game.gameWinner && game.gameWinner.team) return game.gameWinner; 

    const alivePlayersWithRoles = game.playerOrder.filter(name => game.playersInGame[name] && game.playersInGame[name].status === 'alive' && game.playersInGame[name].roleDetails);
    
    if (alivePlayersWithRoles.length === 0 && rolesAssigned && game.currentPhase !== 'setup' && game.currentPhase !== 'roles_assigned') { 
         game.gameWinner = { team: "No One", reason: "All players eliminated." };
         game.currentPhase = 'finished';
         console.log("SERVER: Game " + game.gameId + " ended: All players eliminated. Broadcasting game_over.");
         broadcastToGameClients(game.gameId, {type: 'game_over', payload: { ...game.gameWinner, gameId: game.gameId} });
         if (pool) await pool.execute('UPDATE games SET current_phase = ?, game_winner_team = ?, game_winner_reason = ? WHERE game_id = ?', [game.currentPhase, game.gameWinner.team, game.gameWinner.reason, game.gameId]);
         return game.gameWinner;
    }
    
    const aliveWerewolves = alivePlayersWithRoles.filter(name => game.playersInGame[name].roleDetails.alignment === "Werewolf");
    const aliveNonWerewolves = alivePlayersWithRoles.filter(name => game.playersInGame[name].roleDetails.alignment !== "Werewolf");

    if (aliveWerewolves.length === 0 && aliveNonWerewolves.length > 0 && rolesAssigned) { 
        game.gameWinner = { team: "Village", reason: "All werewolves have been eliminated." };
        game.currentPhase = 'finished';
        console.log("SERVER: Game " + game.gameId + " ended: Village wins. Broadcasting game_over.");
        broadcastToGameClients(game.gameId, {type: 'game_over', payload: { ...game.gameWinner, gameId: game.gameId} });
        if (pool) await pool.execute('UPDATE games SET current_phase = ?, game_winner_team = ?, game_winner_reason = ? WHERE game_id = ?', [game.currentPhase, game.gameWinner.team, game.gameWinner.reason, game.gameId]);
        return game.gameWinner;
    }
    if (aliveWerewolves.length > 0 && aliveWerewolves.length >= aliveNonWerewolves.length && rolesAssigned) { 
        game.gameWinner = { team: "Werewolves", reason: "Werewolves have overwhelmed the village." };
        game.currentPhase = 'finished';
        console.log("SERVER: Game " + game.gameId + " ended: Werewolves win. Broadcasting game_over.");
        broadcastToGameClients(game.gameId, {type: 'game_over', payload: { ...game.gameWinner, gameId: game.gameId} });
        if (pool) await pool.execute('UPDATE games SET current_phase = ?, game_winner_team = ?, game_winner_reason = ? WHERE game_id = ?', [game.currentPhase, game.gameWinner.team, game.gameWinner.reason, game.gameId]);
        return game.gameWinner;
    }
    return null; 
}

async function fetchGameFromDB(gameId) { 
    if (!pool) { console.error("DB Pool not available in fetchGameFromDB"); return null; }
    try {
        const [gameRows] = await pool.execute('SELECT * FROM games WHERE game_id = ? AND is_archived = FALSE', [gameId]);
        if (gameRows.length === 0) return null;
        const gameDataFromDB = gameRows[0];
        
        const playerOrder = gameDataFromDB.player_order_json ? JSON.parse(gameDataFromDB.player_order_json) : [];
        const [playerDetailRows] = await pool.execute(
            'SELECT mp.id as player_id, gp.player_name, gp.role_name, gp.status, gp.role_team, gp.role_alignment FROM game_players gp JOIN master_players mp ON gp.player_id = mp.id WHERE gp.game_id = ?',
            [gameId]
        );
        const playersInGameFromDB = {};
        playerOrder.forEach(name => { 
            const pDetail = playerDetailRows.find(pdr => pdr.player_name === name);
            if (pDetail) {
                playersInGameFromDB[name] = {
                    id: pDetail.player_id, roleName: pDetail.role_name,
                    roleDetails: pDetail.role_name ? (ALL_ROLES_SERVER[Object.keys(ALL_ROLES_SERVER).find(key => ALL_ROLES_SERVER[key].name === pDetail.role_name)] || {name: pDetail.role_name, team: pDetail.role_team || 'Unknown', alignment: pDetail.role_alignment || 'Unknown', description: "Config missing."}) : null,
                    status: pDetail.status
                };
            }
        });
         playerDetailRows.forEach(p => { if (!playersInGameFromDB[p.player_name]) { playersInGameFromDB[p.player_name] = {id: p.player_id,roleName: p.role_name,roleDetails: p.role_name ? (ALL_ROLES_SERVER[Object.keys(ALL_ROLES_SERVER).find(key => ALL_ROLES_SERVER[key].name === p.role_name)] || {name: p.role_name, team: p.role_team || 'Unknown', alignment: p.role_alignment || 'Unknown', description: "Config missing."}) : null,status: p.status};}});

        const fullGameData = {
            gameId: gameDataFromDB.game_id, sessionId: gameDataFromDB.session_id, gameName: gameDataFromDB.game_name,
            currentPhase: gameDataFromDB.current_phase, seerPlayerName: gameDataFromDB.seer_player_name,
            werewolfNightTarget: gameDataFromDB.werewolf_night_target,
            playersOnTrial: gameDataFromDB.players_on_trial ? JSON.parse(gameDataFromDB.players_on_trial) : [],
            votes: gameDataFromDB.votes ? JSON.parse(gameDataFromDB.votes) : {},
            playerOrder: playerOrder.length > 0 ? playerOrder : Object.keys(playersInGameFromDB),
            gameWinner: gameDataFromDB.game_winner_team ? { team: gameDataFromDB.game_winner_team, reason: gameDataFromDB.game_winner_reason } : null,
            gameLog: gameDataFromDB.game_log ? JSON.parse(gameDataFromDB.game_log) : [],
            playersInGame: playersInGameFromDB 
        };
        gamesCache[gameId] = fullGameData; 
        return fullGameData;
    } catch (error) {
        console.error("Error in fetchGameFromDB for " + gameId + ":", error);
        return null;
    }
}


// --- API Endpoints ---
app.get('/api/version', (req, res) => res.json({ version: SERVER_VERSION }));

app.get('/api/master-players', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    try {
        const [rows] = await pool.query('SELECT id, name FROM master_players ORDER BY name ASC');
        res.json(rows);
    } catch (error) {
        console.error("Error fetching master players from DB:", error);
        res.status(500).json({ message: "Failed to fetch master players." });
    }
});

app.post('/api/master-players', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ message: 'Player name is required.' });
    
    const trimmedName = name.trim();
    try {
        const [existingRows] = await pool.execute('SELECT id FROM master_players WHERE LOWER(name) = LOWER(?)', [trimmedName]);
        if (existingRows.length > 0) {
            return res.status(409).json({ message: 'Player already exists in master list.' });
        }
        const newPlayerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        await pool.execute('INSERT INTO master_players (id, name) VALUES (?, ?)', [newPlayerId, trimmedName]);
        
        const newPlayer = { id: newPlayerId, name: trimmedName }; 
        console.log('Added to master player list (DB):', newPlayer);
        res.status(201).json(newPlayer);
    } catch (error) {
        console.error("Error adding player to DB:", error);
        if (error.code === 'ER_DUP_ENTRY') { 
             return res.status(409).json({ message: 'Player already exists in master list (DB constraint).' });
        }
        res.status(500).json({ message: "Failed to add player to master list." });
    }
});

// --- Session API Endpoints ---
app.get('/api/sessions', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    try {
        const [sessions] = await pool.query('SELECT session_id, session_name, session_date FROM sessions WHERE is_archived = FALSE ORDER BY session_date DESC, created_at DESC');
        res.json(sessions.map(s => ({ ...s, session_id: s.session_id, session_name: s.session_name, session_date: new Date(s.session_date).toISOString().split('T')[0]}))); 
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ message: "Failed to fetch sessions." });
    }
});

app.post('/api/sessions', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { sessionName, sessionDate } = req.body;
    if (!sessionName || !sessionDate) {
        return res.status(400).json({ message: "Session name and date are required." });
    }
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    try {
        await pool.execute(
            'INSERT INTO sessions (session_id, session_name, session_date) VALUES (?, ?, ?)',
            [sessionId, sessionName, sessionDate]
        );
        console.log('New session created:', sessionName, '(ID:', sessionId, ')');
        res.status(201).json({ sessionId, sessionName, sessionDate });
    } catch (error) {
        console.error("Error creating new session:", error);
        res.status(500).json({ message: "Failed to create session." });
    }
});

app.put('/api/sessions/:sessionId', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { sessionId } = req.params;
    const { sessionName, sessionDate } = req.body;
    
    let query = 'UPDATE sessions SET ';
    const params = [];
    const setClauses = [];

    if (sessionName !== undefined) { 
        setClauses.push('session_name = ?');
        params.push(sessionName);
    }
    if (sessionDate) {
        setClauses.push('session_date = ?');
        params.push(sessionDate);
    }
    
    if (setClauses.length === 0) {
        return res.status(400).json({ message: "No valid fields to update (provide sessionName or sessionDate)." });
    }

    query += setClauses.join(', ');
    query += ' WHERE session_id = ? AND is_archived = FALSE'; 
    params.push(sessionId);

    try {
        const [result] = await pool.execute(query, params);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Session not found or is archived." });
        
        console.log('Session updated:', sessionId);
        res.status(200).json({ message: "Session updated successfully." });
    } catch (error) {
        console.error("Error updating session " + sessionId + ":", error);
        res.status(500).json({ message: "Failed to update session." });
    }
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { sessionId } = req.params;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [sessionUpdateResult] = await connection.execute('UPDATE sessions SET is_archived = TRUE WHERE session_id = ?', [sessionId]);
        if (sessionUpdateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "Session not found." });
        }
        
        await connection.execute('UPDATE games SET is_archived = TRUE WHERE session_id = ?', [sessionId]);
        await connection.commit();
        
        Object.keys(gamesCache).forEach(gameId => {
            if (gamesCache[gameId] && gamesCache[gameId].sessionId === sessionId) {
                delete gamesCache[gameId];
            }
        });
        console.log('Session and its games archived:', sessionId);
        res.status(204).send();
    } catch (error) {
        await connection.rollback();
        console.error("Error archiving session " + sessionId + ":", error);
        res.status(500).json({ message: "Failed to archive session." });
    } finally {
        if(connection) connection.release();
    }
});


// --- Game API Endpoints (Session-Aware) ---
app.get('/api/sessions/:sessionId/games', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { sessionId } = req.params;
    try {
        const [sessionRows] = await pool.execute('SELECT session_id FROM sessions WHERE session_id = ? AND is_archived = FALSE', [sessionId]);
        if (sessionRows.length === 0) return res.status(404).json({message: "Session not found or is archived."});

        const [gameRows] = await pool.query(
            'SELECT g.game_id, g.game_name, g.current_phase, g.game_winner_team, COUNT(gp.player_id) as playerCount FROM games g LEFT JOIN game_players gp ON g.game_id = gp.game_id WHERE g.session_id = ? AND g.is_archived = FALSE GROUP BY g.game_id ORDER BY g.created_at DESC',
            [sessionId]
        );
        const gameList = gameRows.map(game => ({
            gameId: game.game_id,
            gameName: game.game_name,
            playerCount: Number(game.playerCount),
            currentPhase: game.current_phase,
            gameWinner: game.game_winner_team ? { team: game.game_winner_team } : null
        }));
        res.json(gameList);
    } catch (error) {
        console.error("Error fetching games for session " + sessionId + ":", error);
        res.status(500).json({ message: "Failed to fetch games for session." });
    }
});

app.post('/api/sessions/:sessionId/games', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { sessionId } = req.params;
    const { gameName } = req.body;

    try {
        const [sessionRows] = await pool.execute('SELECT session_id FROM sessions WHERE session_id = ? AND is_archived = FALSE', [sessionId]);
        if (sessionRows.length === 0) return res.status(404).json({message: "Session not found or is archived."});

        const newGameId = 'game_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        let gameCountForName = 0;
        try {
            const [countRows] = await pool.query('SELECT COUNT(*) as count FROM games WHERE session_id = ?', [sessionId]);
            gameCountForName = countRows[0].count;
        } catch (dbError) { console.error("Error fetching game count for session:", dbError); }
        const newGameDisplayName = gameName || 'Game ' + (gameCountForName + 1);

        await pool.execute(
            'INSERT INTO games (game_id, session_id, game_name, current_phase, players_on_trial, votes, player_order_json, game_log) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [newGameId, sessionId, newGameDisplayName, 'setup', JSON.stringify([]), JSON.stringify({}), JSON.stringify([]), JSON.stringify([])]
        );
        
        gamesCache[newGameId] = { 
            gameId: newGameId, sessionId, gameName: newGameDisplayName,
            playersInGame: {}, playerOrder: [], currentPhase: 'setup', gameLog: [],
            seerPlayerName: null, werewolfNightTarget: null, playersOnTrial: [], votes: {}, gameWinner: null
        };
        console.log('New game created in session', sessionId, ':', newGameDisplayName, '(ID:', newGameId, ')');
        res.status(201).json({ gameId: newGameId, gameName: newGameDisplayName, sessionId });
    } catch (error) {
        console.error("Error creating new game in session " + sessionId + ":", error);
        res.status(500).json({ message: "Failed to create new game." });
    }
});

app.delete('/api/games/:gameId', async (req, res) => { 
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { gameId } = req.params;
    try {
        const [result] = await pool.execute('UPDATE games SET is_archived = TRUE WHERE game_id = ?', [gameId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Game not found." });
        
        if (gamesCache[gameId]) delete gamesCache[gameId]; 

        console.log('Game archived:', gameId);
        res.status(204).send();
    } catch (error) {
        console.error("Error archiving game " + gameId + ":", error);
        res.status(500).json({ message: "Failed to archive game." });
    }
});

app.get('/api/games/:gameId', async (req, res) => {
    const gameData = await fetchGameFromDB(req.params.gameId);
    if (gameData) {
        res.json(gameData);
    } else {
        res.status(404).json({ message: 'Game not found or is archived.' });
    }
});

app.post('/api/games/:gameId/players', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const gameId = req.params.gameId;
    let game = gamesCache[gameId] || await fetchGameFromDB(gameId); 
    const { players: playerNamesFromClient } = req.body; 

    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Cannot modify players, game already finished.' });
    if (!Array.isArray(playerNamesFromClient)) return res.status(400).json({ message: 'Invalid player list.' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute('DELETE FROM game_players WHERE game_id = ?', [gameId]);

        const newPlayersInGame = {};
        const newPlayerOrder = [];

        for (const name of playerNamesFromClient) {
            const masterPlayer = await getMasterPlayerByNameDB(name); 
            if (masterPlayer) {
                await connection.execute(
                    'INSERT INTO game_players (game_id, player_id, player_name, status) VALUES (?, ?, ?, ?)',
                    [gameId, masterPlayer.id, name, 'alive']
                );
                newPlayersInGame[name] = { id: masterPlayer.id, roleName: null, roleDetails: null, status: 'alive' };
                newPlayerOrder.push(name);
            }
        }
        
        await connection.execute('UPDATE games SET player_order_json = ? WHERE game_id = ?', [JSON.stringify(newPlayerOrder), gameId]);
        await connection.commit();

        game.playersInGame = newPlayersInGame; 
        game.playerOrder = newPlayerOrder;
        if (game.seerPlayerName && !game.playersInGame[game.seerPlayerName]) game.seerPlayerName = null;
        if (game.werewolfNightTarget && !game.playersInGame[game.werewolfNightTarget]) game.werewolfNightTarget = null;
        gamesCache[gameId] = game;
        
        console.log('Players updated for game (DB)', game.gameId, ':', game.playerOrder);
        res.status(200).json(game); 
    } catch (error) {
        await connection.rollback();
        console.error("Error updating players in game (DB):", error);
        res.status(500).json({ message: "Failed to update players in game." });
    } finally {
        if(connection) connection.release();
    }
});


app.post('/api/games/:gameId/assign-roles', async (req, res) => {
    const gameId = req.params.gameId;
    let game = gamesCache[gameId] || await fetchGameFromDB(gameId);
    if (!game || !game.playerOrder || game.playerOrder.length === 0) return res.status(400).json({ message: 'No players in game to assign roles.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Game already finished.' });

    let rolesToAssign = []; 
    let newSeerPlayerName = null; 
    const numPlayers = game.playerOrder.length;
    // TODO: Replace this with dynamic role assignment based on roles_config table
    if (numPlayers >= 1) rolesToAssign.push(ALL_ROLES_SERVER.WEREWOLF);
    if (numPlayers >= 3) rolesToAssign.push(ALL_ROLES_SERVER.SEER);
    while (rolesToAssign.length < numPlayers) rolesToAssign.push(ALL_ROLES_SERVER.VILLAGER);
    for (let i = rolesToAssign.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rolesToAssign[i], rolesToAssign[j]] = [rolesToAssign[j], rolesToAssign[i]]; }
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const updatedPlayersInGameData = {}; 

        for (const [index, playerName] of game.playerOrder.entries()) {
            const assignedRoleDetails = rolesToAssign[index];
            const masterPlayer = await getMasterPlayerByNameDB(playerName); 
            const playerId = masterPlayer ? masterPlayer.id : ('uid_fallback_' + playerName); 

            const [updateResult] = await connection.execute(
                'UPDATE game_players SET role_name = ?, role_team = ?, role_alignment = ?, status = ? WHERE game_id = ? AND player_id = ?',
                [assignedRoleDetails.name, assignedRoleDetails.team, assignedRoleDetails.alignment, 'alive', gameId, playerId]
            );
            if (updateResult.affectedRows === 0) { 
                 await connection.execute(
                    'INSERT INTO game_players (game_id, player_id, player_name, role_name, role_team, role_alignment, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [gameId, playerId, playerName, assignedRoleDetails.name, assignedRoleDetails.team, assignedRoleDetails.alignment, 'alive']
                );
            }
           
            updatedPlayersInGameData[playerName] = { 
                id: playerId, 
                roleName: assignedRoleDetails.name, 
                roleDetails: assignedRoleDetails, 
                status: 'alive' 
            };
            if (assignedRoleDetails.name === "Seer") newSeerPlayerName = playerName;
        }
        
        await connection.execute(
            'UPDATE games SET current_phase = ?, seer_player_name = ?, werewolf_night_target = NULL WHERE game_id = ?',
            ['roles_assigned', newSeerPlayerName, gameId]
        );
        await connection.commit();

        game.playersInGame = updatedPlayersInGameData; 
        game.currentPhase = 'roles_assigned'; 
        game.seerPlayerName = newSeerPlayerName;
        game.werewolfNightTarget = null;
        gamesCache[gameId] = game; 

        console.log('Roles assigned for (DB)', game.gameId);
        res.status(200).json(game); 
    } catch (error) {
        await connection.rollback();
        console.error("Error assigning roles in DB:", error);
        res.status(500).json({message: "Failed to assign roles."});
    } finally {
        if(connection) connection.release();
    }
});

app.post('/api/games/:gameId/player-status', async (req, res) => {
    const gameId = req.params.gameId;
    let game = gamesCache[gameId] || await fetchGameFromDB(gameId);
    const { playerName, status } = req.body;
    if (!game || !game.playersInGame[playerName]) return res.status(404).json({ message: 'Game or player not found.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Game already finished.' });
    if (status !== 'alive' && status !== 'eliminated') return res.status(400).json({ message: 'Invalid status.' });
    
    game.playersInGame[playerName].status = status; 
    try {
        await pool.execute('UPDATE game_players SET status = ? WHERE game_id = ? AND player_name = ?', [status, gameId, playerName]);
        console.log('Status for', playerName, 'in', gameId, 'to', status, '(DB updated)');
        await checkWinConditions(game); 
        gamesCache[gameId] = game; 
        res.status(200).json(game); 
    } catch (dbError) {
        console.error("Error updating player status in DB:", dbError);
        res.status(500).json({message: "Failed to update player status."});
    }
});

app.post('/api/games/:gameId/phase', async (req, res) => {
    const gameId = req.params.gameId;
    let game = gamesCache[gameId] || await fetchGameFromDB(gameId);
    const { phase } = req.body; 
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (!phase) return res.status(400).json({ message: "Phase is required" });
    
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});

    if (phase !== 'setup' && game.currentPhase === 'setup' && !Object.values(game.playersInGame).some(p => p.roleName)) {
         return res.status(400).json({ message: "Cannot start phase. Roles not assigned yet."});
    }
    
    let previousPhase = game.currentPhase;
    game.currentPhase = phase;
    let eliminationResult = { eliminatedPlayerName: null, specialInfo: null }; 

    try {
        if (phase === 'night') {
            game.werewolfNightTarget = null; 
            game.playersOnTrial = []; game.votes = {}; 
            await pool.execute('UPDATE games SET current_phase = ?, werewolf_night_target = NULL, players_on_trial = ?, votes = ? WHERE game_id = ?', 
                [phase, JSON.stringify(game.playersOnTrial || []), JSON.stringify(game.votes || {}), gameId]);
            console.log("Game " + gameId + " phase changed to NIGHT (DB updated)");
        } else if (phase === 'day') {
            console.log("Game " + gameId + " phase changed to DAY from " + previousPhase);
            if (previousPhase === 'night' && game.werewolfNightTarget && game.playersInGame[game.werewolfNightTarget]) {
                if (game.playersInGame[game.werewolfNightTarget].status === 'alive') {
                    game.playersInGame[game.werewolfNightTarget].status = 'eliminated'; 
                    eliminationResult.eliminatedPlayerName = game.werewolfNightTarget; 
                    game.gameLog = game.gameLog || [];
                    game.gameLog.push(game.werewolfNightTarget + " was eliminated by werewolves.");
                    await pool.execute('UPDATE game_players SET status = ? WHERE game_id = ? AND player_name = ?', ['eliminated', gameId, game.werewolfNightTarget]);
                    console.log(game.werewolfNightTarget + " eliminated by WW in " + gameId + " (DB updated)");
                } else {
                    eliminationResult.specialInfo = game.werewolfNightTarget + " was already eliminated.";
                }
            } else if (previousPhase === 'night') { 
                eliminationResult.specialInfo = "No one was eliminated by werewolves.";
            }
            
            game.werewolfNightTarget = null; 
            game.playersOnTrial = []; game.votes = {}; 
            await pool.execute(
                'UPDATE games SET current_phase = ?, werewolf_night_target = NULL, players_on_trial = ?, votes = ?, game_log = ? WHERE game_id = ?', 
                [phase, JSON.stringify(game.playersOnTrial || []), JSON.stringify(game.votes || {}), JSON.stringify(game.gameLog || []), gameId]
            );
        }
        await checkWinConditions(game); 
        
        game.eliminationResult = eliminationResult;
        gamesCache[gameId] = game; 
        res.status(200).json(game); 

    } catch (dbError) {
        console.error("Error updating phase in DB for game " + gameId + ":", dbError);
        res.status(500).json({message: "Failed to update game phase in DB."});
    }
});

app.post('/api/games/:gameId/action', async (req, res) => { 
    const gameId = req.params.gameId;
    const game = gamesCache[gameId] || await fetchGameFromDB(gameId); 
    const { actionType, targetPlayerName } = req.body;
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'night') return res.status(400).json({ message: "Actions only at night." });

    if (actionType === 'seerCheck') {
        if (!targetPlayerName || !game.playersInGame[targetPlayerName] || !game.playersInGame[targetPlayerName].roleDetails) {
             return res.status(400).json({ message: "Invalid Seer target or target has no role details." });
        }
        const targetData = game.playersInGame[targetPlayerName];
        const alignmentMessage = targetData.roleDetails.alignment === "Werewolf" ? "Is a Werewolf" : "Not a Werewolf";
        console.log("Seer check on", targetPlayerName, "in", gameId, ":", alignmentMessage);
        return res.status(200).json({ alignmentMessage });
    } else if (actionType === 'werewolfTarget') {
        if (!targetPlayerName || !game.playersInGame[targetPlayerName] || game.playersInGame[targetPlayerName].status !== 'alive') return res.status(400).json({ message: "Invalid WW target." });
        if (game.playersInGame[targetPlayerName].roleName === "Werewolf") return res.status(400).json({ message: "WWs can't target WWs." });
        game.werewolfNightTarget = targetPlayerName; 
        try {
            await pool.execute('UPDATE games SET werewolf_night_target = ? WHERE game_id = ?', [targetPlayerName, gameId]);
            gamesCache[gameId] = game; 
            console.log("WWs targeted", targetPlayerName, "in", gameId, "(DB updated)");
            return res.status(200).json({ message: "WW target recorded: " + targetPlayerName });
        } catch (dbError) {
            console.error("Error updating werewolf target in DB:", dbError);
            return res.status(500).json({message: "Failed to record werewolf target."});
        }
    }
    return res.status(400).json({ message: "Unknown action." });
});

app.post('/api/games/:gameId/start-vote', async (req, res) => {
    const gameId = req.params.gameId;
    const game = gamesCache[gameId] || await fetchGameFromDB(gameId);
    const { playerNamesOnTrial } = req.body;
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'day') return res.status(400).json({ message: "Can only start vote during the day." });
    if (!Array.isArray(playerNamesOnTrial) || playerNamesOnTrial.some(name => !game.playersInGame[name] || game.playersInGame[name].status !== 'alive')) {
        return res.status(400).json({ message: "Invalid players for trial." });
    }
    game.playersOnTrial = playerNamesOnTrial;
    game.votes = {};
    playerNamesOnTrial.forEach(name => game.votes[name] = 0);
    game.currentPhase = 'voting';
    try {
        await pool.execute('UPDATE games SET current_phase = ?, players_on_trial = ?, votes = ? WHERE game_id = ?',
            [game.currentPhase, JSON.stringify(game.playersOnTrial), JSON.stringify(game.votes), gameId]);
        gamesCache[gameId] = game; 
        console.log("Voting started for:", playerNamesOnTrial, "in game", gameId, "(DB updated)");
        res.status(200).json(game); 
    } catch (dbError) {
        console.error("Error starting vote in DB:", dbError);
        res.status(500).json({message: "Failed to start vote."});
    }
});

app.post('/api/games/:gameId/update-vote', async (req, res) => {
    const gameId = req.params.gameId;
    const game = gamesCache[gameId] || await fetchGameFromDB(gameId);
    const { playerName, change } = req.body;
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Not in voting phase." });
    if (!game.playersOnTrial.includes(playerName)) return res.status(400).json({ message: "Player not on trial." });
    
    game.votes[playerName] = (game.votes[playerName] || 0) + parseInt(change);
    if (game.votes[playerName] < 0) game.votes[playerName] = 0; 
    
    try {
        await pool.execute('UPDATE games SET votes = ? WHERE game_id = ?', [JSON.stringify(game.votes), gameId]);
        gamesCache[gameId] = game; 
        console.log("Vote updated for", playerName, "to", game.votes[playerName], "in game", gameId, "(DB updated)");
        res.status(200).json({ votes: game.votes }); 
    } catch (dbError) {
        console.error("Error updating vote in DB:", dbError);
        res.status(500).json({message: "Failed to update vote."});
    }
});

app.post('/api/games/:gameId/clear-votes', async (req, res) => {
    const gameId = req.params.gameId;
    const game = gamesCache[gameId] || await fetchGameFromDB(gameId);
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Not in voting phase." });
    
    game.playersOnTrial.forEach(name => game.votes[name] = 0); 
    try {
        await pool.execute('UPDATE games SET votes = ? WHERE game_id = ?', [JSON.stringify(game.votes), gameId]);
        gamesCache[gameId] = game; 
        console.log("Votes cleared for trial in game", gameId, "(DB updated)");
        res.status(200).json(game); 
    } catch (dbError) {
        console.error("Error clearing votes in DB:", dbError);
        res.status(500).json({message: "Failed to clear votes."});
    }
});

app.post('/api/games/:gameId/process-elimination', async (req, res) => {
    const gameId = req.params.gameId;
    let game = gamesCache[gameId] || await fetchGameFromDB(gameId); 
    const { eliminatedPlayerName } = req.body; 
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Can only process from voting phase." });

    let actualEliminationMessage = "No one was eliminated by vote."; 
    if (eliminatedPlayerName && game.playersInGame[eliminatedPlayerName] && game.playersInGame[eliminatedPlayerName].status === 'alive') {
        game.playersInGame[eliminatedPlayerName].status = 'eliminated'; 
        actualEliminationMessage = eliminatedPlayerName + " was eliminated by vote.";
        game.gameLog = game.gameLog || [];
        game.gameLog.push(actualEliminationMessage);
        try {
            await pool.execute('UPDATE game_players SET status = ? WHERE game_id = ? AND player_name = ?', ['eliminated', gameId, eliminatedPlayerName]);
            console.log(actualEliminationMessage + " In game " + gameId + " (DB updated)");
        } catch (dbError) {
            console.error("Error updating player status in DB during elimination:", dbError);
            return res.status(500).json({message: "Failed to process elimination in DB."});
        }
    } else if (eliminatedPlayerName) {
        actualEliminationMessage = "Attempted to eliminate " + eliminatedPlayerName + ", but they were not found or not alive.";
        console.log(actualEliminationMessage);
    }
    
    game.currentPhase = 'day'; 
    game.playersOnTrial = [];
    game.votes = {};
    try {
        await pool.execute('UPDATE games SET current_phase = ?, players_on_trial = ?, votes = ?, game_log = ? WHERE game_id = ?',
            [game.currentPhase, JSON.stringify(game.playersOnTrial), JSON.stringify(game.votes), JSON.stringify(game.gameLog || []), gameId]);
        console.log("Elimination processed, phase set to day for", gameId, "(DB updated)");
    } catch (dbError) {
        console.error("Error updating game state after elimination in DB:", dbError);
        return res.status(500).json({message: "Failed to finalize elimination process in DB."});
    }
    
    await checkWinConditions(game); 
    gamesCache[gameId] = game; 
    const gameResponse = {...game, eliminationOutcome: actualEliminationMessage };
    res.status(200).json(gameResponse); 
});


// --- Admin Role Configuration API Endpoints ---
app.get('/api/admin/roles', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    console.log("SERVER: GET /api/admin/roles invoked.");
    try {
        const [roles] = await pool.query('SELECT role_id, role_name, description, team, alignment, apparent_alignment, is_killer, power_level, uses_magic, has_night_movement, role_category_type, starts_as_villager, has_night_action, night_action_order, is_enabled FROM roles_config WHERE is_archived = 0 ORDER BY role_name ASC');
        console.log("SERVER: Roles fetched from DB:", roles);
        res.json(roles);
    } catch (error) {
        console.error("SERVER: Error fetching roles from DB:", error);
        res.status(500).json({ message: "Failed to fetch roles.", error: error.message });
    }
});

app.post('/api/admin/roles', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { 
        roleName, description, team, alignment, apparentAlignment, 
        isKiller, powerLevel, usesMagic, hasNightMovement, roleCategoryType, 
        startsAsVillager, hasNightAction, nightActionOrder, isEnabledRole 
    } = req.body;

    if (!roleName || !team || !alignment) {
        return res.status(400).json({ message: "Role Name, Team, and Alignment are required." });
    }
    const roleId = 'role_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    try {
        // Note: is_unique was removed from client form, defaulting to TRUE in DB for now if that column still exists.
        // If is_unique was removed from DB schema, remove it from this INSERT.
        await pool.execute(
            'INSERT INTO roles_config (role_id, role_name, description, team, alignment, apparent_alignment, is_killer, power_level, uses_magic, has_night_movement, role_category_type, starts_as_villager, has_night_action, night_action_order, is_enabled, is_archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [roleId, roleName, description, team, alignment, apparentAlignment || null, 
             isKiller || false, powerLevel || 'Standard', usesMagic || false, hasNightMovement || false, roleCategoryType || null, 
             startsAsVillager || false, hasNightAction || false, nightActionOrder || 0, 
             isEnabledRole === undefined ? true : isEnabledRole, false]
        );
        console.log('New role defined:', roleName);
        res.status(201).json({ roleId, roleName });
    } catch (error) {
        console.error("Error creating new role in DB:", error);
         if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'A role with this name already exists.' });
        }
        res.status(500).json({ message: "Failed to create new role." });
    }
});

app.get('/api/admin/screens', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    try {
        const [screens] = await pool.query('SELECT screen_id, screen_name, screen_category, display_title_template, display_content_template, intended_audience FROM screens_config WHERE is_archived = FALSE ORDER BY screen_name ASC');
        res.json(screens);
    } catch (error) {
        console.error("Error fetching screens:", error);
        res.status(500).json({ message: "Failed to fetch screens." });
    }
});

app.post('/api/admin/screens', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { screenName, screenCategory, displayTitleTemplate, displayContentTemplate, intendedAudience } = req.body;
    if (!screenName || !screenCategory) {
        return res.status(400).json({ message: "Screen Name and Category are required."});
    }
    const screenId = 'screen_' + Date.now() + '_' + Math.random().toString(36).substring(2,9);
    try {
        await pool.execute(
            'INSERT INTO screens_config (screen_id, screen_name, screen_category, display_title_template, display_content_template, intended_audience, is_archived) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [screenId, screenName, screenCategory, displayTitleTemplate, displayContentTemplate, intendedAudience || 'DisplayOnly', false]
        );
        console.log("New screen defined:", screenName);
        res.status(201).json({ screenId, screenName });
    } catch (error) {
        console.error("Error creating new screen:", error);
        if (error.code === 'ER_DUP_ENTRY') { 
            return res.status(409).json({ message: 'A screen with this name already exists.' });
        }
        res.status(500).json({ message: "Failed to create new screen." });
    }
});

app.get('/api/admin/roles/:roleId/screens', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { roleId } = req.params;
    try {
        const [assignments] = await pool.execute(
            'SELECT rs.assignment_id, rs.screen_id, rs.usage_context, s.screen_name, s.screen_category FROM role_screen_assignments rs JOIN screens_config s ON rs.screen_id = s.screen_id WHERE rs.role_id = ? AND s.is_archived = FALSE',
            [roleId]
        );
        res.json(assignments);
    } catch (error) {
        console.error(`Error fetching screen assignments for role ${roleId}:`, error);
        res.status(500).json({ message: "Failed to fetch screen assignments." });
    }
});

app.post('/api/admin/roles/:roleId/screens', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { roleId } = req.params;
    const { screenId, usageContext } = req.body;
    if (!screenId || !usageContext) {
        return res.status(400).json({ message: "Screen ID and Usage Context are required." });
    }
    try {
        const [result] = await pool.execute(
            'INSERT INTO role_screen_assignments (role_id, screen_id, usage_context) VALUES (?, ?, ?)',
            [roleId, screenId, usageContext]
        );
        res.status(201).json({ assignmentId: result.insertId, roleId, screenId, usageContext });
    } catch (error) {
        console.error(`Error assigning screen ${screenId} to role ${roleId}:`, error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'This screen is already assigned to this role for the given context.' });
        }
        res.status(500).json({ message: "Failed to assign screen to role." });
    }
});

app.delete('/api/admin/role-screen-assignments/:assignmentId', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { assignmentId } = req.params;
    try {
        const [result] = await pool.execute('DELETE FROM role_screen_assignments WHERE assignment_id = ?', [assignmentId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Screen assignment not found." });
        }
        res.status(204).send();
    } catch (error) {
        console.error(`Error deleting screen assignment ${assignmentId}:`, error);
        res.status(500).json({ message: "Failed to delete screen assignment." });
    }
});


// --- HTTP Server Setup & WebSocket ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/moderator.html', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html'))); 
app.get('/display.html', (req, res) => res.sendFile(path.join(__dirname, 'display.html')));
app.use((req, res) => res.status(404).send('Resource not found: ' + req.url));

const server = http.createServer(app); 
const wss = new WebSocket.Server({ server }); 
const clients = new Set();

wss.on('error', (error) => { console.error('[WS Server Error]', error); if (error.code === 'EADDRINUSE') process.exit(1); });
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress || 'unknown IP';
    clients.add(ws);
    console.log('WS Client connected:', clientIp, 'Total:', clients.size);
    ws.on('message', (message) => {
        const messageString = message.toString();
        let parsedMessage;
        try { parsedMessage = JSON.parse(messageString); } 
        catch (e) { console.warn('WS non-JSON msg:', messageString); return; }
        
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(parsedMessage));
            }
        });
    });
    ws.on('close', (code, reason) => {
        clients.delete(ws);
        console.log('WS Client disconnected:', clientIp, 'Code:', code, 'Reason:', reason.toString(), 'Total:', clients.size);
    });
    ws.on('error', (error) => console.error('WS error on client', clientIp, ':', error));
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
    console.log('HTTP & WS server on port', port + ' - Version: ' + SERVER_VERSION);
    console.log('Moderator: http://localhost:' + port + '/');
    console.log('Display: http://localhost:' + port + '/display.html');
    console.log('Admin: http://localhost:' + port + '/admin.html');
});
console.log('Initializing server... Version: ' + SERVER_VERSION);

// --- End of server.js ---
