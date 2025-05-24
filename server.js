// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install `express` and `ws`: npm install express ws
// 3. Install `mysql2`: npm install mysql2
// 4. Set up your MariaDB/MySQL database and environment variables.
// 5. Create the `master_players` table (and `games`, `game_players` if ready) using SQL.
// 6. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express'); 
const mysql = require('mysql2/promise'); 

const app = express(); 
app.use(express.json()); 

const SERVER_VERSION = "0.9.1"; 

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
        connectTimeout: 10000 // 10 seconds
    });
    console.log("Attempting to connect to MariaDB...");
    // Test connection
    pool.getConnection()
        .then(connection => {
            console.log("Successfully connected to MariaDB! Connection ID: " + connection.threadId);
            connection.release();
        })
        .catch(err => {
            console.error("Error establishing initial connection to MariaDB:", err.message);
            console.error("Please ensure MariaDB is running and accessible with the provided credentials.");
            // process.exit(1); // Exit if initial critical connection fails
        });

} catch (error) {
    console.error("Failed to create MariaDB connection pool:", error);
    // process.exit(1);
}

/*
SQL to create tables (run this in phpMyAdmin or similar tool):

CREATE TABLE IF NOT EXISTS master_players (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
   game_id VARCHAR(255) PRIMARY KEY,
   game_name VARCHAR(255) NOT NULL,
   current_phase VARCHAR(50) DEFAULT 'setup',
   seer_player_name VARCHAR(255) NULL,
   werewolf_night_target VARCHAR(255) NULL,
   players_on_trial JSON NULL, 
   votes JSON NULL,            
   player_order_json JSON NULL, 
   game_winner_team VARCHAR(50) NULL,
   game_winner_reason TEXT NULL,
   game_log JSON NULL,         
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id VARCHAR(255) NOT NULL,
    player_id VARCHAR(255) NOT NULL, 
    player_name VARCHAR(255) NOT NULL, 
    role_name VARCHAR(255) NULL,
    role_team VARCHAR(50) NULL,
    role_alignment VARCHAR(50) NULL,
    status VARCHAR(50) DEFAULT 'alive', -- e.g., 'alive', 'eliminated'
    FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES master_players(id) ON DELETE RESTRICT, 
    UNIQUE KEY unique_player_in_game (game_id, player_id) 
);
*/

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


async function checkWinConditions(game) { // Made async for potential DB reads if game object isn't fully populated
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
         // TODO: Update game in DB
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


// --- API Endpoints ---
app.get('/api/version', (req, res) => {
    res.json({ version: SERVER_VERSION });
});

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

app.get('/api/games', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    try {
        const [gameRows] = await pool.query('SELECT game_id, game_name, current_phase, game_winner_team FROM games ORDER BY created_at DESC');
        const gameListPromises = gameRows.map(async (game) => {
            const [playerRows] = await pool.execute('SELECT COUNT(*) as playerCount FROM game_players WHERE game_id = ?', [game.game_id]);
            return {
                gameId: game.game_id,
                gameName: game.game_name,
                playerCount: playerRows[0].playerCount,
                currentPhase: game.current_phase,
                gameWinner: game.game_winner_team ? { team: game.game_winner_team } : null 
            };
        });
        const gameList = await Promise.all(gameListPromises);
        res.json(gameList);
    } catch (error) {
        console.error("Error fetching games list from DB:", error);
        res.status(500).json({ message: "Failed to fetch games list." });
    }
});

app.post('/api/games', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { gameName } = req.body;
    const newGameId = 'game_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newGameDisplayName = gameName || 'Werewolf Game ' + (await pool.query('SELECT COUNT(*) as count FROM games'))[0][0].count + 1;

    try {
        await pool.execute(
            'INSERT INTO games (game_id, game_name, current_phase, players_on_trial, votes, player_order_json, game_log) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [newGameId, newGameDisplayName, 'setup', JSON.stringify([]), JSON.stringify({}), JSON.stringify([]), JSON.stringify([])]
        );
        // Also update the in-memory 'games' object for now, until all logic uses DB.
        games[newGameId] = {
            gameId: newGameId, gameName: newGameDisplayName,
            playersInGame: {}, playerOrder: [], currentPhase: 'setup', gameLog: [],
            seerPlayerName: null, werewolfNightTarget: null, playersOnTrial: [], votes: {}, gameWinner: null
        };
        console.log('New game created (DB & in-memory):', newGameDisplayName, '(ID:', newGameId, ')');
        res.status(201).json({ gameId: newGameId, gameName: newGameDisplayName });
    } catch (error) {
        console.error("Error creating new game in DB:", error);
        res.status(500).json({ message: "Failed to create new game." });
    }
});

