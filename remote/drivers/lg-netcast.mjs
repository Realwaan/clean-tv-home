// Legacy LG NetCast TV Driver (2011-2013 Smart TVs via HTTP ROAP port 8080 XML API)
import http from 'node:http';
import { getTokenEntry, saveTokenEntry } from './storage.mjs';

const NETCAST_KEY_MAP = {
  KEY_POWER: 1,
  KEY_0: 2,
  KEY_1: 3,
  KEY_2: 4,
  KEY_3: 5,
  KEY_4: 6,
  KEY_5: 7,
  KEY_6: 8,
  KEY_7: 9,
  KEY_8: 10,
  KEY_9: 11,
  KEY_UP: 12,
  KEY_DOWN: 13,
  KEY_LEFT: 14,
  KEY_RIGHT: 15,
  KEY_ENTER: 20,
  KEY_HOME: 21,
  KEY_MENU: 22,
  KEY_RETURN: 23,
  KEY_VOLUP: 24,
  KEY_VOLDOWN: 25,
  KEY_MUTE: 26,
  KEY_CHUP: 27,
  KEY_CHDOWN: 28,
  KEY_PLAY: 33,
  KEY_PAUSE: 34,
  KEY_FF: 36,
  KEY_REWIND: 37,
  KEY_CH_LIST: 40,
  KEY_INFO: 45,
  KEY_PRECH: 403,
  KEY_GUIDE: 412
};

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, '');
}

export function createLgNetcastDriver({ ip, dataDir, port = 8080, onStatusChange }) {
  let destroyed = false;
  let sessionId = '';
  const saved = getTokenEntry(dataDir, ip);
  let savedPin = saved.netcastPin || '';

  const status = {
    brand: 'lg-netcast',
    brandLabel: 'LG NetCast',
    ip,
    state: 'connecting',
    device: { name: 'LG NetCast TV', model: 'NetCast 2011-2013', power: 'on', os: 'NetCast', version: 'ROAP' },
    token: !!savedPin,
    requiresPin: !savedPin,
    isConnected: false
  };

  function emitStatus() {
    if (onStatusChange) onStatusChange(getStatus());
  }

  function getStatus() {
    return { ...status, device: status.device ? { ...status.device } : null };
  }

  function roapPost(reqPath, xmlBody) {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(xmlBody, 'utf8');
      const req = http.request({
        hostname: ip,
        port,
        path: reqPath,
        method: 'POST',
        timeout: 4000,
        headers: {
          'Content-Type': 'application/atom+xml; charset=utf-8',
          'Content-Length': buf.length
        }
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('LG NetCast request timeout'));
      });
      req.write(buf);
      req.end();
    });
  }

  async function requestPin() {
    const res = await roapPost('/roap/api/auth', '<?xml version="1.0" encoding="utf-8"?><auth><type>AuthKeyReq</type></auth>');
    if (res.status >= 200 && res.status < 300) {
      status.isConnected = true;
      status.state = 'pin_required';
      status.requiresPin = true;
      emitStatus();
      return { ok: true, state: 'pin_required' };
    }
    throw new Error(`LG NetCast AuthKeyReq failed (HTTP ${res.status})`);
  }

  async function submitPin(pin) {
    if (!pin) {
      return requestPin();
    }
    const cleanPin = escapeXml(String(pin).trim());
    const xml = `<?xml version="1.0" encoding="utf-8"?><auth><type>AuthReq</type><value>${cleanPin}</value></auth>`;
    const res = await roapPost('/roap/api/auth', xml);
    const match = res.body.match(/<session>([^<]+)<\/session>/i);
    if (res.status === 200 && match && match[1]) {
      sessionId = match[1].trim();
      savedPin = cleanPin;
      saveTokenEntry(dataDir, ip, { netcastPin: savedPin });
      status.isConnected = true;
      status.token = true;
      status.requiresPin = false;
      status.state = 'authorized';
      emitStatus();
      return { ok: true, session: sessionId };
    }
    status.token = false;
    status.requiresPin = true;
    status.state = 'pin_required';
    emitStatus();
    throw new Error('Invalid or rejected LG NetCast pairing PIN');
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    if (savedPin) {
      const r = await submitPin(savedPin);
      return r.session;
    }
    await requestPin();
    throw new Error('Enter the 6-digit pairing PIN displayed on your LG TV');
  }

  async function sendKey(key) {
    const code = NETCAST_KEY_MAP[key];
    if (!code) throw new Error(`Unsupported key on LG NetCast: ${key}`);

    const sid = await ensureSession();
    const buildCmd = (s) =>
      `<?xml version="1.0" encoding="utf-8"?><command><session>${escapeXml(s)}</session><name>HandleKeyInput</name><type>HandleKeyInput</type><value>${code}</value></command>`;

    let res = await roapPost('/roap/api/command', buildCmd(sid));
    if (res.status === 401 && savedPin) {
      sessionId = '';
      const fresh = await submitPin(savedPin);
      res = await roapPost('/roap/api/command', buildCmd(fresh.session));
    }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, key, code };
    }
    throw new Error(`LG NetCast key failed (HTTP ${res.status})`);
  }

  // Initialize connection or show PIN prompt automatically
  (async () => {
    if (destroyed) return;
    try {
      if (savedPin) {
        await submitPin(savedPin);
      } else {
        await requestPin();
      }
    } catch (e) {
      if (destroyed) return;
      status.isConnected = false;
      status.state = 'disconnected';
      emitStatus();
    }
  })();

  return {
    getStatus,
    sendKey,
    submitPin,
    launchApp: async (appId) => {
      if (appId === 'com.samsung.tv.csfs' || appId === 'TvHome0001.Home') {
        return sendKey('KEY_HOME');
      }
      throw new Error('App deep-linking requires LG webOS (NetCast TVs support remote keys & Home)');
    },
    openBrowserUrl: async () => {
      throw new Error('Auto-opening URLs over network requires LG webOS or Samsung Tizen');
    },
    destroy: () => { destroyed = true; }
  };
}
