#!/usr/bin/env node
// Comprehensive automated verification suite for Clean TV Home (Samsung Tizen + LG webOS + LG NetCast).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { packageLgIpk } from './package-lg.mjs';
import { createLgWebosDriver } from '../remote/drivers/lg-webos.mjs';
import { createLgNetcastDriver } from '../remote/drivers/lg-netcast.mjs';
import { createSamsungDriver } from '../remote/drivers/samsung-tizen.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

// =========================================================================
// Check 1: Static Syntax, ES5 & CSS Variable Audit
// =========================================================================
function checkStatic() {
  console.log('[1/4] Running static ES5, CSS, and syntax audit...');
  const mjsFiles = [
    'tools/package-lg.mjs',
    'tools/verify-all.mjs',
    'remote/server.mjs',
    'remote/turn_off_tv.mjs',
    'remote/drivers/storage.mjs',
    'remote/drivers/wol.mjs',
    'remote/drivers/samsung-tizen.mjs',
    'remote/drivers/lg-webos.mjs',
    'remote/drivers/lg-netcast.mjs',
    'remote/drivers/discovery.mjs'
  ];
  for (const rel of mjsFiles) {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)]);
  }

  const css = fs.readFileSync(path.join(ROOT, 'app', 'css', 'home.css'), 'utf8');
  assert.equal((css.match(/var\(--/g) || []).length, 0, 'home.css must have zero CSS var(--...) tokens for webOS 1-3');
  assert.ok(css.includes('cursor: pointer;'), 'home.css must include cursor: pointer for Magic Remote');

  const appJsDir = path.join(ROOT, 'app', 'js');
  for (const f of fs.readdirSync(appJsDir)) {
    if (!f.endsWith('.js')) continue;
    const full = path.join(appJsDir, f);
    execFileSync(process.execPath, ['--check', full]);
    const code = stripComments(fs.readFileSync(full, 'utf8'));
    assert.equal(code.match(/\b(const|let)\s+/)?.length || 0, 0, `${f} must stay ES5 (no const/let)`);
    assert.equal(code.match(/=>/)?.length || 0, 0, `${f} must stay ES5 (no arrow functions)`);
  }

  const tvCastHtml = fs.readFileSync(path.join(ROOT, 'remote', 'public', 'tv-cast.html'), 'utf8');
  const tvCastScript = tvCastHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  const strippedTvCast = stripComments(tvCastScript);
  assert.equal(strippedTvCast.match(/\b(const|let)\s+/)?.length || 0, 0, 'tv-cast.html script must stay ES5');
  assert.equal(strippedTvCast.match(/=>/)?.length || 0, 0, 'tv-cast.html script must stay ES5');
  console.log('  -> PASS: Syntax, ES5 & CSS checks clean');
}

// =========================================================================
// Check 2: Binary .ipk Archive & Tar Layout Audit
// =========================================================================
function parseAr(buf) {
  assert.equal(buf.subarray(0, 8).toString('ascii'), '!<arch>\n', 'Invalid ar magic');
  const members = [];
  let off = 8;
  while (off < buf.length) {
    assert.ok(off + 60 <= buf.length, 'Truncated ar member header');
    const hdr = buf.subarray(off, off + 60);
    assert.equal(hdr.subarray(58, 60).toString('ascii'), '`\n', 'Invalid ar trailer');
    const name = hdr.subarray(0, 16).toString('ascii').trim();
    const size = parseInt(hdr.subarray(48, 58).toString('ascii').trim(), 10);
    off += 60;
    const data = buf.subarray(off, off + size);
    assert.equal(data.length, size, `Truncated payload for ${name}`);
    members.push({ name, data });
    off += size + (size % 2);
  }
  assert.equal(off, buf.length, 'Unexpected trailing bytes in .ipk');
  return members;
}