app.get('/api/games/:gameId', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const gameId = req.params.gameId;
    try {
        const [gameRows] = await pool.execute('SELECT * FROM games WHERE game_id = ?', [gameId]);
        if (gameRows.length === 0) {
            return res.status(404).json({ message: 'Game not found.' });
        }
        const gameDataFromDB = gameRows[0];
        
        // Fetch players for this game
        const [playerDetailRows] = await pool.execute(
            'SELECT mp.id as player_id, gp.player_name, gp.role_name, gp.role_team, gp.role_alignment, gp.status FROM game_players gp JOIN master_players mp ON gp.player_id = mp.id WHERE gp.game_id = ?',
            [gameId]
        );

        const playersInGame = {};
        playerDetailRows.forEach(p => {
            playersInGame[p.player_name] = {
                id: p.player_id,
                roleName: p.role_name,
                roleDetails: p.role_name ? (Object.values(ALL_ROLES_SERVER).find(r => r.name === p.role_name) || null) : null,
                status: p.status
            };
        });
        
        const fullGameData = {
            gameId: gameDataFromDB.game_id,
            gameName: gameDataFromDB.game_name,
            currentPhase: gameDataFromDB.current_phase,
            seerPlayerName: gameDataFromDB.seer_player_name,
            werewolfNightTarget: gameDataFromDB.werewolf_night_target,
            playersOnTrial: gameDataFromDB.players_on_trial ? JSON.parse(gameDataFromDB.players_on_trial) : [],
            votes: gameDataFromDB.votes ? JSON.parse(gameDataFromDB.votes) : {},
            playerOrder: gameDataFromDB.player_order_json ? JSON.parse(gameDataFromDB.player_order_json) : [],
            gameWinner: gameDataFromDB.game_winner_team ? { team: gameDataFromDB.game_winner_team, reason: gameDataFromDB.game_winner_reason } : null,
            gameLog: gameDataFromDB.game_log ? JSON.parse(gameDataFromDB.game_log) : [],
            playersInGame: playersInGame // Populated from game_players table
        };
        
        // Update in-memory cache as well
        games[gameId] = fullGameData; 
        res.json(fullGameData);

    } catch (error) {
        console.error("Error fetching game " + gameId + " from DB:", error);
        res.status(500).json({ message: "Failed to fetch game." });
    }
});

app.post('/api/games/:gameId/players', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const gameId = req.params.gameId;
    const game = games[gameId]; // Still using in-memory game object for some logic temporarily
    const { players: playerNamesFromClient } = req.body; 

    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Cannot modify players, game already finished.' });
    if (!Array.isArray(playerNamesFromClient)) return res.status(400).json({ message: 'Invalid player list.' });

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        // Clear existing players for this game from game_players table
        await connection.execute('DELETE FROM game_players WHERE game_id = ?', [gameId]);

        const newPlayersInGame = {};
        const newPlayerOrder = [];

        for (const name of playerNamesFromClient) {
            const masterPlayer = await getMasterPlayerByNameDB(name); // Use DB helper
            if (masterPlayer) {
                // Insert new player into game_players
                await connection.execute(
                    'INSERT INTO game_players (game_id, player_id, player_name, status) VALUES (?, ?, ?, ?)',
                    [gameId, masterPlayer.id, name, 'alive']
                );
                newPlayersInGame[name] = { id: masterPlayer.id, roleName: null, roleDetails: null, status: 'alive' };
                newPlayerOrder.push(name);
            }
        }
        
        // Update player_order_json in the games table
        await connection.execute('UPDATE games SET player_order_json = ? WHERE game_id = ?', [JSON.stringify(newPlayerOrder), gameId]);
        
        await connection.commit();

        // Update in-memory game object
        game.playersInGame = newPlayersInGame; 
        game.playerOrder = newPlayerOrder;
        if (game.seerPlayerName && !game.playersInGame[game.seerPlayerName]) game.seerPlayerName = null;
        if (game.werewolfNightTarget && !game.playersInGame[game.werewolfNightTarget]) game.werewolfNightTarget = null;
        
        console.log('Players updated for game (DB)', game.gameId, ':', game.playerOrder);
        res.status(200).json(game); // Return the updated game object
    } catch (error) {
        await connection.rollback();
        console.error("Error updating players in game (DB):", error);
        res.status(500).json({ message: "Failed to update players in game." });
    } finally {
        connection.release();
    }
});

// Endpoints like assign-roles, player-status, phase, action, voting will be refactored next
// to fully use the database for game state. For now, they might still rely partially on the
// in-memory `games[gameId]` object which is populated by `GET /api/games/:gameId`.

