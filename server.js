<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Werewolf - Moderator Control Panel</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { font-family: 'Inter', sans-serif; }
        .message-log-container { max-height: 200px; overflow-y: auto; }
        .player-list-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border-bottom: 1px solid #4A5568; }
        .player-list-item:last-child { border-bottom: none; }
        .player-name-eliminated { text-decoration: line-through; color: #9CA3AF; }
        .hidden { display: none; }
        .game-list-item { cursor: pointer; padding: 0.5rem; }
        .game-list-item:hover { background-color: #374151; }
        .selected-game { background-color: #4B5563; font-weight: bold; }
        .vote-item { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;}
        .vote-bar-container { flex-grow: 1; background-color: #4A5568; border-radius: 0.25rem; margin: 0 0.5rem; height: 20px; overflow: hidden;}
        .vote-bar { background-color: #60A5FA; height: 100%; text-align: right; padding-right: 5px; color: white; font-size: 0.8rem; white-space: nowrap; transition: width 0.3s ease-in-out;}
        .leading-vote { border: 2px solid #FBBF24; /* Amber border for leading vote */ }
        button:disabled { background-color: #4A5568; cursor: not-allowed; }
    </style>
</head>
<body class="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-center p-4">
    <div class="bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-3xl">
        <h1 class="text-3xl font-bold mb-8 text-center text-purple-400">Werewolf Moderator Panel</h1>

        <div class="mb-8 p-6 bg-gray-700 rounded-lg">
            <h2 class="text-2xl font-semibold mb-4 text-purple-300">Game Management</h2>
            <div class="flex gap-4 mb-4">
                <input type="text" id="newGameNameInput" class="flex-grow p-3 bg-gray-600 border border-gray-500 rounded-lg text-white placeholder-gray-400" placeholder="New Game Name (optional)">
                <button id="createNewGameBtn" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg">Create New Game</button>
            </div>
            <div>
                <h3 class="text-lg font-medium text-gray-300 mb-2">Load Existing Game:</h3>
                <ul id="existingGamesList" class="bg-gray-600 rounded-lg p-3 min-h-[50px] max-h-40 overflow-y-auto"></ul>
            </div>
            <div id="currentGameStatusContainer" class="mt-4">
                <p id="currentGameInfo" class="text-purple-300 font-semibold">No game loaded.</p>
                <p id="currentGamePhaseInfo" class="text-sky-300"></p>
            </div>
            <div id="gameOverMessage" class="hidden mt-4 p-4 bg-yellow-500 text-gray-900 rounded-lg text-center font-bold text-xl"></div>
        </div>
        
        <div class="mb-8 p-6 bg-gray-700 rounded-lg">
            <h2 class="text-2xl font-semibold mb-4 text-purple-300">Master Player List</h2>
            <div class="flex gap-4 mb-4">
                <input type="text" id="masterPlayerNameInput" class="flex-grow p-3 bg-gray-600 border border-gray-500 rounded-lg text-white placeholder-gray-400" placeholder="Player name for master list">
                <button id="addMasterPlayerBtn" class="bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 px-6 rounded-lg">Add to Master List</button>
            </div>
            <div>
                <h3 class="text-lg font-medium text-gray-300 mb-2">All Players (Master List):</h3>
                <ul id="masterPlayerDisplayList" class="bg-gray-600 rounded-lg p-3 min-h-[50px] max-h-40 overflow-y-auto"></ul>
            </div>
        </div>


        <div id="currentGameSpecificsSection" class="hidden">
            <div id="currentGameSetupSection" class="mb-8 p-6 bg-gray-700 rounded-lg">
                <h2 class="text-2xl font-semibold mb-4 text-purple-300">Current Game: Player Setup</h2>
                <p class="text-gray-400 mb-2">Select players from the master list for the current game. Changes are saved automatically.</p>
                <div id="masterPlayerSelectionForGame" class="mb-4 max-h-48 overflow-y-auto bg-gray-600 p-2 rounded-md"></div>
                 <div class="mb-4">
                    <h3 class="text-lg font-medium text-gray-300 mb-2">Players in Current Game:</h3>
                    <ul id="playerList" class="bg-gray-600 rounded-lg p-3 min-h-[50px]"></ul>
                </div>
            </div>

            <div id="currentRoleAssignmentSection" class="mb-8 p-6 bg-gray-700 rounded-lg">
                <h2 class="text-2xl font-semibold mb-4 text-purple-300">Current Game: Role Assignment</h2>
                <p class="text-gray-400 mb-4 text-sm">Available roles: Villager, Werewolf, Seer.</p>
                <button id="assignRolesBtn" class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition mb-4">Assign Roles</button>
                <div id="assignedRolesContainer" class="hidden">
                    <h3 class="text-lg font-medium text-gray-300 mb-2">Assigned Roles & Status (Moderator View):</h3>
                    <ul id="assignedRolesList" class="bg-gray-600 rounded-lg p-3 min-h-[50px] space-y-2"></ul>
                </div>
            </div>
            
            <div id="gamePhaseSection" class="hidden mb-8 p-6 bg-gray-700 rounded-lg">
                <h2 class="text-2xl font-semibold mb-4 text-purple-300">Current Game: Phase Control</h2>
                <div class="grid grid-cols-2 gap-4">
                    <button id="startNightBtn" class="bg-slate-600 hover:bg-slate-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition">Start Night</button>
                    <button id="startDayBtn" class="bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 px-4 rounded-lg shadow-md transition">Start Day</button>
                </div>
            </div>

            <div id="votingSection" class="hidden mb-8 p-6 bg-gray-700 rounded-lg">
                <h2 class="text-2xl font-semibold mb-4 text-purple-300">Daytime Voting</h2>
                <div id="setupVoteContainer">
                    <h3 class="text-xl font-medium text-gray-300 mb-2">Select Players for Trial:</h3>
                    <div id="alivePlayerSelectionForVote" class="mb-4 max-h-48 overflow-y-auto bg-gray-600 p-2 rounded-md"></div>
                    <div class="flex gap-4">
                        <button id="addAllAliveToVoteBtn" class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg">Add All Alive</button>
                        <button id="startVoteBtn" class="bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 px-4 rounded-lg">Start Vote with Selected</button>
                    </div>
                </div>
                <div id="activeVotingContainer" class="hidden mt-4">
                    <h3 class="text-xl font-medium text-gray-300 mb-2">Vote Tally:</h3>
                    <div id="voteTallyDisplay" class="space-y-1 mb-4"></div>
                    <div class="flex flex-wrap gap-4">
                        <button id="clearAllVotesBtn" class="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg">Clear Votes</button>
                        <button id="finalizeVoteBtn" class="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg">Finalize Vote & Process</button>
                    </div>
                </div>
            </div>


            <div id="nightActionsSection" class="hidden mb-8 p-6 bg-gray-700 rounded-lg">
                <h2 class="text-2xl font-semibold mb-4 text-purple-300">Night Actions</h2>
                <div id="seerActionContainer" class="hidden mb-4">
                    <h3 class="text-xl font-medium text-gray-300 mb-2">Seer Action:</h3>
                    <div class="flex gap-4 items-center">
                        <select id="seerTargetSelect" class="flex-grow p-3 bg-gray-600 border border-gray-500 rounded-lg text-white"></select>
                        <button id="seerCheckTargetBtn" class="bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 px-4 rounded-lg">Check Target</button>
                    </div>
                </div>
                <div id="werewolfActionContainer" class="hidden">
                    <h3 class="text-xl font-medium text-gray-300 mb-2">Werewolf Action:</h3>
                     <div class="flex gap-4 items-center">
                        <select id="werewolfTargetSelect" class="flex-grow p-3 bg-gray-600 border border-gray-500 rounded-lg text-white"></select>
                        <button id="werewolfTargetBtn" class="bg-red-700 hover:bg-red-800 text-white font-semibold py-3 px-4 rounded-lg">Target Player</button>
                    </div>
                </div>
            </div>
            
            <div id="manualRevealSection" class="hidden mb-6 p-6 bg-gray-700 rounded-lg">
                <h2 class="text-2xl font-semibold mb-4 text-purple-300">Manual Reveals</h2>
                <div class="grid grid-cols-2 gap-4">
                    <button id="manualShowIsWerewolfBtn" class="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-3 rounded-lg">Show "Is a Werewolf"</button>
                    <button id="manualShowNotWerewolfBtn" class="bg-sky-600 hover:bg-sky-700 text-white font-semibold py-2 px-3 rounded-lg">Show "Not a Werewolf"</button>
                    <button id="manualShowVillageTeamBtn" class="bg-lime-600 hover:bg-lime-700 text-white font-semibold py-2 px-3 rounded-lg">Show "Village Alignment"</button>
                    <button id="manualShowWerewolfTeamBtn" class="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-3 rounded-lg">Show "Werewolf Alignment"</button>
                </div>
            </div>
        </div> 

        <div class="mb-6 p-6 bg-gray-700 rounded-lg">
            <h2 class="text-2xl font-semibold mb-4 text-purple-300">General Message</h2>
            <input type="text" id="messageInput" class="w-full p-3 bg-gray-600 border border-gray-500 rounded-lg text-white" placeholder="Enter general message...">
            <button id="sendMessageBtn" class="mt-4 w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg">Send Message</button>
        </div>

        <div class="mt-8 p-6 bg-gray-700 rounded-lg">
            <h2 class="text-xl font-semibold mb-2 text-purple-300">Connection Status:</h2>
            <div id="status" class="p-3 bg-gray-600 rounded-lg text-sm">Connecting to server...</div>
        </div>
        <div class="mt-6">
            <h3 class="text-lg font-semibold mb-2 text-purple-300">Moderator Log:</h3>
            <div id="moderatorLog" class="message-log-container p-3 bg-gray-600 rounded-lg text-sm space-y-1"></div>
        </div>
        <div class="mt-6 text-center text-xs text-gray-500">
            Panel v0.9.0 / Server <span id="serverVersionDisplay">loading...</span>
        </div>
    </div>

    <script>
        // Global state
        let currentLoadedGameId = null;
        let localMasterPlayers = []; 
        let localGameList = [];      
        
        let playersInCurrentGame = []; 
        let gameRoles = {};            
        let currentPhase = 'setup';    
        let playersOnTrialForVote = [];
        let currentVotes = {};

        const ALL_ROLES_CONFIG = { 
            VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
            WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
            SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
        };

        document.addEventListener('DOMContentLoaded', () => {
            const messageInput = document.getElementById('messageInput');
            const sendMessageBtn = document.getElementById('sendMessageBtn');
            const statusDiv = document.getElementById('status');
            const moderatorLog = document.getElementById('moderatorLog');
            const serverVersionDisplay = document.getElementById('serverVersionDisplay');
            let socket;

            const newGameNameInput = document.getElementById('newGameNameInput');
            const createNewGameBtn = document.getElementById('createNewGameBtn');
            const existingGamesList = document.getElementById('existingGamesList');
            const currentGameInfo = document.getElementById('currentGameInfo');
            const currentGamePhaseInfo = document.getElementById('currentGamePhaseInfo'); 
            const gameOverMessage = document.getElementById('gameOverMessage');
            
            const masterPlayerNameInput = document.getElementById('masterPlayerNameInput');
            const addMasterPlayerBtn = document.getElementById('addMasterPlayerBtn');
            const masterPlayerDisplayList = document.getElementById('masterPlayerDisplayList');

            const currentGameSpecificsSection = document.getElementById('currentGameSpecificsSection');
            const currentGameSetupSection = document.getElementById('currentGameSetupSection');
            const playerList = document.getElementById('playerList'); 
            const masterPlayerSelectionForGame = document.getElementById('masterPlayerSelectionForGame');
            
            const currentRoleAssignmentSection = document.getElementById('currentRoleAssignmentSection');
            const assignRolesBtn = document.getElementById('assignRolesBtn');
            const assignedRolesContainer = document.getElementById('assignedRolesContainer');
            const assignedRolesList = document.getElementById('assignedRolesList');
            
            const gamePhaseSection = document.getElementById('gamePhaseSection');
            const startNightBtn = document.getElementById('startNightBtn');
            const startDayBtn = document.getElementById('startDayBtn');

            const votingSection = document.getElementById('votingSection');
            const setupVoteContainer = document.getElementById('setupVoteContainer');
            const alivePlayerSelectionForVote = document.getElementById('alivePlayerSelectionForVote');
            const addAllAliveToVoteBtn = document.getElementById('addAllAliveToVoteBtn');
            const startVoteBtn = document.getElementById('startVoteBtn');
            const activeVotingContainer = document.getElementById('activeVotingContainer');
            const voteTallyDisplay = document.getElementById('voteTallyDisplay');
            const clearAllVotesBtn = document.getElementById('clearAllVotesBtn');
            const finalizeVoteBtn = document.getElementById('finalizeVoteBtn');
            
            const nightActionsSection = document.getElementById('nightActionsSection');
            const seerActionContainer = document.getElementById('seerActionContainer');
            const seerTargetSelect = document.getElementById('seerTargetSelect');
            const seerCheckTargetBtn = document.getElementById('seerCheckTargetBtn');
            const werewolfActionContainer = document.getElementById('werewolfActionContainer');
            const werewolfTargetSelect = document.getElementById('werewolfTargetSelect');
            const werewolfTargetBtn = document.getElementById('werewolfTargetBtn');
            const manualRevealSection = document.getElementById('manualRevealSection');
            
            async function fetchServerVersion() {
                const versionData = await fetchFromServer('/api/version');
                if (versionData && versionData.version) {
                    serverVersionDisplay.textContent = 'v' + versionData.version;
                } else {
                    serverVersionDisplay.textContent = 'N/A';
                }
            }

            function connectWebSocket() {
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsHost = window.location.host;
                socket = new WebSocket(wsProtocol + '//' + wsHost);
                socket.onopen = () => updateStatus('Connected to WebSocket server.', 'success');
                socket.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'vote_update' && data.gameId === currentLoadedGameId) {
                        logToModerator('Vote update received via WS.', 'WS Received');
                        if (data.payload && data.payload.votes) {
                             currentVotes = data.payload.votes; 
                             renderVoteTally(); 
                        }
                    } else if (data.type === 'game_over' && data.gameId === currentLoadedGameId) {
                        logToModerator('Game Over message received via WS. Payload: ' + JSON.stringify(data.payload), 'WS Received');
                        if (data.payload) {
                            loadSpecificGame(currentLoadedGameId); 
                        }
                    } else {
                        logToModerator('WS Server: ' + event.data, 'Received');
                    }
                };
                socket.onclose = () => {
                    updateStatus('WS Disconnected. Reconnecting...', 'error');
                    setTimeout(connectWebSocket, 3000);
                };
                socket.onerror = () => updateStatus('WS Connection error.', 'error');
            }

            function updateStatus(message, type = 'info') {
                statusDiv.textContent = message;
                statusDiv.className = 'p-3 rounded-lg text-sm ' + 
                    (type === 'success' ? 'bg-green-700 text-green-100' : 
                     type === 'error' ? 'bg-red-700 text-red-100' : 
                     'bg-gray-600');
            }
            
            function logToModerator(message, type = "Info") {
                 console.log('[' + type + '] ' + message); 
                 const logEntry = document.createElement('div');
                 logEntry.textContent = '[' + type + '] ' + message;
                 logEntry.className = 'text-gray-300';
                 moderatorLog.insertBefore(logEntry, moderatorLog.firstChild); 
                 if (moderatorLog.children.length > 30) { 
                     moderatorLog.removeChild(moderatorLog.lastChild);
                 }
            }

            function sendWebSocketMessage(type, dataPayload) { 
                logToModerator('Attempting to send WS message. Type: ' + type + ', Socket Ready: ' + (socket && socket.readyState === WebSocket.OPEN), 'Debug');
                
                if (type !== 'moderator_message' && !currentLoadedGameId) {
                    logToModerator("Cannot send WS message: No game loaded for type " + type, "Error");
                    return;
                }

                if (socket && socket.readyState === WebSocket.OPEN) {
                    const messageToSend = { type, gameId: currentLoadedGameId, ...dataPayload }; 
                    socket.send(JSON.stringify(messageToSend));
                    
                    let logMessageContent = "details unavailable";
                    if (dataPayload.content !== undefined) { 
                        logMessageContent = dataPayload.content;
                    } else if (dataPayload.payload) { 
                        const p = dataPayload.payload;
                        logMessageContent = p.playerName || p.targetPlayerName || p.alignment || p.message || p.winningTeam || JSON.stringify(p);
                    } else {
                        logMessageContent = JSON.stringify(dataPayload); 
                    }
                    logToModerator(type + ': ' + logMessageContent, 'WS Sent');
                } else {
                    updateStatus('Not connected to WS. Cannot send message.', 'error');
                    logToModerator('WS send failed: Socket not open or undefined.', 'Error');
                }
            }

            async function fetchFromServer(endpoint, options = {}) {
                try {
                    const response = await fetch(endpoint, options);
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ message: response.statusText }));
                        logToModerator('API Error (' + response.status + '): ' + (errorData.message || 'Unknown error') + ' at ' + endpoint, 'API Error');
                        updateStatus('API request failed: ' + response.status, 'error');
                        return null;
                    }
                    if (response.status === 204) return true; 
                    return response.json();
                } catch (error) {
                    logToModerator(error.message, 'Fetch Error');
                    updateStatus('Network or fetch error. Check console.', 'error');
                    return null;
                }
            }

            async function loadGamesList() {
                const games = await fetchFromServer('/api/games');
                if (games) {
                    localGameList = games;
                    existingGamesList.innerHTML = '';
                    if (games.length === 0) {
                        existingGamesList.innerHTML = '<li class="text-gray-400 italic">No saved games found.</li>';
                    }
                    games.forEach(game => {
                        const li = document.createElement('li');
                        let gameDisplayText = game.gameName + ' (Players: ' + game.playerCount + ', Phase: ' + game.currentPhase + ')';
                        if (game.gameWinner && game.gameWinner.team) {
                            gameDisplayText += ' - WINNER: ' + game.gameWinner.team;
                        }
                        li.textContent = gameDisplayText;
                        li.dataset.gameId = game.gameId;
                        li.className = 'game-list-item hover:bg-gray-500 rounded';
                        li.onclick = () => loadSpecificGame(game.gameId);
                        existingGamesList.appendChild(li);
                    });
                }
            }

            async function loadSpecificGame(gameId) {
                logToModerator('Attempting to load game: ' + gameId, 'System');
                const gameData = await fetchFromServer('/api/games/' + gameId);

                if (gameData) {
                    currentLoadedGameId = gameId;
                    currentGameInfo.textContent = 'Loaded Game: ' + gameData.gameName + ' (ID: ' + gameId + ')';
                    
                    playersInCurrentGame = gameData.playerOrder || [];
                    gameRoles = gameData.playersInGame || {}; 
                    currentPhase = gameData.currentPhase || 'setup';
                    playersOnTrialForVote = gameData.playersOnTrial || [];
                    currentVotes = gameData.votes || {};
                    
                    logToModerator('Successfully loaded game state for ' + gameData.gameName + ' - Phase: ' + currentPhase, 'System');
                    updateUIAfterGameLoad(gameData.gameWinner); 
                } else {
                    logToModerator('Failed to load game data for ' + gameId, 'Error');
                    currentGameInfo.textContent = 'Failed to load game: ' + gameId;
                    currentLoadedGameId = null;
                    hideAllGameSpecificSections();
                }
            }
            
            function updateUIAfterGameLoad(gameWinnerData = null) {
                if (!currentLoadedGameId) {
                    hideAllGameSpecificSections();
                    currentGamePhaseInfo.textContent = '';
                    gameOverMessage.classList.add('hidden');
                    return;
                }

                currentGamePhaseInfo.textContent = 'Current Phase: ' + currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1).replace('_', ' ');

                const gameIsFinished = (gameWinnerData && gameWinnerData.team) || currentPhase === 'finished';

                if (gameIsFinished) {
                    gameOverMessage.textContent = "GAME OVER! " + (gameWinnerData?.team || "Team") + " wins! Reason: " + (gameWinnerData?.reason || "Win condition met.");
                    gameOverMessage.classList.remove('hidden');
                    currentGameSpecificsSection.classList.add('hidden'); 
                } else {
                    gameOverMessage.classList.add('hidden');
                    currentGameSpecificsSection.classList.remove('hidden'); 
                }
                
                if (!gameIsFinished) {
                    currentGameSetupSection.classList.remove('hidden');
                    currentRoleAssignmentSection.classList.remove('hidden');
                    
                    renderMasterPlayerSelectionForGame(); 
                    renderPlayerListForCurrentGame();
                    renderAssignedRolesList(); 
                    
                    const rolesAreAssigned = playersInCurrentGame.length > 0 && 
                                             playersInCurrentGame.every(pName => gameRoles[pName] && gameRoles[pName].roleName);

                    if (rolesAreAssigned) {
                        gamePhaseSection.classList.remove('hidden');
                        manualRevealSection.classList.remove('hidden');
                        assignedRolesContainer.classList.remove('hidden'); 
                        
                        if (currentPhase === 'night') {
                            nightActionsSection.classList.remove('hidden');
                            votingSection.classList.add('hidden');
                        } else if (currentPhase === 'day' || currentPhase === 'voting') {
                            nightActionsSection.classList.add('hidden');
                            votingSection.classList.remove('hidden');
                            renderAlivePlayerSelectionForVote();
                            if (currentPhase === 'voting') {
                                setupVoteContainer.classList.add('hidden');
                                activeVotingContainer.classList.remove('hidden');
                                renderVoteTally();
                            } else { 
                                setupVoteContainer.classList.remove('hidden');
                                activeVotingContainer.classList.add('hidden');
                            }
                        } else { 
                            nightActionsSection.classList.add('hidden');
                            votingSection.classList.add('hidden');
                        }
                    } else { 
                        gamePhaseSection.classList.add('hidden');
                        nightActionsSection.classList.add('hidden');
                        manualRevealSection.classList.add('hidden');
                        assignedRolesContainer.classList.add('hidden'); 
                        votingSection.classList.add('hidden');
                    }
                    updateNightActionSelectors();
                } else { 
                     gamePhaseSection.classList.add('hidden');
                     nightActionsSection.classList.add('hidden');
                     manualRevealSection.classList.add('hidden');
                     votingSection.classList.add('hidden');
                     if(currentRoleAssignmentSection) currentRoleAssignmentSection.classList.remove('hidden'); 
                     if(assignRolesBtn) assignRolesBtn.disabled = true; 
                     if (assignedRolesContainer) assignedRolesContainer.classList.remove('hidden'); 
                }


                Array.from(existingGamesList.children).forEach(child => {
                    child.classList.remove('selected-game');
                    if (child.dataset.gameId === currentLoadedGameId) {
                        child.classList.add('selected-game');
                    }
                });
            }

            function hideAllGameSpecificSections() {
                currentGameSpecificsSection.classList.add('hidden');
                gameOverMessage.classList.add('hidden');
                currentGamePhaseInfo.textContent = '';
            }

            createNewGameBtn.addEventListener('click', async () => {
                const gameName = newGameNameInput.value.trim() || 'New Game ' + (localGameList.length + 1);
                const newGame = await fetchFromServer('/api/games', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gameName })
                });
                if (newGame) {
                    logToModerator('Created new game: ' + newGame.gameName, 'System');
                    newGameNameInput.value = '';
                    await loadGamesList(); 
                    loadSpecificGame(newGame.gameId); 
                }
            });

            async function loadMasterPlayers() {
                const playersData = await fetchFromServer('/api/master-players');
                if (playersData) {
                    localMasterPlayers = playersData; 
                    masterPlayerDisplayList.innerHTML = '';
                     if (localMasterPlayers.length === 0) {
                        masterPlayerDisplayList.innerHTML = '<li class="text-gray-400 italic">No players in master list.</li>';
                    }
                    localMasterPlayers.forEach(player => {
                        const li = document.createElement('li');
                        li.textContent = player.name; 
                        masterPlayerDisplayList.appendChild(li);
                    });
                    renderMasterPlayerSelectionForGame(); 
                }
            }
            
            addMasterPlayerBtn.addEventListener('click', async () => {
                const playerName = masterPlayerNameInput.value.trim();
                if (playerName) {
                    const result = await fetchFromServer('/api/master-players', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: playerName })
                    });
                    if (result) {
                        logToModerator(playerName + ' added to master list.', 'System');
                        masterPlayerNameInput.value = '';
                        loadMasterPlayers(); 
                    }
                }
            });
            
            function renderMasterPlayerSelectionForGame() {
                masterPlayerSelectionForGame.innerHTML = '';
                if (!currentLoadedGameId) return; 

                if (localMasterPlayers.length === 0) {
                     masterPlayerSelectionForGame.innerHTML = '<p class="text-gray-400 italic">Add players to the Master List first.</p>';
                     return;
                }
                localMasterPlayers.forEach(player => { 
                    const div = document.createElement('div');
                    div.className = 'flex items-center gap-2 p-1';
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = 'masterPlayerSelect-' + player.id + '-' + currentLoadedGameId; 
                    checkbox.value = player.name; 
                    checkbox.dataset.playerId = player.id; 
                    checkbox.className = 'form-checkbox h-5 w-5 text-purple-600 bg-gray-700 border-gray-500 rounded focus:ring-purple-500';
                    
                    checkbox.checked = playersInCurrentGame.includes(player.name);
                    
                    checkbox.onchange = (event) => handlePlayerSelectionForGame(event.target.value, event.target.checked);
                    
                    const label = document.createElement('label');
                    label.htmlFor = checkbox.id;
                    label.textContent = player.name;
                    
                    div.appendChild(checkbox);
                    div.appendChild(label);
                    masterPlayerSelectionForGame.appendChild(div);
                });
            }

            async function handlePlayerSelectionForGame(playerName, isSelected) {
                if (!currentLoadedGameId) {
                    logToModerator("No game loaded to add/remove players.", "Error");
                    return;
                }
                let updatedPlayerListNames = [...playersInCurrentGame];
                if (isSelected) {
                    if (!updatedPlayerListNames.includes(playerName)) {
                        updatedPlayerListNames.push(playerName);
                    }
                } else {
                    updatedPlayerListNames = updatedPlayerListNames.filter(p => p !== playerName);
                }

                const result = await fetchFromServer('/api/games/' + currentLoadedGameId + '/players', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ players: updatedPlayerListNames }) 
                });

                if (result) { 
                    logToModerator('Player list for game ' + currentLoadedGameId + ' update sent to server.', 'System');
                    await loadSpecificGame(currentLoadedGameId);
                } else {
                    logToModerator('Failed to update player list on server.', 'Error');
                    loadSpecificGame(currentLoadedGameId); 
                }
            }

            function renderPlayerListForCurrentGame() {
                playerList.innerHTML = playersInCurrentGame.length > 0 
                    ? playersInCurrentGame.map(name => '<li class="text-white">' + name + '</li>').join('') 
                    : '<li class="text-gray-400 italic">No players selected for this game yet. Add them from the Master List above.</li>';
            }
            
            assignRolesBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) { logToModerator("No game loaded.", "Error"); return; }
                if (playersInCurrentGame.length === 0) { logToModerator("Add players to the game first.", "Warning"); return; }

                logToModerator("Requesting server to assign roles for game " + currentLoadedGameId, "System");
                const assignmentResult = await fetchFromServer('/api/games/' + currentLoadedGameId + '/assign-roles', {
                    method: 'POST' 
                });

                if (assignmentResult) {
                    logToModerator("Roles assigned by server.", "System");
                    await loadSpecificGame(currentLoadedGameId); 
                    sendWebSocketMessage('moderator_message', { content: "Game '" + (localGameList.find(g=>g.gameId === currentLoadedGameId)?.gameName || currentLoadedGameId) + "' roles assigned." });
                } else {
                    logToModerator("Failed to assign roles on server.", "Error");
                }
            });

            function renderAssignedRolesList() {
                assignedRolesList.innerHTML = '';
                if (Object.keys(gameRoles).length === 0 && playersInCurrentGame.length > 0) {
                    assignedRolesList.innerHTML = '<li class="text-gray-400 italic">Roles not assigned yet. Click "Assign Roles".</li>';
                    assignedRolesContainer.classList.add('hidden');
                    return;
                }
                if (playersInCurrentGame.length === 0) {
                     assignedRolesList.innerHTML = '<li class="text-gray-400 italic">No players in this game.</li>';
                     assignedRolesContainer.classList.add('hidden');
                     return;
                }
                
                let rolesActuallyAssigned = false;
                playersInCurrentGame.forEach(playerName => { 
                    const playerData = gameRoles[playerName];
                    if (!playerData || !playerData.roleName) { 
                        const li = document.createElement('li');
                        li.className = 'player-list-item text-yellow-400 italic';
                        li.textContent = playerName + " (Role pending assignment)";
                        assignedRolesList.appendChild(li);
                        return;
                    }
                    rolesActuallyAssigned = true; 

                    const li = document.createElement('li');
                    li.className = 'player-list-item';
                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = playerName + " (" + playerData.roleName + ")"; 
                    nameSpan.className = playerData.status === 'eliminated' ? 'player-name-eliminated' : 'text-gray-200';

                    const buttonContainer = document.createElement('div');
                    buttonContainer.className = 'flex gap-2';

                    const showRoleBtn = document.createElement('button');
                    showRoleBtn.textContent = 'Show Role';
                    showRoleBtn.className = 'bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold py-1 px-2 rounded-md transition';
                    showRoleBtn.onclick = () => sendWebSocketMessage('show_specific_role', { 
                        payload: { playerName, roleName: playerData.roleName, roleDescription: playerData.roleDetails.description, team: playerData.roleDetails.team } 
                    });
                    buttonContainer.appendChild(showRoleBtn);

                    if (playerData.status === 'alive') {
                        const eliminateBtn = document.createElement('button');
                        eliminateBtn.textContent = 'Eliminate';
                        eliminateBtn.className = 'bg-red-500 hover:bg-red-600 text-white text-xs font-semibold py-1 px-2 rounded-md transition';
                        eliminateBtn.onclick = async () => {
                            if (window.confirm("Manually eliminate " + playerName + "?")) {
                                const statusUpdate = await fetchFromServer('/api/games/' + currentLoadedGameId + '/player-status', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ playerName, status: 'eliminated' })
                                });
                                if (statusUpdate) {
                                    logToModerator(playerName + " manually eliminated (server updated).", "Elimination");
                                    sendWebSocketMessage('player_eliminated', { payload: { playerName: playerName, source: 'manual' } }); 
                                    loadSpecificGame(currentLoadedGameId); 
                                }
                            }
                        };
                        buttonContainer.appendChild(eliminateBtn);
                    } else { 
                        const reviveBtn = document.createElement('button');
                        reviveBtn.textContent = 'Revive';
                        reviveBtn.className = 'bg-green-500 hover:bg-green-600 text-white text-xs font-semibold py-1 px-2 rounded-md transition';
                        reviveBtn.onclick = async () => {
                             if (window.confirm("Revive " + playerName + "?")) {
                                const statusUpdate = await fetchFromServer('/api/games/' + currentLoadedGameId + '/player-status', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ playerName, status: 'alive' })
                                });
                                if (statusUpdate) {
                                    logToModerator(playerName + " revived (server updated).", "Status Change");
                                    loadSpecificGame(currentLoadedGameId); 
                                }
                            }
                        };
                        buttonContainer.appendChild(reviveBtn);
                    }
                    li.appendChild(nameSpan);
                    li.appendChild(buttonContainer);
                    assignedRolesList.appendChild(li);
                });

                if (rolesActuallyAssigned) {
                    assignedRolesContainer.classList.remove('hidden');
                } else {
                    assignedRolesContainer.classList.add('hidden');
                }
            }
            
            startNightBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) { logToModerator("No game loaded.", "Error"); return; }
                const phaseUpdate = await fetchFromServer('/api/games/' + currentLoadedGameId + '/phase', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phase: 'night' })
                });
                if (phaseUpdate) {
                    logToModerator("Night phase started (server updated).", "Phase");
                    if (!phaseUpdate.gameWinner || !phaseUpdate.gameWinner.team) { 
                        sendWebSocketMessage('game_phase_change', { payload: { phase: 'night', message: "Night has fallen. Everyone, close your eyes." } });
                    }
                    await loadSpecificGame(currentLoadedGameId); 
                }
            });

            startDayBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) { logToModerator("No game loaded.", "Error"); return; }
                const phaseUpdate = await fetchFromServer('/api/games/' + currentLoadedGameId + '/phase', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phase: 'day' }) 
                });

                if (phaseUpdate) { 
                    logToModerator("Day phase processing complete (server updated). Elim Result: " + JSON.stringify(phaseUpdate.eliminationResult), "Phase");
                    if (!phaseUpdate.gameWinner || !phaseUpdate.gameWinner.team) { 
                        const daybreakPayload = {
                            phase: 'day',
                            message: "Daybreak! Open your eyes and discuss.",
                            eliminatedPlayer: phaseUpdate.eliminationResult?.eliminatedPlayerName, 
                            specialInfo: phaseUpdate.eliminationResult?.specialInfo 
                        };
                        sendWebSocketMessage('game_phase_change', { payload: daybreakPayload });
                    }
                    await loadSpecificGame(currentLoadedGameId); 
                }
            });
            
            function updateNightActionSelectors() {
                if (!currentLoadedGameId || Object.keys(gameRoles).length === 0 || currentPhase !== 'night') {
                    seerActionContainer.classList.add('hidden');
                    werewolfActionContainer.classList.add('hidden');
                    return;
                }
                const alivePlayersForCurrentGame = playersInCurrentGame.filter(p => gameRoles[p] && gameRoles[p].status === 'alive');
                
                const currentSeerNameInGame = playersInCurrentGame.find(pName => gameRoles[pName] && gameRoles[pName].roleName === "Seer" && gameRoles[pName].status === 'alive');

                if (currentSeerNameInGame) {
                    seerActionContainer.classList.remove('hidden');
                    seerTargetSelect.innerHTML = ''; 
                    const seerTargets = alivePlayersForCurrentGame.filter(p => p !== currentSeerNameInGame);
                    if (seerTargets.length > 0) {
                        seerTargets.forEach(pName => {
                            const option = document.createElement('option'); option.value = pName; option.textContent = pName; seerTargetSelect.appendChild(option);
                        });
                        seerCheckTargetBtn.disabled = false;
                    } else {
                        seerTargetSelect.innerHTML = '<option value="">No other alive players</option>'; seerCheckTargetBtn.disabled = true;
                    }
                } else {
                    seerActionContainer.classList.add('hidden');
                }

                const aliveWerewolvesCount = alivePlayersForCurrentGame.filter(p => gameRoles[p] && gameRoles[p].roleName === "Werewolf").length;
                if (aliveWerewolvesCount > 0) {
                    werewolfActionContainer.classList.remove('hidden');
                    werewolfTargetSelect.innerHTML = '';
                    const werewolfTargets = alivePlayersForCurrentGame.filter(p => gameRoles[p] && gameRoles[p].roleName !== "Werewolf"); 
                     if (werewolfTargets.length > 0) {
                        werewolfTargets.forEach(pName => {
                            const option = document.createElement('option'); option.value = pName; option.textContent = pName; werewolfTargetSelect.appendChild(option);
                        });
                        werewolfTargetBtn.disabled = false;
                    } else {
                        werewolfTargetSelect.innerHTML = '<option value="">No non-werewolves</option>'; werewolfTargetBtn.disabled = true;
                    }
                } else {
                    werewolfActionContainer.classList.add('hidden');
                }
            }
            
            seerCheckTargetBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) return;
                const targetPlayerName = seerTargetSelect.value;
                if (!targetPlayerName) { logToModerator("No target for Seer.", "Warning"); return; }

                const seerResult = await fetchFromServer('/api/games/' + currentLoadedGameId + '/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actionType: 'seerCheck', targetPlayerName })
                });

                if (seerResult && seerResult.alignmentMessage) {
                    logToModerator("Seer checks " + targetPlayerName + ". Server Result: " + seerResult.alignmentMessage, "Seer");
                    sendWebSocketMessage('seer_check_result', { payload: { targetPlayerName, alignmentMessage: seerResult.alignmentMessage } });
                } else {
                    logToModerator("Failed to get Seer result from server for " + targetPlayerName, "Error");
                }
            });

            werewolfTargetBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) return;
                const targetPlayerName = werewolfTargetSelect.value;
                if (!targetPlayerName) { logToModerator("No target by werewolves.", "Warning"); return; }
                
                const targetResult = await fetchFromServer('/api/games/' + currentLoadedGameId + '/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actionType: 'werewolfTarget', targetPlayerName })
                });

                if (targetResult) { 
                    logToModerator("Werewolves targeted: " + targetPlayerName + " (server updated).", "Werewolf Action");
                    sendWebSocketMessage('moderator_message', { content: "The werewolves have chosen their target..." });
                } else {
                     logToModerator("Failed to record werewolf target on server for " + targetPlayerName, "Error");
                }
            });

            function renderAlivePlayerSelectionForVote() {
                alivePlayerSelectionForVote.innerHTML = '';
                if (!currentLoadedGameId || (currentPhase !== 'day' && currentPhase !== 'voting')) {
                    votingSection.classList.add('hidden');
                    return;
                }
                
                votingSection.classList.remove('hidden'); 

                const alivePlayersForVote = playersInCurrentGame.filter(p => gameRoles[p] && gameRoles[p].status === 'alive');
                if (alivePlayersForVote.length === 0) {
                    alivePlayerSelectionForVote.innerHTML = '<p class="text-gray-400 italic">No alive players to vote for.</p>';
                    return;
                }
                alivePlayersForVote.forEach(playerName => {
                    const div = document.createElement('div');
                    div.className = "flex items-center my-1";
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.id = 'voteSelect-' + playerName.replace(/\s+/g, '-');
                    checkbox.value = playerName;
                    checkbox.className = 'form-checkbox h-4 w-4 text-purple-600 bg-gray-700 border-gray-500 rounded focus:ring-purple-500 mr-2';
                    const label = document.createElement('label');
                    label.htmlFor = checkbox.id;
                    label.textContent = playerName;
                    div.appendChild(checkbox);
                    div.appendChild(label);
                    alivePlayerSelectionForVote.appendChild(div);
                });
            }

            addAllAliveToVoteBtn.addEventListener('click', () => {
                Array.from(alivePlayerSelectionForVote.querySelectorAll('input[type="checkbox"]')).forEach(cb => cb.checked = true);
            });

            startVoteBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) { logToModerator("No game loaded.", "Error"); return; }
                const selectedForTrial = Array.from(alivePlayerSelectionForVote.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
                if (selectedForTrial.length === 0) {
                    logToModerator("No players selected for trial.", "Warning");
                    return;
                }
                const result = await fetchFromServer('/api/games/' + currentLoadedGameId + '/start-vote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerNamesOnTrial: selectedForTrial })
                });
                if (result) {
                    logToModerator("Voting started for: " + selectedForTrial.join(', '), "Voting");
                    sendWebSocketMessage('voting_update', { payload: { gameId: currentLoadedGameId, playersOnTrial: result.playersOnTrial || [], votes: result.votes || {} } });
                    await loadSpecificGame(currentLoadedGameId); 
                }
            });
            
            function renderVoteTally() {
                voteTallyDisplay.innerHTML = '';
                if (!currentLoadedGameId || currentPhase !== 'voting' || playersOnTrialForVote.length === 0) {
                    activeVotingContainer.classList.add('hidden');
                    if (currentPhase === 'day') setupVoteContainer.classList.remove('hidden'); 
                    return;
                }
                setupVoteContainer.classList.add('hidden');
                activeVotingContainer.classList.remove('hidden');

                let maxVotes = 0;
                if (Object.values(currentVotes).length > 0) {
                    maxVotes = Math.max(...Object.values(currentVotes).map(v => Number(v)), 0);
                }
                
                playersOnTrialForVote.forEach(playerName => {
                    const votes = currentVotes[playerName] || 0;
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'vote-item p-2 rounded ' + (votes > 0 && votes === maxVotes ? 'leading-vote bg-yellow-700' : 'bg-gray-600');

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = playerName;
                    nameSpan.className = 'font-medium mr-2 w-1/3 truncate';
                    
                    const voteBarContainer = document.createElement('div');
                    voteBarContainer.className = 'vote-bar-container w-1/3';
                    const voteBar = document.createElement('div');
                    voteBar.className = 'vote-bar';
                    const barWidthPercentage = maxVotes > 0 ? (votes / maxVotes) * 100 : 0; 
                    voteBar.style.width = Math.min(barWidthPercentage, 100) + '%'; 
                    voteBar.textContent = votes;
                    voteBarContainer.appendChild(voteBar);

                    const voteButtonsDiv = document.createElement('div');
                    voteButtonsDiv.className = 'flex gap-1 w-1/3 justify-end';
                    const plusBtn = document.createElement('button');
                    plusBtn.textContent = '+1';
                    plusBtn.className = 'bg-green-500 hover:bg-green-600 text-white font-bold py-1 px-2 rounded text-xs';
                    plusBtn.onclick = () => updateVote(playerName, 1);
                    const minusBtn = document.createElement('button');
                    minusBtn.textContent = '-1';
                    minusBtn.className = 'bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-2 rounded text-xs';
                    minusBtn.onclick = () => updateVote(playerName, -1);
                    
                    voteButtonsDiv.appendChild(minusBtn);
                    voteButtonsDiv.appendChild(plusBtn);
                    
                    itemDiv.appendChild(nameSpan);
                    itemDiv.appendChild(voteBarContainer);
                    itemDiv.appendChild(voteButtonsDiv);
                    voteTallyDisplay.appendChild(itemDiv);
                });
                sendWebSocketMessage('voting_update', { payload: { gameId: currentLoadedGameId, playersOnTrial: playersOnTrialForVote, votes: currentVotes } });
            }

            async function updateVote(playerName, change) {
                if (!currentLoadedGameId) return;
                const result = await fetchFromServer('/api/games/' + currentLoadedGameId + '/update-vote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playerName, change })
                });
                if (result && result.votes) {
                    currentVotes = result.votes; 
                    logToModerator("Vote for " + playerName + (change > 0 ? ' increased.' : ' decreased.'), "Voting");
                    renderVoteTally(); 
                } else {
                     logToModerator("Failed to update vote for " + playerName, "Error");
                }
            }
            
            clearAllVotesBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) return;
                if (!confirm("Are you sure you want to clear all current votes?")) return;
                const result = await fetchFromServer('/api/games/' + currentLoadedGameId + '/clear-votes', { method: 'POST' });
                if (result) {
                    logToModerator("All votes cleared.", "Voting");
                    await loadSpecificGame(currentLoadedGameId); 
                }
            });

            finalizeVoteBtn.addEventListener('click', async () => {
                if (!currentLoadedGameId) return;
                let eliminatedPlayerName = null;
                let maxVotes = -1;
                let playersWithMaxVotes = [];

                Object.entries(currentVotes).forEach(([player, votes]) => {
                    if (votes > maxVotes) {
                        maxVotes = votes;
                        playersWithMaxVotes = [player];
                    } else if (votes === maxVotes && maxVotes > 0) { 
                        playersWithMaxVotes.push(player);
                    }
                });

                if (playersWithMaxVotes.length === 1 && maxVotes > 0) { 
                    if (confirm("Eliminate " + playersWithMaxVotes[0] + " (Most votes: " + maxVotes + ")?")) {
                        eliminatedPlayerName = playersWithMaxVotes[0];
                    } else if (!confirm("Proceed without elimination and return to day phase?")) { return; }
                } else if (playersWithMaxVotes.length > 1) { 
                    const chosen = prompt("TIE: " + playersWithMaxVotes.join(' & ') + " have " + maxVotes + " votes. Enter one name to eliminate, or leave blank to not eliminate anyone:");
                    if (chosen && playersWithMaxVotes.includes(chosen.trim())) {
                        eliminatedPlayerName = chosen.trim();
                    } else if (chosen) { alert("Invalid player name for tie-breaker."); return; }
                    else if (!confirm("No tie-breaker chosen. Return to day phase without elimination?")) { return; }
                } else { 
                     if (!confirm("No player has a majority of votes or no votes cast. Return to day phase without elimination?")) { return; }
                }

                const result = await fetchFromServer('/api/games/' + currentLoadedGameId + '/process-elimination', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ eliminatedPlayerName }) 
                });

                if (result) {
                    logToModerator("Vote processed. Eliminated: " + (eliminatedPlayerName || "None"), "Voting");
                    // Server will broadcast 'game_over' if game ended.
                    // If game continues and a player was eliminated by vote:
                    if (eliminatedPlayerName && (!result.gameWinner || !result.gameWinner.team) ) { 
                        sendWebSocketMessage('player_eliminated', { payload: { gameId: currentLoadedGameId, playerName: eliminatedPlayerName, source: 'vote' } });
                    } else if (!eliminatedPlayerName && (!result.gameWinner || !result.gameWinner.team)) {
                        // Only send this if no one was eliminated AND game is not over
                        sendWebSocketMessage('moderator_message', { gameId: currentLoadedGameId, content: "No one was eliminated by vote. Discussion continues." });
                    }
                    await loadSpecificGame(currentLoadedGameId); 
                }
            });
            
            // General Message button - Fixed
            sendMessageBtn.addEventListener('click', () => {
                logToModerator("Send Message button clicked.", "Debug");
                const message = messageInput.value.trim();
                logToModerator("Message content: '" + message + "'", "Debug");
                if (message) { 
                    try {
                        sendWebSocketMessage('moderator_message', { content: message }); 
                    } catch (e) {
                        logToModerator("Error during sendWebSocketMessage from Send Message button: " + e.message, "Error");
                    } finally {
                         messageInput.value = ''; // Ensure input is cleared
                    }
                } else {
                    logToModerator("Cannot send an empty message (message was: '" + message + "').", "Warning"); 
                }
            });
            messageInput.addEventListener('keypress', (e) => {
                 if (e.key === 'Enter') {
                    sendMessageBtn.click(); 
                 }
            });
            
            manualShowIsWerewolfBtn.addEventListener('click', () => sendWebSocketMessage('manual_reveal', { payload: { alignment: "Is a Werewolf" } }));
            manualShowNotWerewolfBtn.addEventListener('click', () => sendWebSocketMessage('manual_reveal', { payload: { alignment: "Not a Werewolf" } }));
            manualShowVillageTeamBtn.addEventListener('click', () => sendWebSocketMessage('manual_reveal', { payload: { alignment: "Village Alignment" } }));
            manualShowWerewolfTeamBtn.addEventListener('click', () => sendWebSocketMessage('manual_reveal', { payload: { alignment: "Werewolf Alignment" } }));

            // Initial setup
            connectWebSocket();
            fetchServerVersion(); 
            loadGamesList();
            loadMasterPlayers();
            hideAllGameSpecificSections(); 
            renderPlayerListForCurrentGame(); 
        });
    </script>