function parseTarNames(tarBuf) {
  const files = new Map();
  let off = 0;
  while (off + 512 <= tarBuf.length) {
    const hdr = tarBuf.subarray(off, off + 512);
    if (hdr.every((b) => b === 0)) break;
    assert.equal(hdr.subarray(257, 262).toString('ascii'), 'ustar', 'Invalid ustar magic');
    const name = hdr.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = hdr.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(hdr.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0;
    const typeflag = String.fromCharCode(hdr[156]);
    off += 512;
    const content = typeflag === '0' ? tarBuf.subarray(off, off + size) : Buffer.alloc(0);
    files.set(fullName, { typeflag, content });
    if (size > 0) off += Math.ceil(size / 512) * 512;
  }
  return files;
}

function checkIpkBinary() {
  console.log('[2/4] Building & auditing LG .ipk binary...');
  const ipkPath = packageLgIpk();
  const ipkBuf = fs.readFileSync(ipkPath);
  const members = parseAr(ipkBuf);
  assert.deepEqual(members.map((m) => m.name), ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
  assert.equal(members[0].data.toString('ascii'), '2.0\n');

  const controlTar = zlib.gunzipSync(members[1].data);
  const controlMap = parseTarNames(controlTar);
  const controlTxt = controlMap.get('./control')?.content.toString('utf8') || '';
  assert.ok(controlTxt.includes('Package: org.cleantv.home'), 'Missing Package in control');
  assert.ok(controlTxt.includes('webOS-Package-Format-Version: 2'), 'Missing webOS-Package-Format-Version');

  const dataTar = zlib.gunzipSync(members[2].data);
  const dataMap = parseTarNames(dataTar);
  assert.ok(dataMap.has('usr/palm/packages/org.cleantv.home/packageinfo.json'), 'Missing packageinfo.json');
  assert.ok(dataMap.has('usr/palm/applications/org.cleantv.home/appinfo.json'), 'Missing appinfo.json');
  assert.ok(dataMap.has('usr/palm/applications/org.cleantv.home/icon80.png'), 'Missing icon80.png');
  assert.ok(dataMap.has('usr/palm/applications/org.cleantv.home/icon130.png'), 'Missing icon130.png');
  assert.ok(!dataMap.has('usr/palm/applications/org.cleantv.home/config.xml'), 'Tizen config.xml must be excluded from .ipk');
  console.log(`  -> PASS: Verified valid .ipk (${ipkBuf.length} bytes, ${dataMap.size} tar entries)`);
}

// =========================================================================
// Minimal Mock WebSocket Frame Helpers for Driver Tests
// =========================================================================
function encodeWsText(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let hdr;
  if (len < 126) {
    hdr = Buffer.from([0x81, len]);
  } else {
    hdr = Buffer.allocUnsafe(4);
    hdr[0] = 0x81;
    hdr[1] = 126;
    hdr.writeUInt16BE(len, 2);
  }
  return Buffer.concat([hdr, payload]);
}

function attachMockWs(server, onConnection) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    let buf = Buffer.alloc(0);
    const listeners = [];
    const client = {
      path: req.url,
      send: (s) => { if (!socket.destroyed) socket.write(encodeWsText(s)); },
      onMessage: (fn) => listeners.push(fn),
      close: () => { try { socket.end(); } catch (e) {} }
    };
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        const maskOff = off;
        if (masked) off += 4;
        if (buf.length < off + len) break;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (masked) {
          const m = buf.subarray(maskOff, maskOff + 4);
          for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
        }
        buf = buf.subarray(off + len);
        if (opcode === 0x8) { try { socket.end(); } catch (e) {} return; }
        if (opcode === 0x1) {
          const txt = payload.toString('utf8');
          listeners.forEach((fn) => fn(txt));
        }
      }
    });
    onConnection(client);
  });
}

async function waitFor(pred, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Timed out waiting for condition');
}

