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

const SERVER_VERSION = "0.10.0"; 

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

/*
SQL to create tables:

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
   -- Using ON DELETE CASCADE for games when a session is deleted.
   -- If you prefer to keep games and set session_id to NULL, change to ON DELETE SET NULL.
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
        res.json(sessions.map(s => ({ ...s, session_date: new Date(s.session_date).toISOString().split('T')[0]}))); // Format date
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
    if (!sessionName && !sessionDate) {
        return res.status(400).json({ message: "Nothing to update (provide sessionName or sessionDate)." });
    }
    try {
        let query = 'UPDATE sessions SET ';
        const params = [];
        if (sessionName) { query += 'session_name = ? '; params.push(sessionName); }
        if (sessionDate) { query += (params.length > 0 ? ', ' : '') + 'session_date = ? '; params.push(sessionDate); }
        query += 'WHERE session_id = ?';
        params.push(sessionId);

        const [result] = await pool.execute(query, params);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Session not found." });
        
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
    try {
        // Soft delete: mark as archived
        const [result] = await pool.execute('UPDATE sessions SET is_archived = TRUE WHERE session_id = ?', [sessionId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Session not found." });
        
        // Also archive games within this session
        await pool.execute('UPDATE games SET is_archived = TRUE WHERE session_id = ?', [sessionId]);

        console.log('Session archived:', sessionId);
        res.status(204).send(); // No content
    } catch (error) {
        console.error("Error archiving session " + sessionId + ":", error);
        res.status(500).json({ message: "Failed to archive session." });
    }
});


// --- Game API Endpoints (Now Session-Aware) ---
app.get('/api/sessions/:sessionId/games', async (req, res) => {
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { sessionId } = req.params;
    try {
        // Check if session exists
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
        // Verify session exists
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
        
        // Initialize in-memory representation (though primary source is DB)
        games[newGameId] = {
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

app.delete('/api/games/:gameId', async (req, res) => { // For archiving a game
    if (!pool) return res.status(500).json({ message: "Database not configured." });
    const { gameId } = req.params;
    try {
        const [result] = await pool.execute('UPDATE games SET is_archived = TRUE WHERE game_id = ?', [gameId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Game not found." });
        
        if (games[gameId]) delete games[gameId]; // Remove from in-memory cache if present

        console.log('Game archived:', gameId);
        res.status(204).send();
    } catch (error) {
        console.error("Error archiving game " + gameId + ":", error);
        res.status(500).json({ message: "Failed to archive game." });
    }
});


// GET /api/games/:gameId (Load specific game) - This endpoint remains largely the same,
// as it already fetches detailed game data, including players from game_players.
// The client will use this after selecting a game from the session-specific list.

// POST /api/games/:gameId/players - This endpoint also remains largely the same,
// as it operates on a specific gameId. The client ensures it's for the current game.

// POST /api/games/:gameId/assign-roles - Remains largely the same.
// POST /api/games/:gameId/player-status - Remains largely the same.
// POST /api/games/:gameId/phase - Remains largely the same.
// POST /api/games/:gameId/action - Remains largely the same.
// Voting endpoints - Remain largely the same.

// The core change is that the *list* of games is now filtered by session,
// and game creation is tied to a session. The individual game operations
// continue to use the gameId.


// --- HTTP Server Setup & WebSocket ---
// (This part remains the same as v0.9.3)
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
