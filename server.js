// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install `express` and `ws`: npm install express ws
// 3. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express'); 

const app = express(); 
app.use(express.json()); 

// --- In-Memory Data Stores ---
let masterPlayerList = []; // Array of player objects { id: string, name: string }
let games = {}; 
// Example game structure:
// games[gameId] = {
//   gameId: "game_xyz",
//   gameName: "My Werewolf Game",
//   playersInGame: { // Object keyed by player NAME for easy lookup during game logic
//     "Alice": { roleName: "Seer", roleDetails: {...}, status: "alive", id: "player_abc" },
//     "Bob": { roleName: "Werewolf", roleDetails: {...}, status: "alive", id: "player_def" }
//   },
//   playerOrder: ["Alice", "Bob"], // To maintain an order if needed
//   currentPhase: "setup", // 'setup', 'night', 'day', 'voting', 'finished'
//   rolesAvailable: { ...ALL_ROLES_SERVER }, // Can be customized per game if needed
//   gameLog: [],
//   seerPlayerName: "Alice", // Name of the player who is the Seer
//   werewolfNightTarget: null, // Name of the player targeted by werewolves
//   settings: { /* game-specific settings */ }
// };


const ALL_ROLES_SERVER = {
    VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
    WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
    SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
};

// --- API Endpoints ---

// Master Player List
app.get('/api/master-players', (req, res) => {
    res.json(masterPlayerList);
});

app.post('/api/master-players', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ message: 'Player name is required.' });
    }
    const trimmedName = name.trim();
    if (masterPlayerList.find(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
        return res.status(409).json({ message: 'Player already exists in master list.' });
    }
    const newPlayer = { id: 'player_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7), name: trimmedName };
    masterPlayerList.push(newPlayer);
    console.log('Added to master player list:', newPlayer);
    res.status(201).json(newPlayer);
});

// Game Management
app.get('/api/games', (req, res) => {
    const gameList = Object.values(games).map(game => ({
        gameId: game.gameId,
        gameName: game.gameName,
        playerCount: Object.keys(game.playersInGame || {}).length,
        currentPhase: game.currentPhase
    }));
    res.json(gameList);
});

app.post('/api/games', (req, res) => {
    const { gameName } = req.body;
    const newGameId = 'game_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newGame = {
        gameId: newGameId,
        gameName: gameName || 'Werewolf Game ' + (Object.keys(games).length + 1),
        playersInGame: {}, // Stores player objects: { roleName, roleDetails, status, id } keyed by player name
        playerOrder: [],   // Array of player names to maintain order
        currentPhase: 'setup',
        rolesAvailable: JSON.parse(JSON.stringify(ALL_ROLES_SERVER)), // Deep copy
        gameLog: [],
        seerPlayerName: null,
        werewolfNightTarget: null,
    };
    games[newGameId] = newGame;
    console.log('New game created:', newGame.gameName, '(ID:', newGameId, ')');
    res.status(201).json({ gameId: newGame.gameId, gameName: newGame.gameName });
});

app.get('/api/games/:gameId', (req, res) => {
    const game = games[req.params.gameId];
    if (game) {
        res.json(game);
    } else {
        res.status(404).json({ message: 'Game not found.' });
    }
});

// Endpoint to add/remove players from a specific game
app.post('/api/games/:gameId/players', (req, res) => {
    const game = games[req.params.gameId];
    const { players: playerNames } = req.body; // Expecting an array of player names

    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (!Array.isArray(playerNames)) return res.status(400).json({ message: 'Invalid player list format.' });

    // Reconstruct playersInGame and playerOrder based on the new list of names
    const newPlayersInGame = {};
    const newPlayerOrder = [];

    playerNames.forEach(name => {
        const masterPlayer = masterPlayerList.find(mp => mp.name === name);
        if (masterPlayer) {
            // If player was already in game, keep their existing role/status if game has started
            // For now, if roles are assigned, this might reset them. 
            // This endpoint is primarily for player *selection* before roles are assigned.
            // Or, if roles are assigned, it should only allow adding, not removing easily to avoid state issues.
            // For simplicity in this step, we'll assume this is for initial player setup or
            // that roles would be reassigned if the player list changes significantly.
            newPlayersInGame[name] = game.playersInGame[name] || { // Preserve existing player data if any
                id: masterPlayer.id,
                roleName: null, 
                roleDetails: null,
                status: 'alive' 
            };
            newPlayerOrder.push(name);
        }
    });
    
    game.playersInGame = newPlayersInGame;
    game.playerOrder = newPlayerOrder;

    console.log('Updated players for game ' + game.gameId + ':', game.playerOrder);
    res.status(200).json({ message: 'Player list updated.', playersInGame: game.playersInGame, playerOrder: game.playerOrder });
});


