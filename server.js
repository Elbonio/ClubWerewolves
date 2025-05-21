// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install the 'ws' library: npm install ws
// 3. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http'); // ADD THIS
const fs = require('fs');     // ADD THIS
const path = require('path'); // ADD THIS

// Create a WebSocket server instance.
// It will listen on port 8080 by default.
const port = process.env.PORT || 8080; // NEW LINE - Use environment variable or fallback to 8080
const wss = new WebSocket.Server({ port: parseInt(port) 

// Keep track of all connected clients
const clients = new Set();

// Global error handler for the WebSocket server itself (e.g., if port is in use)
wss.on('error', (error) => {
    console.error('[WebSocket Server Error]', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Failed to start server: Port ${wss.options.port} is already in use.`);
        console.error('Please close the other application using this port or change the port in server.js.');
    } else {
        console.error('An unexpected error occurred with the WebSocket server.');
    }
    // Depending on the error, you might want to process.exit()
    // For EADDRINUSE, the server won't be functional.
    if (error.code === 'EADDRINUSE') {
        process.exit(1); // Exit if port is in use, as server cannot run.
    }
});

// console.log(`WebSocket server started and listening on port ${wss.options.port}`); // OLD LINE
wss.on('listening', () => { // MODIFIED
    console.log(`WebSocket server started and listening on port ${port}`); // Use the port variable
});

wss.on('connection', function connection(ws, req) {
    try { // Top-level try-catch for the entire connection handler
        const clientIp = req.socket ? req.socket.remoteAddress : 'unknown IP'; // Safer IP retrieval
        console.log(`Attempting to handle new connection from ${clientIp}.`);

        clients.add(ws);
        console.log(`Client from ${clientIp} added to set. Total clients: ${clients.size}`);

        ws.on('message', function incoming(message) {
            try { // try-catch for message handler logic
                const messageString = message.toString();
                console.log(`Received message from client (${clientIp}): ${messageString}`);
                
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        try {
                            const parsedMessage = JSON.parse(messageString); 
                            if (parsedMessage.type === 'moderator_message' && typeof parsedMessage.content === 'string') {
                                client.send(JSON.stringify({ type: 'display_update', content: parsedMessage.content }));
                            } else {
                                console.warn(`Client (${clientIp}) - Received unexpected message structure: ${messageString}`);
                                client.send(messageString); 
                            }
                        } catch (e) {
                            console.warn(`Client (${clientIp}) - Received non-JSON message or parse error during broadcast: ${messageString}. Broadcasting raw. Error: ${e.message}`);
                            client.send(messageString);
                        }
                    }
                });
            } catch (e) {
                console.error(`Error in 'message' handler for client (${clientIp}):`, e);
                // ws.terminate(); // Optionally terminate this client if message handling is critical
            }
        });

        ws.on('close', (code, reason) => {
            const reasonString = reason.toString(); 
            console.log(`Client (${clientIp}) disconnected. Code: ${code}, Reason: '${reasonString}'.`);
            clients.delete(ws); 
            console.log(`Client from (${clientIp}) removed from set. Total clients: ${clients.size}`);
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error on client (${clientIp}):`, error);
            // The 'close' event will usually follow an error that causes disconnection.
            // clients.delete(ws) is typically handled in 'onclose'.
        });

        console.log(`Successfully set up event handlers for client (${clientIp}).`);

    } catch (e) {
        console.error('FATAL ERROR in wss.on("connection") handler:', e);
        if (ws && typeof ws.terminate === 'function') {
            ws.terminate(); // Try to clean up the specific ws connection if it exists
        }
    }
});

// The ping/pong mechanism was commented out previously and remains so.
// For long-lived connections, especially over networks with aggressive proxies/firewalls,
// a proper ping/pong or application-level keep-alive might be necessary.

console.log('Initializing Werewolf Game WebSocket server...'); // This logs before 'listening' or 'error'
