// Minimal WebSocket server that tracks how many browser tabs are
// currently connected and broadcasts that count to everyone, live.
//
// Run locally:   npm install && npm start
// Deploy: see the deployment guide that came with this project.

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL_MS = 30000; // how often we check for dead connections

// A plain HTTP server so the host has something to health-check,
// and so we have something to attach the WebSocket server to.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Presence WebSocket server is running.\n');
});

const wss = new WebSocket.Server({ server });

function broadcastCount() {
  const count = wss.clients.size;
  const payload = JSON.stringify({ type: 'count', count });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });

  console.log(`[${new Date().toISOString()}] visitors: ${count}`);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // A new tab joined -> everyone's count goes up by one.
  broadcastCount();

  ws.on('close', () => {
    // A tab closed / lost connection -> everyone's count goes down by one.
    broadcastCount();
  });

  ws.on('error', () => {
    // Let 'close' handle the broadcast; just avoid an unhandled error crash.
  });
});

// Browsers don't always send a clean "close" frame (phone locks, WiFi drops,
// laptop lids closing, etc). This periodic ping/pong check finds and drops
// connections that have gone silent, so the count stays accurate.
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate(); // triggers 'close' above, which re-broadcasts
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Presence server listening on port ${PORT}`);
});
