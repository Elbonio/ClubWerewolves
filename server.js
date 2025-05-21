```javascript
// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install the 'ws' library: npm install ws
// 3. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// --- HTTP Server to serve HTML files ---
const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './moderator.html'; // Or an index page if you create one
    }

    // Determine the correct file to serve
    if (req.url === '/' || req.url === '/moderator' || req.url === '/moderator.html') {
        filePath = path.join(__dirname, 'moderator.html');
    } else if (req.url === '/display' || req.url === '/display.html') {
        filePath = path.join(__dirname, 'display.html');
    } else {
        res.writeHead(404);
        res.end('File not found: ' + req.url); // Respond for unhandled paths
        return;
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404);
                res.end('File not found: ' + filePath);
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});



// Create a WebSocket server instance.
// It will listen on port 8080 by default.
const wss = new WebSocket.Server({ server }); // 'server' is the http.createServer instance

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

const port = process.env.PORT || 8080; // For dynamic port assignment by hosting
server.listen(port, () => {
    console.log(`HTTP and WebSocket server running on port ${port}`);
    console.log(`Moderator panel: http://localhost:${port}/moderator.html`); // Or just /
    console.log(`Display panel: http://localhost:${port}/display.html`);
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