// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install `express` and `ws`: npm install express ws
// 3. Install `mysql2`: npm install mysql2
// 4. Set up your MariaDB/MySQL database and environment variables.
// 5. Create the `master_players` table using the SQL in the comments below.
// 6. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express'); 
const mysql = require('mysql2/promise'); // Using the promise-based API

const app = express(); 
app.use(express.json()); 

const SERVER_VERSION = "0.9.0"; 

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
        queueLimit: 0
    });
    console.log("Successfully created MariaDB connection pool.");

    // Test connection
    pool.getConnection()
        .then(connection => {
            console.log("Successfully connected to MariaDB!");
            connection.release();
        })
        .catch(err => {
            console.error("Error connecting to MariaDB:", err);
            // process.exit(1); // Optionally exit if DB connection fails critically
        });

} catch (error) {
    console.error("Failed to create MariaDB connection pool:", error);
    // process.exit(1); // Exit if pool creation fails
}


/*
SQL to create the master_players table (run this in phpMyAdmin or similar tool):

CREATE TABLE master_players (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

Basic placeholder for games table (more detail needed for full game state persistence):
CREATE TABLE games (
   game_id VARCHAR(255) PRIMARY KEY,
   game_name VARCHAR(255) NOT NULL,
   current_phase VARCHAR(50) DEFAULT 'setup',
   game_winner_team VARCHAR(50),
   game_winner_reason TEXT,
   -- For complex nested data like playersInGame, roles, votes, etc.,
   -- you'll likely need additional related tables (e.g., game_players, game_votes)
   -- OR use JSON columns if your MariaDB version supports them well and you prefer that.
   -- For now, playersInGame, playerOrder etc. are still in-memory for the `games` object.
   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

*/


// --- In-Memory Data Stores (Games data is still in-memory for now) ---
// let masterPlayerList = []; // This is now in the database
let games = {}; // Game state will be migrated to DB in future steps

const ALL_ROLES_SERVER = {
    VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
    WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
    SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
};

// --- Helper Functions ---
async function getMasterPlayerByNameDB(playerName) {
    if (!playerName || !pool) return null;
    try {
        const [rows] = await pool.execute('SELECT * FROM master_players WHERE LOWER(name) = LOWER(?)', [playerName.trim()]);
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


function checkWinConditions(game) {
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
         return game.gameWinner;
    }
    
    const aliveWerewolves = alivePlayersWithRoles.filter(name => game.playersInGame[name].roleDetails.alignment === "Werewolf");
    const aliveNonWerewolves = alivePlayersWithRoles.filter(name => game.playersInGame[name].roleDetails.alignment !== "Werewolf");

    if (aliveWerewolves.length === 0 && aliveNonWerewolves.length > 0 && rolesAssigned) { 
        game.gameWinner = { team: "Village", reason: "All werewolves have been eliminated." };
        game.currentPhase = 'finished';
        console.log("SERVER: Game " + game.gameId + " ended: Village wins. Broadcasting game_over.");
        broadcastToGameClients(game.gameId, {type: 'game_over', payload: { ...game.gameWinner, gameId: game.gameId} });
        return game.gameWinner;
    }
    if (aliveWerewolves.length > 0 && aliveWerewolves.length >= aliveNonWerewolves.length && rolesAssigned) { 
        game.gameWinner = { team: "Werewolves", reason: "Werewolves have overwhelmed the village." };
        game.currentPhase = 'finished';
        console.log("SERVER: Game " + game.gameId + " ended: Werewolves win. Broadcasting game_over.");
        broadcastToGameClients(game.gameId, {type: 'game_over', payload: { ...game.gameWinner, gameId: game.gameId} });
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
        const existingPlayer = await getMasterPlayerByNameDB(trimmedName);
        if (existingPlayer) {
            return res.status(409).json({ message: 'Player already exists in master list.' });
        }
        const newPlayerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        await pool.execute('INSERT INTO master_players (id, name) VALUES (?, ?)', [newPlayerId, trimmedName]);
        
        const newPlayer = { id: newPlayerId, name: trimmedName }; // Construct object to return
        console.log('Added to master player list (DB):', newPlayer);
        res.status(201).json(newPlayer);
    } catch (error) {
        console.error("Error adding player to DB:", error);
        if (error.code === 'ER_DUP_ENTRY') { // Catch unique constraint violation specifically
             return res.status(409).json({ message: 'Player already exists in master list (DB constraint).' });
        }
        res.status(500).json({ message: "Failed to add player to master list." });
    }
});

