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

const ALL_ROLES_SERVER = {
    VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
    WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
    SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
};

// --- Helper Functions ---
function getPlayerById(playerId) {
    return masterPlayerList.find(p => p.id === playerId);
}

function getPlayerByName(playerName) {
    return masterPlayerList.find(p => p.name.toLowerCase() === playerName.toLowerCase());
}


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
        playerCount: game.playerOrder ? game.playerOrder.length : 0,
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
        playersInGame: {}, // Keyed by player NAME: { roleName, roleDetails, status, id (from master list) }
        playerOrder: [],   // Array of player names
        currentPhase: 'setup',
        // rolesAvailable: JSON.parse(JSON.stringify(ALL_ROLES_SERVER)), // Not strictly needed if ALL_ROLES_SERVER is const
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
        // Ensure playersInGame is an object, even if empty
        if (!game.playersInGame) game.playersInGame = {};
        if (!game.playerOrder) game.playerOrder = [];
        res.json(game);
    } else {
        res.status(404).json({ message: 'Game not found.' });
    }
});

app.post('/api/games/:gameId/players', (req, res) => {
    const game = games[req.params.gameId];
    const { players: playerNamesFromClient } = req.body; 

    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (!Array.isArray(playerNamesFromClient)) return res.status(400).json({ message: 'Invalid player list format.' });

    const newPlayersInGame = {};
    const newPlayerOrder = [];

    playerNamesFromClient.forEach(name => {
        const masterPlayer = getPlayerByName(name); // Use helper
        if (masterPlayer) {
            // Preserve existing role and status if player was already in game and roles are assigned
            if (game.playersInGame[name] && game.playersInGame[name].roleName) {
                newPlayersInGame[name] = game.playersInGame[name];
            } else { // New player to game, or roles not yet assigned for this player
                newPlayersInGame[name] = { 
                    id: masterPlayer.id,
                    roleName: null, 
                    roleDetails: null, // Will be populated by ALL_ROLES_SERVER details upon assignment
                    status: 'alive' 
                };
            }
            newPlayerOrder.push(name);
        } else {
            console.warn("Player " + name + " from client list not found in master list. Skipping.");
        }
    });
    
    game.playersInGame = newPlayersInGame;
    game.playerOrder = newPlayerOrder;
    // If players are removed, ensure seerPlayerName is still valid
    if (game.seerPlayerName && !game.playersInGame[game.seerPlayerName]) {
        game.seerPlayerName = null;
    }

    console.log('Updated players for game ' + game.gameId + ':', game.playerOrder);
    res.status(200).json({ 
        message: 'Player list updated.', 
        playersInGame: game.playersInGame, 
        playerOrder: game.playerOrder 
    });
});

app.post('/api/games/:gameId/assign-roles', (req, res) => {
    const game = games[req.params.gameId];
    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (!game.playerOrder || game.playerOrder.length === 0) {
        return res.status(400).json({ message: 'No players in the game to assign roles to.' });
    }

    let rolesToAssign = [];
    game.seerPlayerName = null; // Reset before assignment

    // Simplified role distribution (can be made more complex)
    if (game.playerOrder.length >= 1) rolesToAssign.push(ALL_ROLES_SERVER.WEREWOLF);
    if (game.playerOrder.length >= 2) rolesToAssign.push(ALL_ROLES_SERVER.SEER);
    while (rolesToAssign.length < game.playerOrder.length) {
        rolesToAssign.push(ALL_ROLES_SERVER.VILLAGER);
    }

    // Shuffle roles
    for (let i = rolesToAssign.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rolesToAssign[i], rolesToAssign[j]] = [rolesToAssign[j], rolesToAssign[i]];
    }

    const updatedPlayersInGame = { ...game.playersInGame }; // Start with existing player data (like IDs)

    game.playerOrder.forEach((playerName, index) => {
        const assignedRoleDetails = rolesToAssign[index];
        updatedPlayersInGame[playerName] = {
            ...(updatedPlayersInGame[playerName] || {}), // Preserve ID if it exists
            roleName: assignedRoleDetails.name,
            roleDetails: assignedRoleDetails, // Store full role object
            status: 'alive' // Ensure all are alive on role assignment
        };
        if (assignedRoleDetails.name === "Seer") {
            game.seerPlayerName = playerName;
        }
    });
    game.playersInGame = updatedPlayersInGame;
    game.currentPhase = 'roles_assigned'; // Or directly to 'night' if preferred
    
    console.log('Roles assigned for game ' + game.gameId + ':', game.playersInGame);
    res.status(200).json({ message: 'Roles assigned successfully.', playersInGame: game.playersInGame, seerPlayerName: game.seerPlayerName });
});