</body>
</html>
```
```javascript
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

const SERVER_VERSION = "0.8.3"; // Server version

// --- In-Memory Data Stores ---
let masterPlayerList = []; // Array of player objects { id: string, name: string }
let games = {}; 

const ALL_ROLES_SERVER = {
    VILLAGER: { name: "Villager", description: "Find and eliminate the werewolves.", team: "Good", alignment: "Village" },
    WEREWOLF: { name: "Werewolf", description: "Eliminate the villagers to win.", team: "Evil", alignment: "Werewolf" },
    SEER: { name: "Seer", description: "Each night, you may learn the alignment of one player.", team: "Good", alignment: "Village" }
};

// --- Helper Functions ---
function getPlayerByName(playerName) {
    if (!playerName) return null;
    return masterPlayerList.find(p => p.name.toLowerCase() === playerName.toLowerCase());
}

function broadcastToGameClients(gameId, messageObject) {
    console.log("SERVER: Broadcasting to WS clients:", JSON.stringify(messageObject));
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            // Add gameId to the message if not present, for client-side filtering if needed
            // However, our current display.html doesn't filter by gameId for WS messages
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
    if (game.gameWinner && game.gameWinner.team) return game.gameWinner; // Game already decided

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

app.get('/api/master-players', (req, res) => res.json(masterPlayerList));

app.post('/api/master-players', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ message: 'Player name is required.' });
    const trimmedName = name.trim();
    if (masterPlayerList.find(p => p.name.toLowerCase() === trimmedName.toLowerCase())) return res.status(409).json({ message: 'Player already exists.' });
    const newPlayer = { id: 'player_' + Date.now(), name: trimmedName };
    masterPlayerList.push(newPlayer);
    console.log('Added to master list:', newPlayer);
    res.status(201).json(newPlayer);
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
    console.log('New game:', games[newGameId].gameName);
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

