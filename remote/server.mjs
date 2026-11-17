// Clean TV Remote & Screen Cast Server for Samsung Tizen & LG Smart TVs (webOS + NetCast)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadTvConfig, saveTvConfig } from './drivers/storage.mjs';
import { createSamsungDriver } from './drivers/samsung-tizen.mjs';
import { createLgWebosDriver } from './drivers/lg-webos.mjs';
import { createLgNetcastDriver } from './drivers/lg-netcast.mjs';
import { detectTvBrand, scanLanTvs } from './drivers/discovery.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : '';
}

const PORT = Number(getArg('--port') || process.env.PORT || 5050);
const CLI_CANDIDATES = [
  path.resolve(__dirname, '../../apps2samsung/apps2samsung-cli.exe'),
  path.resolve(__dirname, '../apps2samsung/apps2samsung-cli.exe'),
  'apps2samsung-cli'
];
const CLI_PATH = CLI_CANDIDATES.find((c) => c === 'apps2samsung-cli' || fs.existsSync(c)) || 'apps2samsung-cli';
const PUBLIC_DIR = path.resolve(__dirname, 'public');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const savedCfg = loadTvConfig(__dirname, { ip: '192.168.254.113', brand: 'auto' });
let activeConfig = {
  ip: getArg('--tv') || process.env.TV_IP || savedCfg.ip || '192.168.254.113',
  brand: getArg('--brand') || process.env.TV_BRAND || savedCfg.brand || 'auto'
};

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

// =========================================================================
// Active Multi-Brand TV Driver Manager
// =========================================================================
let activeDriver = null;
let currentResolvedBrand = null;
let autoProbeTimer = null;

function createDriverForBrand(brand, ip) {
  if (brand === 'lg-webos') {
    return createLgWebosDriver({ ip, dataDir: __dirname });
  }
  if (brand === 'lg-netcast') {
    return createLgNetcastDriver({ ip, dataDir: __dirname });
  }
  return createSamsungDriver({ ip, dataDir: __dirname, cliPath: CLI_PATH });
}

function mountDriver(brand, ip) {
  if (activeDriver) {
    activeDriver.destroy();
    activeDriver = null;
  }
  currentResolvedBrand = brand;
  activeDriver = createDriverForBrand(brand, ip);
  console.log(`[TV] Active driver -> ${brand} @ ${ip}`);
}

async function selectTv({ ip, brand = 'auto', persist = true }) {
  const targetIp = String(ip || activeConfig.ip).trim();
  const targetBrand = ['auto', 'samsung', 'lg-webos', 'lg-netcast'].includes(brand) ? brand : 'auto';
  activeConfig = { ip: targetIp, brand: targetBrand };
  if (persist) saveTvConfig(__dirname, activeConfig);

  clearInterval(autoProbeTimer);
  let resolved = targetBrand;
  if (resolved === 'auto') {
    const probe = await detectTvBrand(targetIp);
    resolved = probe.brand || 'samsung';
    autoProbeTimer = setInterval(async () => {
      if (activeConfig.brand !== 'auto') return;
      const st = activeDriver ? activeDriver.getStatus() : null;
      if (st && st.isConnected) return;
      const next = await detectTvBrand(activeConfig.ip);
      if (next.brand && next.brand !== currentResolvedBrand) {
        mountDriver(next.brand, activeConfig.ip);
      }
    }, 10000);
  }

  mountDriver(resolved, targetIp);
  return { ...activeDriver.getStatus(), configuredBrand: activeConfig.brand };
}

// Boot initial driver cleanly
selectTv({ ip: activeConfig.ip, brand: activeConfig.brand, persist: false });

export function sendTvKey(key) {
  if (!activeDriver) return Promise.reject(new Error('No TV driver active'));
  return activeDriver.sendKey(key);
}

export function launchApp(appId) {
  if (!activeDriver) return Promise.reject(new Error('No TV driver active'));
  return activeDriver.launchApp(appId);
}

export function openTvBrowserUrl(targetUrl) {
  if (!activeDriver) return Promise.reject(new Error('No TV driver active'));
  return activeDriver.openBrowserUrl(targetUrl);
}

// =========================================================================
// Minimal Zero-Dependency RFC 6455 WebSocket Hub for Screen Casting (/ws/cast)
// =========================================================================
const castHub = {
  sender: null,
  receivers: new Map(),
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

function readJsonBody(req) {
  return new Promise((resolve) => {
    if (req.method !== 'POST') return resolve({});
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (pathname === '/api/status') {
    const st = activeDriver ? activeDriver.getStatus() : { state: 'disconnected', brand: 'samsung', isConnected: false };
    return sendJson(res, 200, {
      ...st,
      configuredBrand: activeConfig.brand,
      ip: activeConfig.ip
    });
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

  if (pathname === '/api/tv/scan') {
    try {
      const tvs = await scanLanTvs(getLanIp());
      return sendJson(res, 200, { ok: true, tvs });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/tv/select') {
    const body = await readJsonBody(req);
    const ip = parsedUrl.searchParams.get('ip') || body.ip;
    const brand = parsedUrl.searchParams.get('brand') || body.brand || 'auto';
    if (!ip) return sendJson(res, 400, { error: 'Missing ip parameter' });
    try {
      const st = await selectTv({ ip, brand, persist: true });
      return sendJson(res, 200, { ok: true, status: st });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (pathname === '/api/tv/pair-pin') {
    const body = await readJsonBody(req);
    const pin = parsedUrl.searchParams.get('pin') ?? body.pin ?? '';
    if (!activeDriver || typeof activeDriver.submitPin !== 'function') {
      return sendJson(res, 400, { error: 'Active TV driver does not support PIN pairing' });
    }
    try {
      const result = await activeDriver.submitPin(pin);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/cast/info') {
    const lanIp = getLanIp();
    const st = activeDriver ? activeDriver.getStatus() : { brand: 'samsung', isConnected: false, token: false, device: null };
    return sendJson(res, 200, {
      lanIp,
      port: PORT,
      castUrl: `http://localhost:${PORT}/cast.html`,
      receiverUrl: `http://${lanIp}:${PORT}/tv-cast.html`,
      tvIp: activeConfig.ip,
      brand: st.brand,
      brandLabel: st.brandLabel || st.brand,
      tvName: st.device?.name || activeConfig.ip,
      tvOnline: !!st.device && st.isConnected,
      wsAuthorized: !!st.token && st.isConnected,
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
  console.log(` Clean TV Remote & Screen Cast (Samsung + LG)`);
  console.log(` Target TV:    ${activeConfig.ip} (${activeConfig.brand})`);
  console.log(` Remote UI:    http://localhost:${PORT}`);
  console.log(` PC Cast UI:   http://localhost:${PORT}/cast.html`);
  console.log(` TV Receiver:  http://${lanIp}:${PORT}/tv-cast.html`);
  console.log(`====================================================`);
});