app.get('/api/games', (req, res) => {
    const gameList = Object.values(games).map(g => ({ 
        gameId: g.gameId, 
        gameName: g.gameName, 
        playerCount: g.playerOrder ? g.playerOrder.length : 0, 
        currentPhase: g.currentPhase,
        gameWinner: g.gameWinner 
    }));
    res.json(gameList);
});

app.post('/api/games', (req, res) => {
    const { gameName } = req.body;
    const newGameId = 'game_' + Date.now();
    games[newGameId] = {
        gameId: newGameId, gameName: gameName || 'Game ' + (Object.keys(games).length + 1),
        playersInGame: {}, playerOrder: [], currentPhase: 'setup', gameLog: [],
        seerPlayerName: null, werewolfNightTarget: null, playersOnTrial: [], votes: {}, gameWinner: null
    };
    console.log('New game (in-memory):', games[newGameId].gameName);
    res.status(201).json({ gameId: newGameId, gameName: games[newGameId].gameName });
});

app.get('/api/games/:gameId', (req, res) => {
    const game = games[req.params.gameId];
    if (game) {
        if (!game.playersInGame) game.playersInGame = {};
        if (!game.playerOrder) game.playerOrder = [];
        if (!game.playersOnTrial) game.playersOnTrial = [];
        if (!game.votes) game.votes = {};
        res.json(game);
    } else res.status(404).json({ message: 'Game not found.' });
});

app.post('/api/games/:gameId/players', async (req, res) => { // Made async for potential DB ops later
    const game = games[req.params.gameId];
    const { players: playerNamesFromClient } = req.body;
    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Cannot modify players, game already finished.' });
    if (!Array.isArray(playerNamesFromClient)) return res.status(400).json({ message: 'Invalid player list.' });

    const newPlayersInGame = {}; const newPlayerOrder = [];
    for (const name of playerNamesFromClient) { // Use for...of for async/await if needed inside loop later
        const masterPlayer = await getMasterPlayerByNameDB(name); // Use DB helper
        if (masterPlayer) {
            newPlayersInGame[name] = game.playersInGame[name] || { id: masterPlayer.id, roleName: null, roleDetails: null, status: 'alive' };
            newPlayerOrder.push(name);
        }
    }
    game.playersInGame = newPlayersInGame; game.playerOrder = newPlayerOrder;
    if (game.seerPlayerName && !game.playersInGame[game.seerPlayerName]) game.seerPlayerName = null;
    if (game.werewolfNightTarget && !game.playersInGame[game.werewolfNightTarget]) game.werewolfNightTarget = null;
    console.log('Players updated for game', game.gameId);
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/assign-roles', async (req, res) => { // Made async
    const game = games[req.params.gameId];
    if (!game || !game.playerOrder || game.playerOrder.length === 0) return res.status(400).json({ message: 'No players.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Game already finished.' });

    let rolesToAssign = []; game.seerPlayerName = null;
    const numPlayers = game.playerOrder.length;
    if (numPlayers >= 1) rolesToAssign.push(ALL_ROLES_SERVER.WEREWOLF);
    if (numPlayers >= 3) rolesToAssign.push(ALL_ROLES_SERVER.SEER);
    while (rolesToAssign.length < numPlayers) rolesToAssign.push(ALL_ROLES_SERVER.VILLAGER);
    for (let i = rolesToAssign.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rolesToAssign[i], rolesToAssign[j]] = [rolesToAssign[j], rolesToAssign[i]]; }
    
    const newPlayersInGameData = {};
    for (const [index, playerName] of game.playerOrder.entries()) { // Use for...of for async
        const assignedRoleDetails = rolesToAssign[index];
        const masterPlayer = await getMasterPlayerByNameDB(playerName); // Use DB helper
        newPlayersInGameData[playerName] = { id: masterPlayer ? masterPlayer.id : 'uid_' + playerName, roleName: assignedRoleDetails.name, roleDetails: assignedRoleDetails, status: 'alive' };
        if (assignedRoleDetails.name === "Seer") game.seerPlayerName = playerName;
    }
    game.playersInGame = newPlayersInGameData; game.currentPhase = 'roles_assigned'; game.werewolfNightTarget = null;
    console.log('Roles assigned for', game.gameId);
    res.status(200).json(game);
});

