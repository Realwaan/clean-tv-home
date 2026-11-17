// Clean TV Remote & Screen Cast Server for Samsung Smart TV
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tvArgIdx = process.argv.indexOf('--tv');
const TV_IP = (tvArgIdx !== -1 && process.argv[tvArgIdx + 1]) || process.env.TV_IP || '192.168.254.113';
const PORT = Number(process.env.PORT || 5050);
const CLI_CANDIDATES = [
  path.resolve(__dirname, '../../apps2samsung/apps2samsung-cli.exe'),
  path.resolve(__dirname, '../apps2samsung/apps2samsung-cli.exe'),
  'apps2samsung-cli'
];
const CLI_PATH = CLI_CANDIDATES.find((c) => c === 'apps2samsung-cli' || fs.existsSync(c)) || 'apps2samsung-cli';
const TOKEN_PATH = path.resolve(__dirname, 'tv_token.txt');
const PUBLIC_DIR = path.resolve(__dirname, 'public');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let token = '';
if (fs.existsSync(TOKEN_PATH)) {
  try { token = fs.readFileSync(TOKEN_PATH, 'utf8').trim(); } catch (e) {}
}

let tvWs = null;
let isConnected = false;
let tvStatus = { state: 'connecting', device: null, token: !!token };

export function getLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      const virtualRe = /vEthernet|TAP|VPN|VirtualBox|VMware|WSL|Hyper-V|Loopback|ZeroTier|Tailscale/i;
      let score = 0;
      if (!virtualRe.test(name)) score += 10;
      if (/^(Ethernet|Wi-Fi|WLAN)/i.test(name)) score += 5;
      if (info.address.startsWith('192.168.')) score += 4;
      else if (info.address.startsWith('10.')) score += 2;
      candidates.push({ address: info.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address || '127.0.0.1';
}

function connectTvWebSocket() {
  if (tvWs && (tvWs.readyState === WebSocket.OPEN || tvWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const appNameBase64 = Buffer.from('CleanRemote2026').toString('base64');
  let url = `wss://${TV_IP}:8002/api/v2/channels/samsung.remote.control?name=${appNameBase64}`;
  if (token) {
    url += `&token=${token}`;
  }

  try {
    tvWs = new WebSocket(url);

    tvWs.onopen = () => {
      isConnected = true;
      tvStatus.state = 'connected';
      console.log(`[TV-WS] Connected to Samsung TV (${TV_IP})`);
    };

    tvWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'ms.channel.connect') {
          isConnected = true;
          tvStatus.state = 'authorized';
          const recToken = msg.data?.token || (msg.data?.clients?.[0]?.attributes?.token);
          if (recToken && recToken !== token) {
            token = recToken;
            fs.writeFileSync(TOKEN_PATH, token);
            tvStatus.token = true;
            console.log(`[TV-WS] Saved new TV authorization token: ${token}`);
          }
        } else if (msg.event === 'ms.channel.unauthorized') {
          tvStatus.state = 'unauthorized';
          console.warn('[TV-WS] Unauthorized. Please press "Allow" on your TV screen if prompted.');
        }
      } catch (e) {}
    };

    tvWs.onerror = () => {
      isConnected = false;
      tvStatus.state = 'error';
    };

    tvWs.onclose = () => {
      isConnected = false;
      tvStatus.state = 'disconnected';
      tvWs = null;
      setTimeout(connectTvWebSocket, 4000);
    };
  } catch (err) {
    isConnected = false;
    tvStatus.state = 'error';
    setTimeout(connectTvWebSocket, 4000);
  }
}

connectTvWebSocket();

// Poll TV basic REST API status every 15s
function checkTvApi() {
  http.get(`http://${TV_IP}:8001/api/v2/`, { timeout: 3000 }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        tvStatus.device = {
          name: json.name || json.device?.name || 'Samsung TV',
          model: json.device?.modelName || json.device?.model || 'Smart TV',
          power: json.device?.PowerState || 'on',
          os: json.device?.OS || 'Tizen',
          version: json.device?.platform_version || '6.5'
        };
      } catch (e) {}
    });
  }).on('error', () => {
    tvStatus.device = null;
  });
}
checkTvApi();
setInterval(checkTvApi, 15000);

export function sendTvKey(key) {
  return new Promise((resolve, reject) => {
    if (!tvWs || tvWs.readyState !== WebSocket.OPEN) {
      connectTvWebSocket();
      setTimeout(() => {
        if (!tvWs || tvWs.readyState !== WebSocket.OPEN) {
          return reject(new Error('TV WebSocket is not connected yet'));
        }
        dispatchKey(key, resolve, reject);
      }, 500);
    } else {
      dispatchKey(key, resolve, reject);
    }
  });
}

function dispatchKey(key, resolve, reject) {
  try {
    const payload = {
      method: 'ms.remote.control',
      params: {
        Cmd: 'Click',
        DataOfCmd: key,
        Option: 'false',
        TypeOfRemote: 'SendRemoteKey'
      }
    };
    tvWs.send(JSON.stringify(payload));
    resolve({ ok: true, key });
  } catch (err) {
    reject(err);
  }
}

