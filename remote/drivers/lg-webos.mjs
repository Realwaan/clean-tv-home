// LG webOS TV Driver (2014-2025+, webOS 1.0-25 via SSAP wss://:3001 & ws://:3000)
import { getTokenEntry, saveTokenEntry } from './storage.mjs';
import { sendWakeOnLan } from './wol.mjs';

const LG_PERMISSIONS = [
  'LAUNCH',
  'LAUNCH_WEBAPP',
  'APP_TO_APP',
  'CLOSE',
  'TEST_OPEN',
  'TEST_PROTECTED',
  'CONTROL_AUDIO',
  'CONTROL_DISPLAY',
  'CONTROL_INPUT_JOYSTICK',
  'CONTROL_INPUT_MEDIA_RECORDING',
  'CONTROL_INPUT_MEDIA_PLAYBACK',
  'CONTROL_INPUT_TV',
  'CONTROL_POWER',
  'READ_APP_STATUS',
  'READ_CURRENT_CHANNEL',
  'READ_INPUT_DEVICE_LIST',
  'READ_NETWORK_STATE',
  'READ_RUNNING_APPS',
  'READ_TV_CHANNEL_LIST',
  'WRITE_NOTIFICATION_TOAST',
  'READ_POWER_STATE',
  'READ_COUNTRY_INFO',
  'CONTROL_MOUSE_AND_KEYBOARD',
  'READ_INSTALLED_APPS'
];

const LG_KEY_MAP = {
  KEY_UP: 'UP',
  KEY_DOWN: 'DOWN',
  KEY_LEFT: 'LEFT',
  KEY_RIGHT: 'RIGHT',
  KEY_ENTER: 'ENTER',
  KEY_RETURN: 'BACK',
  KEY_HOME: 'HOME',
  KEY_MENU: 'MENU',
  KEY_INFO: 'INFO',
  KEY_GUIDE: 'GUIDE',
  KEY_CH_LIST: 'LIST',
  KEY_PRECH: 'BACK',
  KEY_VOLUP: 'VOLUMEUP',
  KEY_VOLDOWN: 'VOLUMEDOWN',
  KEY_MUTE: 'MUTE',
  KEY_CHUP: 'CHANNELUP',
  KEY_CHDOWN: 'CHANNELDOWN',
  KEY_PLAY: 'PLAY',
  KEY_PAUSE: 'PAUSE',
  KEY_REWIND: 'REWIND',
  KEY_FF: 'FASTFORWARD',
  KEY_0: '0',
  KEY_1: '1',
  KEY_2: '2',
  KEY_3: '3',
  KEY_4: '4',
  KEY_5: '5',
  KEY_6: '6',
  KEY_7: '7',
  KEY_8: '8',
  KEY_9: '9'
};

const APP_ID_TRANSLATION = {
  'TvHome0001.Home': 'org.cleantv.home',
  'tUb3Xq7Lm9.Tube': 'youtube.leanback.v4',
  'rJeHak5zRg.Spotify': 'spotify-beehive',
  'org.tizen.channel-list': 'com.webos.app.livetv',
  'org.tizen.netflix-app': 'netflix',
  'org.tizen.SMSourceAPP': 'com.webos.app.inputpicker',
  'com.samsung.tv.coba.setting': 'com.palm.app.settings'
};

