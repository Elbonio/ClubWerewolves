// server.js
// To run this:
// 1. Make sure you have Node.js installed.
// 2. Install the 'ws' library: npm install ws
// 3. Save this code as server.js and run from your terminal: node server.js

const WebSocket = require('ws');
const http = require('http'); // For serving HTML files
const fs = require('fs');     // For reading HTML files
const path = require('path'); // For constructing file paths

// --- HTTP Server to serve HTML files ---
const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    // Improved routing for default paths and specific HTML files
    if (req.url === '/' || req.url === '/moderator') {
        filePath = path.join(__dirname, 'moderator.html');
    } else if (req.url === '/display') {
        filePath = path.join(__dirname, 'display.html');
    } else if (req.url === '/moderator.html') {
         filePath = path.join(__dirname, 'moderator.html');
    } else if (req.url === '/display.html') {
        filePath = path.join(__dirname, 'display.html');
    } else {
        // Fallback for potentially other files - more robust check
        // Ensure the path doesn't try to go above the current directory for security
        const safeSuffix = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '');
        const potentialFilePath = path.join(__dirname, safeSuffix);

        if (fs.existsSync(potentialFilePath) && fs.lstatSync(potentialFilePath).isFile()) {
            filePath = potentialFilePath;
        } else {
            console.log('File not found attempt: ' + req.url + ' resolved to ' + potentialFilePath);
            res.writeHead(404);
            res.end('File not found: ' + req.url);
            return;
        }
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        // '.css': 'text/css', // Example if you add CSS files
        // '.js': 'application/javascript', // Example if you add client-side JS files
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                console.error('Error serving file (ENOENT): ' + filePath);
                res.writeHead(404);
                res.end('File not found: ' + filePath);
            } else {
                console.error('Server error reading file: ' + error.code);
                res.writeHead(500);
                res.end('Server error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
}); // Closes http.createServer


// --- WebSocket Server ---
// Attach WebSocket server to the existing HTTP server
const wss = new WebSocket.Server({ server });


// Keep track of all connected clients
const clients = new Set();

// Global error handler for the WebSocket server itself (e.g., if port is in use)
wss.on('error', (error) => {
    console.error('[WebSocket Server Error]', error);
    if (error.code === 'EADDRINUSE') {
        // Using string concatenation for wider compatibility
        let portInUse = process.env.PORT || 8080; // Default
        if (server && server.address() && server.address().port) {
            portInUse = server.address().port;
        }
        console.error('Failed to start server: Port ' + portInUse + ' is already in use.');
        console.error('Please close the other application using this port or change the port in server.js.');
    } else {
        console.error('An unexpected error occurred with the WebSocket server.');
    }
    if (error.code === 'EADDRINUSE') {
        process.exit(1); 
    }
}); // Closes wss.on('error')


wss.on('connection', function connection(ws, req) {
    try { 
        const clientIp = req.socket ? req.socket.remoteAddress : 'unknown IP'; 
        console.log('Attempting to handle new connection from ' + clientIp + '.');

        clients.add(ws);
        console.log('Client from ' + clientIp + ' added to set. Total clients: ' + clients.size);

        ws.on('message', function incoming(message) {
            try { 
                const messageString = message.toString();
                console.log('Received message from client (' + clientIp + '): ' + messageString);
                
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        try {
                            const parsedMessage = JSON.parse(messageString); 
                            if (parsedMessage.type === 'moderator_message' && typeof parsedMessage.content === 'string') {
                                client.send(JSON.stringify({ type: 'display_update', content: parsedMessage.content }));
                            } else {
                                console.warn('Client (' + clientIp + ') - Received unexpected message structure: ' + messageString);
                                client.send(messageString); 
                            }
                        } catch (e) {
                            console.warn('Client (' + clientIp + ') - Received non-JSON message or parse error during broadcast: ' + messageString + '. Broadcasting raw. Error: ' + e.message);
                            client.send(messageString);
                        }
                    }
                }); // Closes forEach
            } catch (e) {
                console.error('Error in "message" handler for client (' + clientIp + '):', e);
            }
        }); // Closes ws.on('message')

        ws.on('close', (code, reason) => {
            const reasonString = reason.toString(); 
            console.log('Client (' + clientIp + ') disconnected. Code: ' + code + ', Reason: "' + reasonString + '".');
            clients.delete(ws); 
            console.log('Client from (' + clientIp + ') removed from set. Total clients: ' + clients.size);
        }); // Closes ws.on('close')

        ws.on('error', (error) => {
            console.error('WebSocket error on client (' + clientIp + '):', error);
        }); // Closes ws.on('error')

        console.log('Successfully set up event handlers for client (' + clientIp + ').');

    } catch (e) {
        console.error('FATAL ERROR in wss.on("connection") handler:', e);
        if (ws && typeof ws.terminate === 'function') {
            ws.terminate(); 
        }
    } 
}); // This is the closing brace and parenthesis for wss.on('connection', ...)


// Start the HTTP server (which now also hosts the WebSocket server)
const port = process.env.PORT || 8080; 
server.listen(port, () => {
    // Using string concatenation for all console logs for maximum compatibility
    console.log('HTTP and WebSocket server running on port ' + port);
    console.log('Moderator panel available at: http://localhost:' + port + '/moderator.html (or / or /moderator)');
    console.log('Display panel available at: http://localhost:' + port + '/display.html (or /display)');
}); // Closes server.listen callback

console.log('Initializing Werewolf Game HTTP and WebSocket server...');
// --- End of server.js ---