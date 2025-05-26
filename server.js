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

const SERVER_VERSION = "0.10.1"; 

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
let gamesCache = {}; // Renamed from 'games' to avoid confusion with DB table name

const ALL_ROLES_SERVER = {
    VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
    WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
    SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
};

// --- Helper Functions ---
async function getMasterPlayerByNameDB(playerName) { /* ... same as before ... */ }
function broadcastToGameClients(gameId, messageObject) { /* ... same as before ... */ }
async function checkWinConditions(game) { /* ... same as before, ensures DB update for winner ... */ }


// --- API Endpoints ---
app.get('/api/version', (req, res) => res.json({ version: SERVER_VERSION }));
app.get('/api/master-players', async (req, res) => { /* ... same as before ... */ });
app.post('/api/master-players', async (req, res) => { /* ... same as before ... */ });

// --- Session API Endpoints ---
app.get('/api/sessions', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    try {
        const [sessions] = await pool.query('SELECT session_id, session_name, session_date FROM sessions WHERE is_archived = FALSE ORDER BY session_date DESC, created_at DESC');
        res.json(sessions.map(s => ({ ...s, session_date: new Date(s.session_date).toISOString().split('T')[0]}))); 
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

app.put('/api/sessions/:sessionId', async (req, res) => { /* ... same as before ... */ });
app.delete('/api/sessions/:sessionId', async (req, res) => { /* ... same as before ... */ });


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
        
        gamesCache[newGameId] = { // Cache the new game
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
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const gameId = req.params.gameId;
    try {
        const [gameRows] = await pool.execute('SELECT * FROM games WHERE game_id = ? AND is_archived = FALSE', [gameId]);
        if (gameRows.length === 0) {
            if (gamesCache[gameId]) delete gamesCache[gameId]; 
            return res.status(404).json({ message: 'Game not found or is archived.' });
        }
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
                    id: pDetail.player_id,
                    roleName: pDetail.role_name,
                    roleDetails: pDetail.role_name ? (ALL_ROLES_SERVER[Object.keys(ALL_ROLES_SERVER).find(key => ALL_ROLES_SERVER[key].name === pDetail.role_name)] || {name: pDetail.role_name, team: pDetail.role_team, alignment: pDetail.role_alignment, description: "Role details not found in config."}) : null,
                    status: pDetail.status
                };
            }
        });
        playerDetailRows.forEach(p => { 
            if (!playersInGameFromDB[p.player_name]) {
                 playersInGameFromDB[p.player_name] = {
                    id: p.player_id,
                    roleName: p.role_name,
                    roleDetails: p.role_name ? (ALL_ROLES_SERVER[Object.keys(ALL_ROLES_SERVER).find(key => ALL_ROLES_SERVER[key].name === p.role_name)] || {name: p.role_name, team: p.role_team, alignment: p.role_alignment, description: "Role details not found in config."}) : null,
                    status: p.status
                };
            }
        });
        
        const fullGameData = {
            gameId: gameDataFromDB.game_id,
            sessionId: gameDataFromDB.session_id,
            gameName: gameDataFromDB.game_name,
            currentPhase: gameDataFromDB.current_phase,
            seerPlayerName: gameDataFromDB.seer_player_name,
            werewolfNightTarget: gameDataFromDB.werewolf_night_target,
            playersOnTrial: gameDataFromDB.players_on_trial ? JSON.parse(gameDataFromDB.players_on_trial) : [],
            votes: gameDataFromDB.votes ? JSON.parse(gameDataFromDB.votes) : {},
            playerOrder: playerOrder.length > 0 ? playerOrder : Object.keys(playersInGameFromDB), 
            gameWinner: gameDataFromDB.game_winner_team ? { team: gameDataFromDB.game_winner_team, reason: gameDataFromDB.game_winner_reason } : null,
            gameLog: gameDataFromDB.game_log ? JSON.parse(gameDataFromDB.game_log) : [],
            playersInGame: playersInGameFromDB 
        };
        
        gamesCache[gameId] = fullGameData; 
        console.log("SERVER: Loaded game " + gameId + " from DB. Phase: " + fullGameData.currentPhase + ". Players: " + fullGameData.playerOrder.join(', '));
        res.json(fullGameData);

    } catch (error) {
        console.error("Error fetching game " + gameId + " from DB:", error);
        res.status(500).json({ message: "Failed to fetch game." });
    }
});

// --- The rest of the game action API endpoints (/players, /assign-roles, /player-status, /phase, /action, voting) ---
// --- will now primarily operate on the gamesCache[gameId] object for speed, ---
// --- but critically, they MUST write their changes back to the MariaDB database to ensure persistence. ---
// --- This means each of these POST endpoints will now involve DB write operations. ---

// Example for /player-status (others will follow similar pattern)
app.post('/api/games/:gameId/player-status', async (req, res) => {
    const gameId = req.params.gameId;
    const game = gamesCache[gameId]; // Use cache for read-modify-write pattern
    const { playerName, status } = req.body;

    if (!game || !game.playersInGame[playerName]) {
        // Attempt to load from DB if not in cache (e.g., after server restart)
        // This part is complex if we want full resilience without loading all games into memory at start.
        // For now, assume game is loaded into cache via GET /api/games/:gameId first.
        return res.status(404).json({ message: 'Game not loaded in cache or player not found.' });
    }
    if (game.gameWinner) return res.status(400).json({ message: 'Game already finished.' });
    if (status !== 'alive' && status !== 'eliminated') return res.status(400).json({ message: 'Invalid status.' });
    
    game.playersInGame[playerName].status = status; 
    try {
        await pool.execute('UPDATE game_players SET status = ? WHERE game_id = ? AND player_name = ?', [status, gameId, playerName]);
        console.log('Status for', playerName, 'in', gameId, 'to', status, '(DB updated)');
        await checkWinConditions(game); // This will update DB for gameWinner if game ends
        res.status(200).json(game); // Return updated in-memory game state
    } catch (dbError) {
        console.error("Error updating player status in DB for game " + gameId + ":", dbError);
        // Revert in-memory change if DB update fails? Or reload from DB?
        // For simplicity now, we don't revert, client will re-fetch on error.
        res.status(500).json({message: "Failed to update player status in DB."});
    }
});

// TODO: Refactor other game action endpoints (assign-roles, phase, action, voting)
// to use the gamesCache and write changes back to MariaDB similar to player-status.

// --- HTTP Server Setup & WebSocket ---
// (This part remains the same)
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