// =========================================================================
// Check 3: Ephemeral Local Mock TV Servers for All 3 Drivers
// =========================================================================
async function checkMockDrivers() {
  console.log('[3/4] Testing LG webOS, LG NetCast, and Samsung Tizen drivers against mock TV servers...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleantv-drv-'));

  // 3a. Mock LG webOS Server
  const lgEvents = { launches: [], opens: [], pointerMsgs: [], turnedOff: false, registerPayload: null };
  const lgServer = http.createServer();
  await new Promise((r) => lgServer.listen(0, '127.0.0.1', r));
  const lgPort = lgServer.address().port;

  attachMockWs(lgServer, (client) => {
    if (client.path === '/pointer') {
      client.onMessage((msg) => lgEvents.pointerMsgs.push(msg));
      return;
    }
    client.onMessage((raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'register') {
        lgEvents.registerPayload = msg.payload;
        assert.equal(msg.payload?.manifest?.signatures, undefined, 'LG register manifest must NOT include blacklisted signatures');
        client.send(JSON.stringify({
          id: msg.id,
          type: 'registered',
          payload: { 'client-key': 'lg_test_key_999' }
        }));
      } else if (msg.uri === 'ssap://system/getSystemInfo') {
        client.send(JSON.stringify({ id: msg.id, type: 'response', payload: { modelName: 'OLED55C3' } }));
      } else if (msg.uri === 'ssap://com.webos.service.update/getCurrentSWInformation') {
        client.send(JSON.stringify({ id: msg.id, type: 'response', payload: { product_name: 'webOSTV 23' } }));
      } else if (msg.uri === 'ssap://com.webos.service.networkinput/getPointerInputSocket') {
        client.send(JSON.stringify({
          id: msg.id,
          type: 'response',
          payload: { socketPath: `ws://127.0.0.1:${lgPort}/pointer` }
        }));
      } else if (msg.uri === 'ssap://system.launcher/launch') {
        lgEvents.launches.push(msg.payload);
        client.send(JSON.stringify({ id: msg.id, type: 'response', payload: { returnValue: true } }));
      } else if (msg.uri === 'ssap://system.launcher/open') {
        lgEvents.opens.push(msg.payload);
        client.send(JSON.stringify({ id: msg.id, type: 'response', payload: { returnValue: true } }));
      } else if (msg.uri === 'ssap://system/turnOff') {
        lgEvents.turnedOff = true;
        client.send(JSON.stringify({ id: msg.id, type: 'response', payload: { returnValue: true } }));
      }
    });
  });

  const lgDrv = createLgWebosDriver({
    ip: '127.0.0.1',
    dataDir: tempDir,
    ports: { ws: lgPort, wss: lgPort, preferWs: true }
  });

  await waitFor(() => lgDrv.getStatus().state === 'authorized');
  await waitFor(() => lgDrv.getStatus().device?.model === 'OLED55C3');
  await new Promise((r) => setTimeout(r, 120)); // allow pointer socket open

  await lgDrv.sendKey('KEY_UP');
  await lgDrv.launchApp('TvHome0001.Home');
  await lgDrv.launchApp('tUb3Xq7Lm9.Tube');
  await lgDrv.openBrowserUrl('http://192.168.254.104:5050/tv-cast.html');
  await lgDrv.sendKey('KEY_POWER');

  assert.ok(lgEvents.pointerMsgs.includes('type:button\nname:UP\n\n'), 'LG pointer socket missing UP button');
  assert.deepEqual(lgEvents.launches.map((l) => l.id), ['org.cleantv.home', 'youtube.leanback.v4']);
  assert.equal(lgEvents.opens[0]?.target, 'http://192.168.254.104:5050/tv-cast.html');
  assert.equal(lgEvents.turnedOff, true);
  const tokensSaved = JSON.parse(fs.readFileSync(path.join(tempDir, 'tv_tokens.json'), 'utf8'));
  assert.equal(tokensSaved['127.0.0.1']?.lgClientKey, 'lg_test_key_999');
  lgDrv.destroy();
  lgServer.close();

  // 3b. Mock LG NetCast Server
  const netcastCommands = [];
  const ncServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/roap/api/auth') {
        if (body.includes('AuthKeyReq')) {
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          res.end('<?xml version="1.0" encoding="utf-8"?><envelope><ROAPError>200</ROAPError></envelope>');
          return;
        }
        if (body.includes('<value>654321</value>')) {
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          res.end('<?xml version="1.0" encoding="utf-8"?><envelope><ROAPError>200</ROAPError><session>netcast_sess_77</session></envelope>');
          return;
        }
      }
      if (req.url === '/roap/api/command') {
        netcastCommands.push(body);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<?xml version="1.0" encoding="utf-8"?><envelope><ROAPError>200</ROAPError></envelope>');
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => ncServer.listen(0, '127.0.0.1', r));
  const ncPort = ncServer.address().port;

  const ncDrv = createLgNetcastDriver({ ip: '127.0.0.1', dataDir: tempDir, port: ncPort });
  await waitFor(() => ncDrv.getStatus().state === 'pin_required');
  await ncDrv.submitPin('654321');
  assert.equal(ncDrv.getStatus().state, 'authorized');
  await ncDrv.sendKey('KEY_VOLUP');
  assert.ok(netcastCommands[0]?.includes('<value>24</value>') && netcastCommands[0]?.includes('<session>netcast_sess_77</session>'));
  ncDrv.destroy();
  ncServer.close();

  // 3c. Mock Samsung Tizen Server
  const samPayloads = [];
  const samServer = http.createServer((req, res) => {
    if (req.url === '/api/v2/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Mock Samsung TV', device: { modelName: 'UA55BU8100', wifiMac: 'AA:BB:CC:DD:EE:FF', OS: 'Tizen' } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => samServer.listen(0, '127.0.0.1', r));
  const samPort = samServer.address().port;
  attachMockWs(samServer, (client) => {
    client.send(JSON.stringify({ event: 'ms.channel.connect', data: { token: 'sam_tok_111' } }));
    client.onMessage((raw) => samPayloads.push(JSON.parse(raw)));
  });

  const samDrv = createSamsungDriver({
    ip: '127.0.0.1',
    dataDir: tempDir,
    ports: { ssl: samPort, ws: samPort, rest: samPort, preferWs: true }
  });
  await waitFor(() => samDrv.getStatus().state === 'authorized');
  await samDrv.sendKey('KEY_HOME');
  await samDrv.openBrowserUrl('http://192.168.254.104:5050/tv-cast.html');
  await waitFor(() => samPayloads.length >= 2);
  assert.equal(samPayloads[0]?.params?.DataOfCmd, 'KEY_HOME');
  assert.equal(samPayloads[1]?.params?.event, 'ed.apps.launch');
  assert.equal(samPayloads[1]?.params?.data?.metaTag, 'http://192.168.254.104:5050/tv-cast.html');
  samDrv.destroy();
  samServer.close();

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('  -> PASS: All 3 TV drivers (LG webOS, LG NetCast, Samsung Tizen) verified');
}

// =========================================================================
// Check 4: Real Headless Chrome Verification of app/index.html in LG webOS Mode
// =========================================================================
function findBrowserBin() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function checkHeadlessBrowser() {
  console.log('[4/4] Verifying app/index.html in Headless Chrome (LG webOS Magic Remote + 5 styles)...');
  const browserBin = findBrowserBin();
  assert.ok(browserBin, 'Chrome or Edge binary not found for headless verification');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleantv-cdp-'));
  const proc = spawn(browserBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let wsBaseUrl = '';
  try {
    wsBaseUrl = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('Headless browser DevTools timeout')), 8000);
      proc.stderr.on('data', (d) => {
        stderr += d.toString('utf8');
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Browser exited early (${code}): ${stderr}`));
      });
    });

    const httpBase = wsBaseUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*/, '');
    const targets = await fetch(`${httpBase}/json/list`).then((r) => r.json());
    const pageTarget = targets.find((t) => t.type === 'page');
    assert.ok(pageTarget?.webSocketDebuggerUrl, 'No CDP page target found');

    const cdpWs = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((r) => { cdpWs.onopen = r; });

    let cdpId = 1;
    const cdpPending = new Map();
    const exceptions = [];
    cdpWs.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        exceptions.push(msg.params?.exceptionDetails?.text || 'Runtime error');
      }
      if (msg.id && cdpPending.has(msg.id)) {
        const { resolve, reject } = cdpPending.get(msg.id);
        cdpPending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    function cdp(method, params = {}) {
      const id = cdpId++;
      return new Promise((resolve, reject) => {
        cdpPending.set(id, { resolve, reject });
        cdpWs.send(JSON.stringify({ id, method, params }));
      });
    }

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
    });

    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__LUNA_CALLS__ = [];
        window.PalmServiceBridge = function () {};
        window.PalmServiceBridge.prototype.cancel = function () {};
        window.PalmServiceBridge.prototype.call = function (uri, paramsRaw) {
          var self = this;
          var parsed = {};
          try { parsed = JSON.parse(paramsRaw || '{}'); } catch (e) {}
          window.__LUNA_CALLS__.push({ uri: uri, params: parsed });
          setTimeout(function () {
            if (!self.onservicecallback) return;
            if (uri.indexOf('listLaunchPoints') >= 0 || uri.indexOf('getAllInputStatus') >= 0) {
              self.onservicecallback(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'ACG denied (simulated unrooted webOS)' }));
            } else {
              self.onservicecallback(JSON.stringify({ returnValue: true, wifi: { state: 'connected' } }));
            }
          }, 5);
        };
      `
    });

    const appUrl = pathToFileURL(path.join(ROOT, 'app', 'index.html')).href;
    await cdp('Page.navigate', { url: appUrl });
    await new Promise((r) => setTimeout(r, 900));

    const checkRes = await cdp('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const out = {
          platform: window.TH.platform,
          headerTexts: Array.from(document.querySelectorAll('#header .hbtn')).map(n => n.textContent),
          tileNames: Array.from(document.querySelectorAll('.tile .name')).map(n => n.textContent),
          stylesVisited: []
        };
        const styleKeys = [49, 50, 51, 52, 53];
        for (const kc of styleKeys) {
          document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: kc, bubbles: true }));
          out.stylesVisited.push(document.body.className);
        }
        // Return to Cinema (1)
        document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 49, bubbles: true }));
        // Test LG remote BACK keyCode 461
        document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 461, bubbles: true }));
        // Test Magic Remote click on YouTube & Movy tiles
        const tiles = Array.from(document.querySelectorAll('.tile'));
        const ytTile = tiles.find(t => t.textContent.includes('YouTube'));
        const movyTile = tiles.find(t => t.textContent.includes('Movy'));
        if (ytTile) ytTile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        if (movyTile) movyTile.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        out.lunaCalls = window.__LUNA_CALLS__;
        return out;
      })()`
    });

    const val = checkRes.result?.value;
    assert.equal(exceptions.length, 0, `Page runtime exceptions: ${exceptions.join('; ')}`);
    assert.equal(val.platform, 'webos', 'Platform detection must select webos');
    assert.ok(val.headerTexts.includes('LG Home'), `Header missing LG Home button: ${val.headerTexts}`);
    assert.deepEqual(
      val.stylesVisited.map((c) => c.split(' ').find((s) => s.startsWith('style-'))),
      ['style-cinema', 'style-guide', 'style-editorial', 'style-gallery', 'style-lounge']
    );
    const launchCalls = val.lunaCalls.filter((c) => c.uri === 'luna://com.webos.applicationManager/launch');
    assert.ok(launchCalls.some((c) => c.params.id === 'youtube.leanback.v4'), 'Magic Remote click did not launch YouTube on webOS');
    assert.ok(launchCalls.some((c) => c.params.id === 'com.webos.app.browser' && c.params.params?.target === 'https://www.movy.sx/'), 'Magic Remote click did not open Movy in LG Browser');

    cdpWs.close();
    console.log('  -> PASS: Real headless browser rendered all 5 styles & verified Magic Remote + webOS ACG fallback');
  } finally {
    try { proc.kill('SIGKILL'); } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

(async () => {
  checkStatic();
  checkIpkBinary();
  await checkMockDrivers();
  await checkHeadlessBrowser();
  console.log('\nALL VERIFICATION CHECKS PASSED!');
})();