app.post('/api/games/:gameId/players', (req, res) => {
    const game = games[req.params.gameId];
    const { players: playerNamesFromClient } = req.body;
    if (!game) return res.status(404).json({ message: 'Game not found.' });
    if (game.gameWinner) return res.status(400).json({ message: 'Cannot modify players, game already finished.' });
    if (!Array.isArray(playerNamesFromClient)) return res.status(400).json({ message: 'Invalid player list.' });

    const newPlayersInGame = {}; const newPlayerOrder = [];
    playerNamesFromClient.forEach(name => {
        const masterPlayer = getPlayerByName(name);
        if (masterPlayer) {
            newPlayersInGame[name] = game.playersInGame[name] || { id: masterPlayer.id, roleName: null, roleDetails: null, status: 'alive' };
            newPlayerOrder.push(name);
        }
    });
    game.playersInGame = newPlayersInGame; game.playerOrder = newPlayerOrder;
    if (game.seerPlayerName && !game.playersInGame[game.seerPlayerName]) game.seerPlayerName = null;
    if (game.werewolfNightTarget && !game.playersInGame[game.werewolfNightTarget]) game.werewolfNightTarget = null;
    console.log('Players updated for game', game.gameId);
    res.status(200).json(game); 
});

app.post('/api/games/:gameId/assign-roles', (req, res) => {
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
    game.playerOrder.forEach((playerName, index) => {
        const assignedRoleDetails = rolesToAssign[index];
        const masterPlayer = getPlayerByName(playerName);
        newPlayersInGameData[playerName] = { id: masterPlayer ? masterPlayer.id : 'uid_' + playerName, roleName: assignedRoleDetails.name, roleDetails: assignedRoleDetails, status: 'alive' };
        if (assignedRoleDetails.name === "Seer") game.seerPlayerName = playerName;
    });
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
            // Only set "no one eliminated" if it was actually night and no valid target was processed
            // Avoids this message on first day or if day is started from a non-night phase
            eliminationResult.specialInfo = "No one was eliminated by werewolves.";
            console.log("No werewolf elimination in game " + game.gameId + " (target: " + game.werewolfNightTarget + ")");
        }
        
        // Always check win conditions when transitioning to day if not already done by WW kill check.
        if (!game.gameWinner) { 
             checkWinConditions(game);
        }
        
        game.werewolfNightTarget = null; 
        game.playersOnTrial = []; game.votes = {}; 
    }
    
    // Pass eliminationResult and gameWinner in the game object itself for the client to use
    const gameResponse = { ...game, eliminationResult: eliminationResult };
    res.status(200).json(gameResponse); 
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

    let actualEliminationMessage = "No one was eliminated by vote."; // Will be part of game.gameLog
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

    // game_over WS message is sent by checkWinConditions if applicable.
    // The HTTP response includes the full game state which the client will use to reload.
    res.status(200).json(game); 
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
        // console.log('WS Received:', messageString); // Can be very verbose
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