app.post('/api/games/:gameId/assign-roles', async (req, res) => {
    // This needs to be fully refactored to update game_players table
    const game = games[req.params.gameId]; // Current game object from in-memory
    if (!game || !game.playerOrder || game.playerOrder.length === 0) return res.status(400).json({ message: 'No players.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Game already finished.' });

    let rolesToAssign = []; game.seerPlayerName = null;
    const numPlayers = game.playerOrder.length;
    if (numPlayers >= 1) rolesToAssign.push(ALL_ROLES_SERVER.WEREWOLF);
    if (numPlayers >= 3) rolesToAssign.push(ALL_ROLES_SERVER.SEER);
    while (rolesToAssign.length < numPlayers) rolesToAssign.push(ALL_ROLES_SERVER.VILLAGER);
    for (let i = rolesToAssign.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rolesToAssign[i], rolesToAssign[j]] = [rolesToAssign[j], rolesToAssign[i]]; }
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const newPlayersInGameData = {}; // For updating in-memory game object

        for (const [index, playerName] of game.playerOrder.entries()) {
            const assignedRoleDetails = rolesToAssign[index];
            const masterPlayer = getPlayerByName(playerName); // This still uses in-memory masterPlayerList for ID
            const playerId = masterPlayer ? masterPlayer.id : 'uid_fallback_' + playerName;

            await connection.execute(
                'UPDATE game_players SET role_name = ?, role_team = ?, role_alignment = ?, status = ? WHERE game_id = ? AND player_name = ?',
                [assignedRoleDetails.name, assignedRoleDetails.team, assignedRoleDetails.alignment, 'alive', game.gameId, playerName]
            );
            // Also update the local game.playersInGame for the response and immediate use
            newPlayersInGameData[playerName] = { 
                id: playerId, 
                roleName: assignedRoleDetails.name, 
                roleDetails: assignedRoleDetails, 
                status: 'alive' 
            };
            if (assignedRoleDetails.name === "Seer") game.seerPlayerName = playerName;
        }
        
        await connection.execute(
            'UPDATE games SET current_phase = ?, seer_player_name = ?, werewolf_night_target = NULL WHERE game_id = ?',
            ['roles_assigned', game.seerPlayerName, game.gameId]
        );
        await connection.commit();

        game.playersInGame = newPlayersInGameData; 
        game.currentPhase = 'roles_assigned'; 
        game.werewolfNightTarget = null;

        console.log('Roles assigned for (DB)', game.gameId);
        res.status(200).json(game); // Return full game state
    } catch (error) {
        await connection.rollback();
        console.error("Error assigning roles in DB:", error);
        res.status(500).json({message: "Failed to assign roles."});
    } finally {
        connection.release();
    }
});

// Other endpoints like player-status, phase, action, voting will need similar DB refactoring.
// For brevity, these are left as they were, operating on the in-memory `games` object,
// which is loaded from DB by GET /api/games/:gameId. This means their changes are not yet persistent
// unless explicitly saved back after each call. True persistence requires them to write to DB.

app.post('/api/games/:gameId/player-status', (req, res) => {
    const game = games[req.params.gameId]; // Operates on in-memory copy
    const { playerName, status } = req.body;
    if (!game || !game.playersInGame[playerName]) return res.status(404).json({ message: 'Game or player not found.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Game already finished.' });
    if (status !== 'alive' && status !== 'eliminated') return res.status(400).json({ message: 'Invalid status.' });
    
    game.playersInGame[playerName].status = status; // Update in-memory
    console.log('Status for', playerName, 'in', game.gameId, 'to', status, '(in-memory, needs DB save)');
    
    checkWinConditions(game); // This will update game.gameWinner and broadcast if game ends
                              // If it updates game.gameWinner, that needs to be saved to DB.
    // TODO: Save game state (at least player status, currentPhase, gameWinner) to DB here.
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/phase', (req, res) => {
    const game = games[req.params.gameId]; // Operates on in-memory
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

    if (phase === 'night') {
        game.werewolfNightTarget = null; 
        game.playersOnTrial = []; game.votes = {}; 
    } else if (phase === 'day') {
        if (previousPhase === 'night' && game.werewolfNightTarget && game.playersInGame[game.werewolfNightTarget]) {
            if (game.playersInGame[game.werewolfNightTarget].status === 'alive') {
                game.playersInGame[game.werewolfNightTarget].status = 'eliminated'; // In-memory update
                eliminationResult.eliminatedPlayerName = game.werewolfNightTarget; 
                game.gameLog.push(game.werewolfNightTarget + " was eliminated by werewolves.");
                checkWinConditions(game); 
            } else { eliminationResult.specialInfo = game.werewolfNightTarget + " was already eliminated."; }
        } else if (previousPhase === 'night') { eliminationResult.specialInfo = "No one was eliminated by werewolves."; }
        if (!game.gameWinner) checkWinConditions(game);
        game.werewolfNightTarget = null; game.playersOnTrial = []; game.votes = {}; 
    }
    
    game.eliminationResult = eliminationResult;
    // TODO: Save updated game (currentPhase, werewolfNightTarget, playersOnTrial, votes, player statuses, gameWinner) to DB
    console.log("Phase for " + game.gameId + " to " + game.currentPhase + " (in-memory, needs DB save)");
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/action', (req, res) => {
    const game = games[req.params.gameId]; // In-memory
    const { actionType, targetPlayerName } = req.body;
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'night') return res.status(400).json({ message: "Actions only at night." });

    if (actionType === 'seerCheck') { /* ... as before ... */ 
        if (!targetPlayerName || !game.playersInGame[targetPlayerName] || !game.playersInGame[targetPlayerName].roleDetails) {
             return res.status(400).json({ message: "Invalid Seer target or target has no role details." });
        }
        const targetData = game.playersInGame[targetPlayerName];
        const alignmentMessage = targetData.roleDetails.alignment === "Werewolf" ? "Is a Werewolf" : "Not a Werewolf";
        return res.status(200).json({ alignmentMessage });
    } else if (actionType === 'werewolfTarget') { /* ... as before ... */
        if (!targetPlayerName || !game.playersInGame[targetPlayerName] || game.playersInGame[targetPlayerName].status !== 'alive') return res.status(400).json({ message: "Invalid WW target." });
        if (game.playersInGame[targetPlayerName].roleName === "Werewolf") return res.status(400).json({ message: "WWs can't target WWs." });
        game.werewolfNightTarget = targetPlayerName; // In-memory update
        // TODO: Save game.werewolfNightTarget to DB for this game
        console.log("WWs targeted " + targetPlayerName + " in game " + game.gameId + " (in-memory, needs DB save)");
        return res.status(200).json({ message: "WW target recorded: " + targetPlayerName });
    }
    return res.status(400).json({ message: "Unknown action." });
});

