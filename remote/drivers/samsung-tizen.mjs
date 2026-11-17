// Samsung Tizen TV Driver (2016-2025+, wss://:8002 token auth + ws://:8001 legacy fallback + WoL)
import http from 'node:http';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { getTokenEntry, saveTokenEntry } from './storage.mjs';
import { sendWakeOnLan } from './wol.mjs';

export function createSamsungDriver({ ip, dataDir, cliPath, ports = {}, onStatusChange }) {
  const sslPort = ports.ssl || 8002;
  const wsPort = ports.ws || 8001;
  const restPort = ports.rest || 8001;

  let destroyed = false;
  let tvWs = null;
  let reconnectTimer = null;
  let pollTimer = null;
  let useUnencryptedFallback = !!ports.preferWs;

  const saved = getTokenEntry(dataDir, ip);
  let token = saved.samsungToken || '';
  let cachedMac = saved.mac || '';

  const status = {
    brand: 'samsung',
    brandLabel: 'Samsung Tizen',
    ip,
    state: 'connecting',
    device: null,
    token: !!token,
    requiresPin: false,
    isConnected: false
  };

  function emitStatus() {
    if (onStatusChange) onStatusChange(getStatus());
  }

  function getStatus() {
    return { ...status, device: status.device ? { ...status.device } : null };
  }

  function connectWebSocket() {
    if (destroyed) return;
    if (tvWs && (tvWs.readyState === WebSocket.OPEN || tvWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const appNameBase64 = Buffer.from('CleanRemote2026').toString('base64');
    const scheme = useUnencryptedFallback ? 'ws' : 'wss';
    const port = useUnencryptedFallback ? wsPort : sslPort;
    let url = `${scheme}://${ip}:${port}/api/v2/channels/samsung.remote.control?name=${appNameBase64}`;
    if (!useUnencryptedFallback && token) {
      url += `&token=${encodeURIComponent(token)}`;
    }

    let openedThisAttempt = false;
    try {
      tvWs = new WebSocket(url);

      tvWs.onopen = () => {
        if (destroyed) return;
        openedThisAttempt = true;
        status.isConnected = true;
        status.state = token ? 'authorized' : 'connected';
        emitStatus();
      };

      tvWs.onmessage = (event) => {
        if (destroyed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'ms.channel.connect') {
            status.isConnected = true;
            status.state = 'authorized';
            const recToken = msg.data?.token || msg.data?.clients?.[0]?.attributes?.token;
            if (recToken && recToken !== token) {
              token = String(recToken);
              status.token = true;
              saveTokenEntry(dataDir, ip, { samsungToken: token });
            } else {
              status.token = !!token || useUnencryptedFallback;
            }
            emitStatus();
          } else if (msg.event === 'ms.channel.unauthorized') {
            status.state = 'unauthorized';
            emitStatus();
          }
        } catch (e) {}
      };

      tvWs.onerror = () => {
        if (destroyed) return;
        status.isConnected = false;
        status.state = 'error';
        emitStatus();
      };

      tvWs.onclose = () => {
        if (destroyed) return;
        status.isConnected = false;
        status.state = 'disconnected';
        tvWs = null;
        if (!openedThisAttempt && !useUnencryptedFallback) {
          useUnencryptedFallback = true;
        } else {
          useUnencryptedFallback = false;
        }
        emitStatus();
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWebSocket, 4000);
      };
    } catch (e) {
      status.isConnected = false;
      status.state = 'error';
      emitStatus();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWebSocket, 4000);
    }
  }

  function pollRestInfo() {
    if (destroyed) return;
    const req = http.get(`http://${ip}:${restPort}/api/v2/`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (destroyed) return;
        try {
          const json = JSON.parse(data);
          const mac = json.device?.wifiMac || json.device?.mac;
          if (mac && mac !== cachedMac) {
            cachedMac = mac;
            saveTokenEntry(dataDir, ip, { mac: cachedMac });
          }
          if (json.device?.TokenAuthSupport === 'false') {
            useUnencryptedFallback = true;
          }
          status.device = {
            name: json.name || json.device?.name || 'Samsung TV',
            model: json.device?.modelName || json.device?.model || 'Smart TV',
            power: json.device?.PowerState || 'on',
            os: json.device?.OS || 'Tizen',
            version: json.device?.platform_version || '6.5'
          };
          emitStatus();
        } catch (e) {}
      });
    });
    req.on('error', () => {
      if (destroyed) return;
      status.device = null;
      emitStatus();
    });
    req.on('timeout', () => req.destroy());
  }

  connectWebSocket();
  pollRestInfo();
  pollTimer = setInterval(pollRestInfo, 15000);

  function dispatchPayload(payload) {
    tvWs.send(JSON.stringify(payload));
  }

  function ensureOpenThen(fn) {
    return new Promise((resolve, reject) => {
      if (tvWs && tvWs.readyState === WebSocket.OPEN) {
        return fn(resolve, reject);
      }
      connectWebSocket();
      setTimeout(() => {
        if (!tvWs || tvWs.readyState !== WebSocket.OPEN) {
          return reject(new Error('Samsung TV WebSocket is not connected yet'));
        }
        fn(resolve, reject);
      }, 650);
    });
  }

  async function sendKey(key) {
    if (key === 'KEY_POWER' && (!tvWs || tvWs.readyState !== WebSocket.OPEN) && cachedMac) {
      await sendWakeOnLan(cachedMac, ip);
      return { ok: true, key, wol: true };
    }
    return ensureOpenThen((resolve, reject) => {
      try {
        dispatchPayload({
          method: 'ms.remote.control',
          params: {
            Cmd: 'Click',
            DataOfCmd: key,
            Option: 'false',
            TypeOfRemote: 'SendRemoteKey'
          }
        });
        resolve({ ok: true, key });
      } catch (err) {
        reject(err);
      }
    });
  }

  function launchApp(appId) {
    return new Promise((resolve, reject) => {
      const canUseCli = cliPath && cliPath !== 'apps2samsung-cli' && fs.existsSync(cliPath) && sslPort === 8002;
      if (canUseCli) {
        execFile(cliPath, ['launch', appId, '--tv', ip, '--plain'], { timeout: 8000 }, (err, stdout, stderr) => {
          if (!err) {
            return resolve({ ok: true, appId, output: (stdout || '').trim() });
          }
          if (tvWs && tvWs.readyState === WebSocket.OPEN) {
            dispatchPayload({
              method: 'ms.channel.emit',
              params: {
                event: 'ed.apps.launch',
                to: 'host',
                data: { action_type: 'NATIVE_LAUNCH', appId, metaTag: '' }
              }
            });
            return resolve({ ok: true, appId, via: 'ws' });
          }
          reject(new Error(stderr || err.message));
        });
        return;
      }
      if (tvWs && tvWs.readyState === WebSocket.OPEN) {
        dispatchPayload({
          method: 'ms.channel.emit',
          params: {
            event: 'ed.apps.launch',
            to: 'host',
            data: { action_type: 'NATIVE_LAUNCH', appId, metaTag: '' }
          }
        });
        resolve({ ok: true, appId, via: 'ws' });
        return;
      }
      reject(new Error('apps2samsung-cli not found and Samsung TV WebSocket is not connected'));
    });
  }

  function openBrowserUrl(targetUrl) {
    return ensureOpenThen((resolve) => {
      dispatchPayload({
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
      });
      resolve({ ok: true, url: targetUrl });
    });
  }

  function destroy() {
    destroyed = true;
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    if (tvWs) {
      try { tvWs.close(); } catch (e) {}
      tvWs = null;
    }
  }

  return {
    getStatus,
    sendKey,
    launchApp,
    openBrowserUrl,
    submitPin: async () => ({ ok: false, error: 'PIN pairing not used for Samsung Tizen' }),
    destroy
  };
}