export function launchApp(appId) {
  return new Promise((resolve, reject) => {
    if (CLI_PATH !== 'apps2samsung-cli' && fs.existsSync(CLI_PATH)) {
      execFile(CLI_PATH, ['launch', appId, '--tv', TV_IP, '--plain'], { timeout: 8000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve({ ok: true, appId, output: (stdout || '').trim() });
      });
      return;
    }
    if (tvWs && tvWs.readyState === WebSocket.OPEN) {
      tvWs.send(JSON.stringify({
        method: 'ms.channel.emit',
        params: {
          event: 'ed.apps.launch',
          to: 'host',
          data: { action_type: 'NATIVE_LAUNCH', appId, metaTag: '' }
        }
      }));
      resolve({ ok: true, appId, via: 'ws' });
      return;
    }
    reject(new Error('apps2samsung-cli not found and TV WebSocket is not connected'));
  });
}

export function openTvBrowserUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const trySend = () => {
      if (!tvWs || tvWs.readyState !== WebSocket.OPEN) {
        return reject(new Error('TV is offline or not authorized over WebSocket yet'));
      }
      const payload = {
        method: 'ms.channel.emit',
        params: {
          event: 'ed.apps.launch',
          to: 'host',
          data: {
            action_type: 'NATIVE_LAUNCH',
            appId: 'org.tizen.browser',
            metaTag: targetUrl
          }
        }
      };
      tvWs.send(JSON.stringify(payload));
      resolve({ ok: true, url: targetUrl });
    };

    if (!tvWs || tvWs.readyState !== WebSocket.OPEN) {
      connectTvWebSocket();
      setTimeout(trySend, 800);
    } else {
      trySend();
    }
  });
}

// =========================================================================
// Minimal Zero-Dependency RFC 6455 WebSocket Hub for Screen Casting (/ws/cast)
// =========================================================================
const castHub = {
  sender: null,
  receivers: new Map(), // id -> client
  nextId: 1,
  streamConfig: null
};