// Voting endpoints (start-vote, update-vote, clear-votes, process-elimination)
// These currently update the in-memory `game` object. They need to be refactored
// to update the `games` table (for currentPhase, playersOnTrial, votes) and
// `game_players` table (for status on elimination).

app.post('/api/games/:gameId/start-vote', (req, res) => {
    const game = games[req.params.gameId];
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
    // TODO: Save game (currentPhase, playersOnTrial, votes) to DB
    console.log("Voting started for:", playerNamesOnTrial, "in game", game.gameId, "(in-memory, needs DB save)");
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/update-vote', (req, res) => {
    const game = games[req.params.gameId];
    const { playerName, change } = req.body;
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Not in voting phase." });
    if (!game.playersOnTrial.includes(playerName)) return res.status(400).json({ message: "Player not on trial." });
    
    game.votes[playerName] = (game.votes[playerName] || 0) + parseInt(change);
    if (game.votes[playerName] < 0) game.votes[playerName] = 0; 
    // TODO: Save game.votes to DB
    console.log("Vote updated for", playerName, "to", game.votes[playerName], "in game", game.gameId, "(in-memory, needs DB save)");
    res.status(200).json({ votes: game.votes }); 
});

app.post('/api/games/:gameId/clear-votes', (req, res) => {
    const game = games[req.params.gameId];
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Not in voting phase." });
    
    game.playersOnTrial.forEach(name => game.votes[name] = 0);
    // TODO: Save game.votes (cleared) to DB
    console.log("Votes cleared for trial in game", game.gameId, "(in-memory, needs DB save)");
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/process-elimination', (req, res) => {
    const game = games[req.params.gameId]; // In-memory
    const { eliminatedPlayerName } = req.body; 
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Can only process from voting phase." });

    let actualEliminationMessage = "No one was eliminated by vote."; 
    if (eliminatedPlayerName && game.playersInGame[eliminatedPlayerName] && game.playersInGame[eliminatedPlayerName].status === 'alive') {
        game.playersInGame[eliminatedPlayerName].status = 'eliminated'; // In-memory update
        actualEliminationMessage = eliminatedPlayerName + " was eliminated by vote.";
        game.gameLog.push(actualEliminationMessage);
        // TODO: Update player status in game_players table
        checkWinConditions(game); // This will update game.gameWinner and broadcast if game ends
                                // and potentially save gameWinner/currentPhase to DB
    } else if (eliminatedPlayerName) { /* ... */ }
    
    game.currentPhase = 'day'; game.playersOnTrial = []; game.votes = {};
    // TODO: Save game (currentPhase, playersOnTrial, votes) to DB
    console.log("Elimination processed for", game.gameId, "(in-memory, needs DB save)");
    const gameResponse = {...game, eliminationOutcome: actualEliminationMessage };
    res.status(200).json(gameResponse); 
});


// --- HTTP Server Setup ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/moderator.html', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
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
});
console.log('Initializing server... Version: ' + SERVER_VERSION);
// --- End of server.js ---