app.post('/api/games/:gameId/player-status', (req, res) => {
    const game = games[req.params.gameId];
    const { playerName, status } = req.body;
    if (!game || !game.playersInGame[playerName]) return res.status(404).json({ message: 'Game or player not found.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Game already finished.' });
    if (status !== 'alive' && status !== 'eliminated') return res.status(400).json({ message: 'Invalid status.' });
    
    game.playersInGame[playerName].status = status;
    console.log('Status for', playerName, 'in', game.gameId, 'to', status);
    
    checkWinConditions(game); 
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/phase', (req, res) => {
    const game = games[req.params.gameId];
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
        console.log("Game " + game.gameId + " phase changed to NIGHT");
    } else if (phase === 'day') {
        console.log("Game " + game.gameId + " phase changed to DAY from " + previousPhase);
        if (previousPhase === 'night' && game.werewolfNightTarget && game.playersInGame[game.werewolfNightTarget]) {
            if (game.playersInGame[game.werewolfNightTarget].status === 'alive') {
                game.playersInGame[game.werewolfNightTarget].status = 'eliminated';
                eliminationResult.eliminatedPlayerName = game.werewolfNightTarget; 
                game.gameLog.push(game.werewolfNightTarget + " was eliminated by werewolves.");
                console.log(game.werewolfNightTarget + " eliminated by WW in " + game.gameId);
                checkWinConditions(game); 
            } else {
                eliminationResult.specialInfo = game.werewolfNightTarget + " was already eliminated.";
                 console.log(game.werewolfNightTarget + " was already targeted but is eliminated in game " + game.gameId);
            }
        } else if (previousPhase === 'night') { 
            eliminationResult.specialInfo = "No one was eliminated by werewolves.";
            console.log("No werewolf elimination in game " + game.gameId + " (target: " + game.werewolfNightTarget + ")");
        }
        
        if (!game.gameWinner) { 
             checkWinConditions(game);
        }
        
        game.werewolfNightTarget = null; 
        game.playersOnTrial = []; game.votes = {}; 
    }
    
    game.eliminationResult = eliminationResult; 
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/action', (req, res) => {
    const game = games[req.params.gameId];
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
        console.log("Seer check on", targetPlayerName, "in", game.gameId, ":", alignmentMessage);
        return res.status(200).json({ alignmentMessage });
    } else if (actionType === 'werewolfTarget') {
        if (!targetPlayerName || !game.playersInGame[targetPlayerName] || game.playersInGame[targetPlayerName].status !== 'alive') return res.status(400).json({ message: "Invalid WW target." });
        if (game.playersInGame[targetPlayerName].roleName === "Werewolf") return res.status(400).json({ message: "WWs can't target WWs." });
        game.werewolfNightTarget = targetPlayerName;
        console.log("WWs targeted", targetPlayerName, "in", game.gameId);
        return res.status(200).json({ message: "WW target recorded: " + targetPlayerName });
    }
    return res.status(400).json({ message: "Unknown action." });
});

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
    console.log("Voting started for:", playerNamesOnTrial, "in game", game.gameId);
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
    
    console.log("Vote updated for", playerName, "to", game.votes[playerName], "in game", game.gameId);
    res.status(200).json({ votes: game.votes }); 
});

app.post('/api/games/:gameId/clear-votes', (req, res) => {
    const game = games[req.params.gameId];
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Not in voting phase." });
    
    game.playersOnTrial.forEach(name => game.votes[name] = 0);
    console.log("Votes cleared for trial in game", game.gameId);
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/process-elimination', (req, res) => {
    const game = games[req.params.gameId];
    const { eliminatedPlayerName } = req.body; 
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.gameWinner) return res.status(400).json({ message: "Game is already finished."});
    if (game.currentPhase !== 'voting') return res.status(400).json({ message: "Can only process from voting phase." });

    let actualEliminationMessage = "No one was eliminated by vote."; 
    if (eliminatedPlayerName && game.playersInGame[eliminatedPlayerName] && game.playersInGame[eliminatedPlayerName].status === 'alive') {
        game.playersInGame[eliminatedPlayerName].status = 'eliminated';
        actualEliminationMessage = eliminatedPlayerName + " was eliminated by vote.";
        game.gameLog.push(actualEliminationMessage);
        console.log(actualEliminationMessage + " In game " + game.gameId);
        checkWinConditions(game);
    } else if (eliminatedPlayerName) {
        actualEliminationMessage = "Attempted to eliminate " + eliminatedPlayerName + ", but they were not found or not alive.";
        console.log(actualEliminationMessage);
    }
    
    game.currentPhase = 'day'; 
    game.playersOnTrial = [];
    game.votes = {};

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
        // console.log('WS Received:', messageString); 
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