app.post('/api/games/:gameId/player-status', (req, res) => {
    const game = games[req.params.gameId];
    const { playerName, status } = req.body;

    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (!playerName || !status) return res.status(400).json({ message: 'Player name and status are required.' });
    if (!game.playersInGame[playerName]) return res.status(404).json({ message: 'Player not found in this game.' });
    if (status !== 'alive' && status !== 'eliminated') return res.status(400).json({ message: 'Invalid status.' });

    game.playersInGame[playerName].status = status;
    console.log('Status for ' + playerName + ' in game ' + game.gameId + ' set to ' + status);
    res.status(200).json({ message: 'Player status updated.', player: game.playersInGame[playerName] });
});

// --- Placeholder for Phase and Action Endpoints (to be detailed further) ---
app.post('/api/games/:gameId/phase', (req, res) => {
    const game = games[req.params.gameId];
    const { phase } = req.body; // e.g., 'night', 'day'
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (!phase) return res.status(400).json({ message: "Phase is required" });

    game.currentPhase = phase;
    let eliminationResult = { eliminatedPlayerName: null, specialInfo: null };

    if (phase === 'night') {
        game.werewolfNightTarget = null; // Reset at start of night
        console.log("Game " + game.gameId + " phase changed to NIGHT");
    } else if (phase === 'day') {
        console.log("Game " + game.gameId + " phase changed to DAY");
        if (game.werewolfNightTarget && game.playersInGame[game.werewolfNightTarget]) {
            if (game.playersInGame[game.werewolfNightTarget].status === 'alive') {
                game.playersInGame[game.werewolfNightTarget].status = 'eliminated';
                eliminationResult.eliminatedPlayerName = game.werewolfNightTarget;
                console.log(game.werewolfNightTarget + " eliminated by werewolves in game " + game.gameId);
            } else {
                eliminationResult.specialInfo = game.werewolfNightTarget + " was already eliminated.";
            }
        } else {
            eliminationResult.specialInfo = "No one was eliminated by werewolves.";
        }
        game.werewolfNightTarget = null; // Clear after processing
    }
    res.status(200).json({ message: "Phase updated to " + phase, currentPhase: game.currentPhase, eliminationResult });
});

app.post('/api/games/:gameId/action', (req, res) => {
    const game = games[req.params.gameId];
    const { actionType, targetPlayerName } = req.body;
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.currentPhase !== 'night') return res.status(400).json({ message: "Actions can only be performed at night." });

    if (actionType === 'seerCheck') {
        if (!targetPlayerName || !game.playersInGame[targetPlayerName]) {
            return res.status(400).json({ message: "Invalid target for Seer." });
        }
        const targetRoleDetails = game.playersInGame[targetPlayerName];
        const alignmentMessage = targetRoleDetails.roleName === "Werewolf" ? "Is a Werewolf" : "Not a Werewolf";
        console.log("Seer check on " + targetPlayerName + " in game " + game.gameId + ": " + alignmentMessage);
        return res.status(200).json({ alignmentMessage });
    } else if (actionType === 'werewolfTarget') {
        if (!targetPlayerName || !game.playersInGame[targetPlayerName] || game.playersInGame[targetPlayerName].status !== 'alive') {
            return res.status(400).json({ message: "Invalid target for Werewolves." });
        }
        if (game.playersInGame[targetPlayerName].roleName === "Werewolf") {
             return res.status(400).json({ message: "Werewolves cannot target other werewolves." });
        }
        game.werewolfNightTarget = targetPlayerName;
        console.log("Werewolves targeted " + targetPlayerName + " in game " + game.gameId);
        return res.status(200).json({ message: "Werewolf target recorded: " + targetPlayerName });
    }
    return res.status(400).json({ message: "Unknown action type." });
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