// --- HTTP Server Setup (with Express) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/moderator', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/moderator.html', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'display.html')));
app.get('/display.html', (req, res) => res.sendFile(path.join(__dirname, 'display.html')));

app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ message: 'API endpoint not found: ' + req.path });
    }
    res.status(404).send('Resource not found: ' + req.url);
});

const server = http.createServer(app); 

// --- WebSocket Server ---
const wss = new WebSocket.Server({ server }); 
const clients = new Set();

wss.on('error', (error) => {
    console.error('[WebSocket Server Error]', error);
    if (error.code === 'EADDRINUSE') {
        let portInUse = process.env.PORT || 8080;
        if (server && server.address() && server.address().port) {
            portInUse = server.address().port;
        }
        console.error('Failed to start server: Port ' + portInUse + ' is already in use.');
    } else {
        console.error('An unexpected error occurred with the WebSocket server.');
    }
    if (error.code === 'EADDRINUSE') process.exit(1);
});

wss.on('connection', function connection(ws, req) {
    try {
        const clientIp = req.socket ? req.socket.remoteAddress : 'unknown IP';
        console.log('Attempting to handle new WS connection from ' + clientIp + '.');
        clients.add(ws);
        console.log('Client from ' + clientIp + ' added to WS set. Total clients: ' + clients.size);

        ws.on('message', function incoming(message) {
            try {
                const messageString = message.toString();
                console.log('WS Received from (' + clientIp + '): ' + messageString);
                let parsedMessage;
                try {
                    parsedMessage = JSON.parse(messageString);
                } catch (e) {
                    console.warn('WS Received non-JSON message from (' + clientIp + '): ' + messageString);
                    return;
                }
                // Relay WebSocket messages to all clients (display primarily)
                // Add gameId to the message if it's not there, for context (though client should send it)
                if (!parsedMessage.gameId && parsedMessage.type !== 'system_message') { // Example: don't add to generic system messages
                    // This assumes the moderator client knows the current gameId and includes it.
                    // If not, the server might need a way to associate WS connections with games.
                    console.warn("WS message received without gameId:", parsedMessage);
                }

                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(parsedMessage));
                    }
                });
            } catch (e) {
                console.error('Error in WS "message" handler for (' + clientIp + '):', e);
            }
        });

        ws.on('close', (code, reason) => {
            const reasonString = reason.toString();
            console.log('Client (' + clientIp + ') WS disconnected. Code: ' + code + ', Reason: "' + reasonString + '".');
            clients.delete(ws);
            console.log('Client from (' + clientIp + ') removed from WS set. Total clients: ' + clients.size);
        });
        ws.on('error', (error) => console.error('WebSocket error on client (' + clientIp + '):', error));
        console.log('Successfully set up WS event handlers for client (' + clientIp + ').');
    } catch (e) {
        console.error('FATAL ERROR in wss.on("connection") handler:', e);
        if (ws && typeof ws.terminate === 'function') ws.terminate();
    }
});

// Start the HTTP server
const port = process.env.PORT || 8080;
server.listen(port, () => {
    console.log('HTTP and WebSocket server running on port ' + port);
    console.log('Moderator panel: http://localhost:' + port + '/');
    console.log('Display panel: http://localhost:' + port + '/display.html');
});

console.log('Initializing Werewolf Game server...');
// --- End of server.js ---