export function createLgWebosDriver({ ip, dataDir, ports = {}, onStatusChange }) {
  const wssPort = ports.wss || 3001;
  const wsPort = ports.ws || 3000;

  let destroyed = false;
  let ssapWs = null;
  let pointerWs = null;
  let useInsecurePort = ports.preferWs ? true : false;
  let reqSeq = 1;
  let reconnectTimer = null;
  let connectTimeoutTimer = null;
  let lastMute = false;
  const pending = new Map();

  const saved = getTokenEntry(dataDir, ip);
  let clientKey = saved.lgClientKey || '';
  let cachedMac = saved.mac || '';

  const status = {
    brand: 'lg-webos',
    brandLabel: 'LG webOS',
    ip,
    state: 'connecting',
    device: { name: 'LG webOS TV', model: 'webOS Smart TV', power: 'on', os: 'webOS', version: '' },
    token: !!clientKey,
    requiresPin: false,
    isConnected: false
  };

  function emitStatus() {
    if (onStatusChange) onStatusChange(getStatus());
  }

  function getStatus() {
    return { ...status, device: status.device ? { ...status.device } : null };
  }

  function sendRequest(uri, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!ssapWs || ssapWs.readyState !== WebSocket.OPEN) {
        return reject(new Error('LG webOS TV is not connected'));
      }
      const id = `req_${reqSeq++}`;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`SSAP timeout for ${uri}`));
        }
      }, 6000);
      pending.set(id, { resolve, reject, timer });
      try {
        ssapWs.send(JSON.stringify({ id, type: 'request', uri, payload }));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  }

  function openPointerSocket(socketPath) {
    if (destroyed || !socketPath) return;
    if (pointerWs) {
      try { pointerWs.close(); } catch (e) {}
      pointerWs = null;
    }
    try {
      const pws = new WebSocket(socketPath);
      pws.onopen = () => {
        if (destroyed) {
          try { pws.close(); } catch (e) {}
          return;
        }
        pointerWs = pws;
      };
      pws.onclose = () => {
        if (pointerWs === pws) pointerWs = null;
      };
      pws.onerror = () => {
        if (pointerWs === pws) pointerWs = null;
      };
    } catch (e) {}
  }

  async function onRegistered() {
    try {
      const sys = await sendRequest('ssap://system/getSystemInfo');
      if (sys) {
        status.device = {
          ...(status.device || {}),
          name: sys.modelName ? `LG ${sys.modelName}` : (status.device?.name || 'LG webOS TV'),
          model: sys.modelName || 'webOS Smart TV',
          os: 'webOS',
          power: 'on'
        };
      }
    } catch (e) {}

    try {
      const sw = await sendRequest('ssap://com.webos.service.update/getCurrentSWInformation');
      if (sw) {
        const ver = sw.product_name || (sw.major_ver ? `webOS ${sw.major_ver}` : '');
        if (status.device && ver) status.device.version = ver;
      }
    } catch (e) {}

    emitStatus();

    try {
      const ptr = await sendRequest('ssap://com.webos.service.networkinput/getPointerInputSocket');
      if (ptr?.socketPath) {
        openPointerSocket(ptr.socketPath);
      }
    } catch (e) {}
  }

  function sendRegister() {
    if (!ssapWs || ssapWs.readyState !== WebSocket.OPEN) return;
    const payload = {
      forcePairing: false,
      pairingType: 'PROMPT',
      manifest: {
        manifestVersion: 1,
        appVersion: '1.1',
        permissions: LG_PERMISSIONS
      }
    };
    if (clientKey) payload['client-key'] = clientKey;

    ssapWs.send(JSON.stringify({
      id: 'register_0',
      type: 'register',
      payload
    }));
  }

  function failAllPending(reason) {
    for (const [id, item] of pending.entries()) {
      clearTimeout(item.timer);
      item.reject(new Error(reason));
      pending.delete(id);
    }
  }

  function connect() {
    if (destroyed) return;
    if (ssapWs && (ssapWs.readyState === WebSocket.OPEN || ssapWs.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const url = useInsecurePort ? `ws://${ip}:${wsPort}` : `wss://${ip}:${wssPort}`;
    let opened = false;
    clearTimeout(connectTimeoutTimer);

    try {
      const ws = new WebSocket(url);
      ssapWs = ws;

      connectTimeoutTimer = setTimeout(() => {
        if (!opened && ssapWs === ws) {
          try { ws.close(); } catch (e) {}
        }
      }, 2500);

      ws.onopen = () => {
        if (destroyed || ssapWs !== ws) return;
        opened = true;
        clearTimeout(connectTimeoutTimer);
        status.isConnected = true;
        status.state = 'connected';
        emitStatus();
        sendRegister();
      };

      ws.onmessage = (event) => {
        if (destroyed || ssapWs !== ws) return;
        let msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }

        if (msg.id === 'register_0') {
          if (msg.type === 'registered' && msg.payload?.['client-key']) {
            const newKey = String(msg.payload['client-key']);
            if (newKey !== clientKey) {
              clientKey = newKey;
              saveTokenEntry(dataDir, ip, { lgClientKey: clientKey });
            }
            status.token = true;
            status.state = 'authorized';
            status.isConnected = true;
            emitStatus();
            onRegistered();
            return;
          }
          if (msg.type === 'response' && msg.payload?.pairingType === 'PROMPT') {
            status.state = 'pairing_prompt';
            emitStatus();
            return;
          }
          if (msg.type === 'error') {
            status.state = 'unauthorized';
            emitStatus();
            return;
          }
        }

        if (msg.type === 'prompt') {
          status.state = 'pairing_prompt';
          emitStatus();
          return;
        }

        if (msg.id && pending.has(msg.id)) {
          const item = pending.get(msg.id);
          clearTimeout(item.timer);
          pending.delete(msg.id);
          if (msg.type === 'error') {
            item.reject(new Error(msg.error || 'LG SSAP error'));
          } else {
            item.resolve(msg.payload || {});
          }
        }
      };

      ws.onerror = () => {
        if (destroyed || ssapWs !== ws) return;
        clearTimeout(connectTimeoutTimer);
      };

      ws.onclose = () => {
        if (destroyed || ssapWs !== ws) return;
        clearTimeout(connectTimeoutTimer);
        ssapWs = null;
        if (pointerWs) {
          try { pointerWs.close(); } catch (e) {}
          pointerWs = null;
        }
        status.isConnected = false;
        status.state = 'disconnected';
        failAllPending('LG webOS connection closed');

        if (!opened) {
          useInsecurePort = !useInsecurePort;
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 250);
          return;
        }
        emitStatus();
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 4000);
      };
    } catch (e) {
      clearTimeout(connectTimeoutTimer);
      useInsecurePort = !useInsecurePort;
      status.isConnected = false;
      status.state = 'error';
      emitStatus();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 4000);
    }
  }

  connect();

  async function ensurePointerSocket() {
    if (pointerWs && pointerWs.readyState === WebSocket.OPEN) return pointerWs;
    if (!ssapWs || ssapWs.readyState !== WebSocket.OPEN) return null;
    try {
      const ptr = await sendRequest('ssap://com.webos.service.networkinput/getPointerInputSocket');
      if (!ptr?.socketPath) return null;
      await new Promise((resolve) => {
        const pws = new WebSocket(ptr.socketPath);
        const timer = setTimeout(() => resolve(null), 900);
        pws.onopen = () => {
          clearTimeout(timer);
          pointerWs = pws;
          resolve(pws);
        };
        pws.onerror = () => { clearTimeout(timer); resolve(null); };
        pws.onclose = () => { if (pointerWs === pws) pointerWs = null; };
      });
    } catch (e) {}
    return pointerWs && pointerWs.readyState === WebSocket.OPEN ? pointerWs : null;
  }

  async function sendKey(key) {
    if (key === 'KEY_POWER') {
      if (!ssapWs || ssapWs.readyState !== WebSocket.OPEN) {
        if (cachedMac) {
          await sendWakeOnLan(cachedMac, ip);
          return { ok: true, key, wol: true };
        }
        throw new Error('LG TV is offline (enable Mobile TV On + supply MAC for Wake-on-LAN)');
      }
      await sendRequest('ssap://system/turnOff', {});
      return { ok: true, key };
    }

    const lgBtn = LG_KEY_MAP[key];
    if (!lgBtn) throw new Error(`Unsupported key on LG webOS: ${key}`);

    const sock = await ensurePointerSocket();
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(`type:button\nname:${lgBtn}\n\n`);
      return { ok: true, key, button: lgBtn };
    }

    // Fallback direct SSAP service endpoints when pointer socket is unavailable
    if (key === 'KEY_VOLUP') { await sendRequest('ssap://audio/volumeUp', {}); return { ok: true, key }; }
    if (key === 'KEY_VOLDOWN') { await sendRequest('ssap://audio/volumeDown', {}); return { ok: true, key }; }
    if (key === 'KEY_MUTE') {
      lastMute = !lastMute;
      await sendRequest('ssap://audio/setMute', { mute: lastMute });
      return { ok: true, key };
    }
    if (key === 'KEY_CHUP') { await sendRequest('ssap://tv/channelUp', {}); return { ok: true, key }; }
    if (key === 'KEY_CHDOWN') { await sendRequest('ssap://tv/channelDown', {}); return { ok: true, key }; }
    if (key === 'KEY_PLAY') { await sendRequest('ssap://media.controls/play', {}); return { ok: true, key }; }
    if (key === 'KEY_PAUSE') { await sendRequest('ssap://media.controls/pause', {}); return { ok: true, key }; }
    if (key === 'KEY_REWIND') { await sendRequest('ssap://media.controls/rewind', {}); return { ok: true, key }; }
    if (key === 'KEY_FF') { await sendRequest('ssap://media.controls/fastForward', {}); return { ok: true, key }; }

    throw new Error('LG pointer input socket not ready yet');
  }

  async function openBrowserUrl(targetUrl) {
    try {
      await sendRequest('ssap://system.launcher/open', { target: targetUrl });
      return { ok: true, url: targetUrl };
    } catch (err) {
      await sendRequest('ssap://system.launcher/launch', {
        id: 'com.webos.app.browser',
        params: { target: targetUrl }
      });
      return { ok: true, url: targetUrl, fallback: true };
    }
  }

  async function launchApp(appId) {
    if (appId === 'org.tizen.browser') {
      return openBrowserUrl('https://www.movy.sx/');
    }
    if (appId === 'com.samsung.tv.csfs') {
      try {
        return await sendKey('KEY_HOME');
      } catch (e) {
        await sendRequest('ssap://system.launcher/launch', { id: 'com.webos.app.home' });
        return { ok: true, appId: 'com.webos.app.home' };
      }
    }
    const mappedId = APP_ID_TRANSLATION[appId] || appId;
    try {
      await sendRequest('ssap://system.launcher/launch', { id: mappedId });
      return { ok: true, appId: mappedId };
    } catch (err) {
      if (mappedId === 'com.webos.app.inputpicker') {
        await sendRequest('ssap://system.launcher/launch', { id: 'com.webos.app.hdmi1' });
        return { ok: true, appId: 'com.webos.app.hdmi1' };
      }
      throw err;
    }
  }

  function destroy() {
    destroyed = true;
    clearTimeout(reconnectTimer);
    clearTimeout(connectTimeoutTimer);
    failAllPending('Driver destroyed');
    if (pointerWs) {
      try { pointerWs.close(); } catch (e) {}
      pointerWs = null;
    }
    if (ssapWs) {
      try { ssapWs.close(); } catch (e) {}
      ssapWs = null;
    }
  }

  return {
    getStatus,
    sendKey,
    launchApp,
    openBrowserUrl,
    submitPin: async () => ({ ok: false, error: 'Use on-screen Allow prompt for LG webOS' }),
    destroy
  };
}