function encodeWsFrame(opcode, dataBuffer) {
  const payload = Buffer.isBuffer(dataBuffer) ? dataBuffer : Buffer.from(String(dataBuffer), 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsSendText(client, obj) {
  if (!client || client.closed || client.socket.destroyed) return;
  try {
    client.socket.write(encodeWsFrame(0x1, JSON.stringify(obj)));
  } catch (e) {}
}

function wsSendBinary(client, buf) {
  if (!client || client.closed || client.socket.destroyed) return;
  try {
    client.socket.write(encodeWsFrame(0x2, buf));
  } catch (e) {}
}

function attachWsClient(socket, role) {
  const id = `r${castHub.nextId++}`;
  const client = { id, role, socket, closed: false };
  let recvBuf = Buffer.alloc(0);
  let fragChunks = [];
  let fragOpcode = 0;

  socket.setNoDelay(true);

  if (role === 'sender') {
    if (castHub.sender && castHub.sender !== client) {
      wsSendText(castHub.sender, { type: 'replaced' });
      try { castHub.sender.socket.end(); } catch (e) {}
    }
    castHub.sender = client;
    wsSendText(client, {
      type: 'welcome',
      role: 'sender',
      id,
      lanIp: getLanIp(),
      receiverCount: castHub.receivers.size,
      receivers: Array.from(castHub.receivers.keys())
    });
  } else {
    castHub.receivers.set(id, client);
    wsSendText(client, {
      type: 'welcome',
      role: 'receiver',
      id,
      senderActive: !!castHub.sender,
      streamConfig: castHub.streamConfig
    });
    if (castHub.sender) {
      wsSendText(castHub.sender, {
        type: 'receiver-joined',
        id,
        receiverCount: castHub.receivers.size
      });
    }
  }

  function handleMessage(opcode, payload) {
    if (opcode === 0x2) {
      // Binary MSE media chunk from sender -> broadcast to all receivers
      if (client.role === 'sender') {
        for (const r of castHub.receivers.values()) {
          wsSendBinary(r, payload);
        }
      }
      return;
    }

    if (opcode !== 0x1) return;
    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch (e) {
      return;
    }

    if (client.role === 'sender') {
      if (msg.type === 'stream-config') {
        castHub.streamConfig = msg;
      }
      if (msg.to && castHub.receivers.has(msg.to)) {
        wsSendText(castHub.receivers.get(msg.to), { ...msg, from: 'sender' });
      } else {
        for (const r of castHub.receivers.values()) {
          wsSendText(r, { ...msg, from: 'sender' });
        }
      }
    } else {
      if (castHub.sender) {
        wsSendText(castHub.sender, { ...msg, from: client.id });
      }
    }
  }

  socket.on('data', (chunk) => {
    recvBuf = Buffer.concat([recvBuf, chunk]);

    while (recvBuf.length >= 2) {
      const b0 = recvBuf[0];
      const b1 = recvBuf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (recvBuf.length < 4) break;
        payloadLen = recvBuf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (recvBuf.length < 10) break;
        const bigLen = recvBuf.readBigUInt64BE(2);
        if (bigLen > 64n * 1024n * 1024n) {
          socket.destroy();
          return;
        }
        payloadLen = Number(bigLen);
        offset = 10;
      }

      const maskOffset = offset;
      if (masked) offset += 4;
      if (recvBuf.length < offset + payloadLen) break;

      const payload = Buffer.from(recvBuf.subarray(offset, offset + payloadLen));
      if (masked) {
        const mask = recvBuf.subarray(maskOffset, maskOffset + 4);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i & 3];
        }
      }
      recvBuf = recvBuf.subarray(offset + payloadLen);

      if (opcode === 0x8) {
        client.closed = true;
        try { socket.end(encodeWsFrame(0x8, Buffer.alloc(0))); } catch (e) {}
        return;
      }
      if (opcode === 0x9) {
        try { socket.write(encodeWsFrame(0xA, payload)); } catch (e) {}
        continue;
      }
      if (opcode === 0xA) continue;

      if (opcode !== 0x0) {
        fragOpcode = opcode;
        fragChunks = [payload];
      } else {
        fragChunks.push(payload);
      }

      if (fin) {
        const full = fragChunks.length === 1 ? fragChunks[0] : Buffer.concat(fragChunks);
        const op = fragOpcode;
        fragChunks = [];
        fragOpcode = 0;
        handleMessage(op, full);
      }
    }
  });

  function cleanup() {
    if (client.closed) return;
    client.closed = true;
    if (client.role === 'sender') {
      if (castHub.sender === client) {
        castHub.sender = null;
        castHub.streamConfig = null;
        for (const r of castHub.receivers.values()) {
          wsSendText(r, { type: 'sender-stopped' });
        }
      }
    } else {
      castHub.receivers.delete(id);
      if (castHub.sender) {
        wsSendText(castHub.sender, {
          type: 'receiver-left',
          id,
          receiverCount: castHub.receivers.size
        });
      }
    }
  }

  socket.on('close', cleanup);
  socket.on('error', cleanup);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json'
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // API endpoints
  if (pathname === '/api/status') {
    return sendJson(res, 200, { ...tvStatus, ip: TV_IP, isConnected });
  }

  if (pathname === '/api/key') {
    const key = parsedUrl.searchParams.get('key');
    if (!key) return sendJson(res, 400, { error: 'Missing key parameter' });
    sendTvKey(key)
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/launch') {
    const appId = parsedUrl.searchParams.get('appId');
    if (!appId) return sendJson(res, 400, { error: 'Missing appId parameter' });
    launchApp(appId)
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, 500, { error: err.message }));
    return;
  }

  if (pathname === '/api/cast/info') {
    const lanIp = getLanIp();
    return sendJson(res, 200, {
      lanIp,
      port: PORT,
      castUrl: `http://localhost:${PORT}/cast.html`,
      receiverUrl: `http://${lanIp}:${PORT}/tv-cast.html`,
      tvIp: TV_IP,
      tvOnline: !!tvStatus.device,
      wsAuthorized: !!token && isConnected,
      senderActive: !!castHub.sender,
      receiverCount: castHub.receivers.size
    });
  }

  if (pathname === '/api/cast/open-tv') {
    const lanIp = getLanIp();
    const targetUrl = `http://${lanIp}:${PORT}/tv-cast.html`;
    openTvBrowserUrl(targetUrl)
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, 503, { error: err.message, url: targetUrl }));
    return;
  }

  if (pathname === '/api/cast/miracast') {
    execFile('explorer.exe', ['ms-settings-connectabledevices:devicediscovery'], { timeout: 4000 }, () => {});
    return sendJson(res, 200, { ok: true, launched: 'ms-settings-connectabledevices:devicediscovery' });
  }

  // Static files
  let safePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (safePath === 'cast') safePath = 'cast.html';
  if (safePath === 'tv') safePath = 'tv-cast.html';
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.on('upgrade', (req, socket) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (parsedUrl.pathname !== '/ws/cast') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const role = parsedUrl.searchParams.get('role') === 'sender' ? 'sender' : 'receiver';
  attachWsClient(socket, role);
});

server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLanIp();
  console.log(`====================================================`);
  console.log(` Clean TV Remote & Screen Cast for Samsung Tizen`);
  console.log(` Target TV:    ${TV_IP} (Samsung BU8100 55)`);
  console.log(` Remote UI:    http://localhost:${PORT}`);
  console.log(` PC Cast UI:   http://localhost:${PORT}/cast.html`);
  console.log(` TV Receiver:  http://${lanIp}:${PORT}/tv-cast.html`);
  console.log(`====================================================`);
});
