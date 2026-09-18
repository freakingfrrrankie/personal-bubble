

const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL_MS = 30000; // how often we check for dead connections

//health-check
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Presence WebSocket server is running.\n');
});

const wss = new WebSocket.Server({ server });

// sid -> Set of open ws connections sharing that sid
const sessionConnections = new Map();

function broadcastCount() {
  const count = sessionConnections.size;
  const payload = JSON.stringify({ type: 'count', count });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });

  console.log(`[${new Date().toISOString()}] distinct tabs: ${count} (raw connections: ${wss.clients.size})`);
}

function getSid(req) {
  try {
    const { searchParams } = new URL(req.url, 'http://placeholder');
    const sid = searchParams.get('sid');
    if (sid) return sid.slice(0, 100); 
  } catch (err) {
    // anonymous fallback below
  }
  // uncoordinated visitor 
  return `anon-${Math.random().toString(36).slice(2)}`;
}

wss.on('connection', (ws, req) => {
  const sid = getSid(req);
  ws.sid = sid;

  if (!sessionConnections.has(sid)) {
    sessionConnections.set(sid, new Set());
  }
  sessionConnections.get(sid).add(ws);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // NEW COUNT
  broadcastCount();

  ws.on('close', () => {
    const set = sessionConnections.get(sid);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        sessionConnections.delete(sid);
      }
    }
    // A tab's last connection closed / lost connection -> broadcast.
    broadcastCount();
  });

  ws.on('error', () => {
    // avoid an unhandled error crash.
  });
});

// pingpong check finds and drops

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate(); // triggers 'close' 
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Presence server listening on port ${PORT}`);
});
