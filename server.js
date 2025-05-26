// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install `express` and `ws`: npm install express ws
// 3. Install `mysql2`: npm install mysql2
// 4. Set up your MariaDB/MySQL database and environment variables.
// 5. Create the `master_players`, `sessions`, and `games` tables using SQL.
// 6. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express'); 
const mysql = require('mysql2/promise'); 

const app = express(); 
app.use(express.json()); 

const SERVER_VERSION = "0.10.5"; // Updated server version

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

/* SQL to create tables:
CREATE TABLE IF NOT EXISTS master_players (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    session_name VARCHAR(255) NOT NULL,
    session_date DATE NOT NULL,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
   game_id VARCHAR(255) PRIMARY KEY,
   session_id VARCHAR(255) NOT NULL,
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
   is_archived BOOLEAN DEFAULT FALSE,      
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE 
);

CREATE TABLE IF NOT EXISTS game_players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    game_id VARCHAR(255) NOT NULL,
    player_id VARCHAR(255) NOT NULL, 
    player_name VARCHAR(255) NOT NULL, 
    role_name VARCHAR(255) NULL,
    role_team VARCHAR(50) NULL,
    role_alignment VARCHAR(50) NULL,
    status VARCHAR(50) DEFAULT 'alive',
    FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES master_players(id) ON DELETE RESTRICT, 
    UNIQUE KEY unique_player_in_game (game_id, player_id) 
);
*/

// --- In-Memory Data Store for Games (caches loaded games) ---
let gamesCache = {}; 

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
                    roleDetails: pDetail.role_name ? (ALL_ROLES_SERVER[Object.keys(ALL_ROLES_SERVER).find(key => ALL_ROLES_SERVER[key].name === pDetail.role_name)] || {name: pDetail.role_name, team: pDetail.role_team, alignment: pDetail.role_alignment, description: "Config missing."}) : null,
                    status: pDetail.status
                };
            }
        });
         playerDetailRows.forEach(p => { if (!playersInGameFromDB[p.player_name]) { playersInGameFromDB[p.player_name] = {id: p.player_id,roleName: p.role_name,roleDetails: p.role_name ? (ALL_ROLES_SERVER[Object.keys(ALL_ROLES_SERVER).find(key => ALL_ROLES_SERVER[key].name === p.role_name)] || {name: p.role_name, team: p.role_team, alignment: p.role_alignment, description: "Config missing."}) : null,status: p.status};}});

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
        gamesCache[gameId] = fullGameData; // Update cache
        return fullGameData;
    } catch (error) {
        console.error("Error in fetchGameFromDB for " + gameId + ":", error);
        return null;
    }
}


// --- API Endpoints ---
app.get('/api/version', (req, res) => res.json({ version: SERVER_VERSION }));
app.get('/api/master-players', async (req, res) => { /* ... same as before ... */ });
app.post('/api/master-players', async (req, res) => { /* ... same as before ... */ });

// --- Session API Endpoints ---
app.get('/api/sessions', async (req, res) => { /* ... same as before ... */ });
app.post('/api/sessions', async (req, res) => { /* ... same as before ... */ });

app.put('/api/sessions/:sessionId', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { sessionId } = req.params;
    const { sessionName, sessionDate } = req.body;
    if (!sessionName && !sessionDate) {
        return res.status(400).json({ message: "Nothing to update (provide sessionName or sessionDate)." });
    }
    try {
        let query = 'UPDATE sessions SET ';
        const params = [];
        let updatedFields = 0;
        if (sessionName) { query += 'session_name = ? '; params.push(sessionName); updatedFields++;}
        if (sessionDate) { query += (params.length > 0 ? ', ' : '') + 'session_date = ? '; params.push(sessionDate); updatedFields++;}
        
        if(updatedFields === 0) return res.status(400).json({ message: "No valid fields to update." });

        query += 'WHERE session_id = ? AND is_archived = FALSE'; 
        params.push(sessionId);

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
app.get('/api/sessions/:sessionId/games', async (req, res) => { /* ... same as before ... */ });
app.post('/api/sessions/:sessionId/games', async (req, res) => { /* ... same as before ... */ });
app.delete('/api/games/:gameId', async (req, res) => { /* ... same as before ... */ });

app.get('/api/games/:gameId', async (req, res) => {
    const gameData = await fetchGameFromDB(req.params.gameId);
    if (gameData) {
        res.json(gameData);
    } else {
        res.status(404).json({ message: 'Game not found or is archived.' });
    }
});

app.post('/api/games/:gameId/players', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/assign-roles', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/player-status', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/phase', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/action', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/start-vote', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/update-vote', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/clear-votes', async (req, res) => { /* ... same as before ... */ });
app.post('/api/games/:gameId/process-elimination', async (req, res) => { /* ... same as before ... */ });


// --- HTTP Server Setup & WebSocket ---
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