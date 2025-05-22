// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install `express` and `ws`: npm install express ws
// 3. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express'); // Added Express

const app = express(); // Create an Express application
app.use(express.json()); // Middleware to parse JSON request bodies

// --- In-Memory Data Stores (for persistence foundation) ---
let masterPlayerList = []; // Array of player objects { id: uniqueId, name: "PlayerName" }
let games = {}; // Object to store game states, keyed by gameId
                // game: { gameId, gameName, playersInGame: { playerName: {role, status, etc.}}, currentPhase, log, ... }

// --- API Endpoints ---

// Master Player List
app.get('/api/master-players', (req, res) => {
    res.json(masterPlayerList);
});

app.post('/api/master-players', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ message: 'Player name is required and must be a non-empty string.' });
    }
    const trimmedName = name.trim();
    if (masterPlayerList.find(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
        return res.status(409).json({ message: 'Player with this name already exists in the master list.' });
    }
    const newPlayer = { id: 'player_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7), name: trimmedName };
    masterPlayerList.push(newPlayer);
    console.log('Added to master player list:', newPlayer);
    res.status(201).json(newPlayer);
});

// Game Management
app.get('/api/games', (req, res) => {
    // Return a simplified list of games for selection
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
        playersInGame: {}, // { playerName: { roleName, roleDetails, status: 'alive' } }
        currentPhase: 'setup', // 'setup', 'night', 'day', 'voting', 'finished'
        rolesAvailable: { ...ALL_ROLES_SERVER }, // Copy of available roles for this game instance if needed
        gameLog: [],
        seerPlayerName: null,
        werewolfNightTarget: null,
        // Add other game-specific state holders here
    };
    games[newGameId] = newGame;
    console.log('New game created:', newGame.gameName, '(ID:', newGameId, ')');
    res.status(201).json({ gameId: newGame.gameId, gameName: newGame.gameName });
});

// Placeholder for ALL_ROLES on server-side if needed for game creation logic
const ALL_ROLES_SERVER = {
    VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
    WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
    SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
};


// --- HTTP Server Setup (with Express) ---
// Serve static HTML files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/moderator', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/moderator.html', (req, res) => res.sendFile(path.join(__dirname, 'moderator.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'display.html')));
app.get('/display.html', (req, res) => res.sendFile(path.join(__dirname, 'display.html')));

// Fallback for 404 if not an API route and not a known HTML file
// This should come after all other app.get/app.post for specific paths
app.use((req, res, next) => {
    // Check if the request path starts with /api, if so, it means an API route wasn't matched
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ message: 'API endpoint not found: ' + req.path });
    }
    // If not an API route, let it fall through (though ideally all static files are explicitly defined)
    // For a very simple setup, we can just send a generic 404 for non-API, non-HTML routes
    res.status(404).send('Resource not found: ' + req.url);
});


const server = http.createServer(app); // Use Express app to handle HTTP requests

// --- WebSocket Server ---
const wss = new WebSocket.Server({ server }); // Attach WebSocket server to the HTTP server
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