// Wake-on-LAN (WoL) UDP magic packet sender (zero dependencies).
import dgram from 'node:dgram';

export function parseMac(macStr) {
  const hex = String(macStr || '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) return null;
  const bytes = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function buildMagicPacket(macStr) {
  const mac = parseMac(macStr);
  if (!mac) throw new Error(`Invalid MAC address: ${macStr}`);
  const packet = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) {
    mac.copy(packet, 6 + i * 6);
  }
  return packet;
}

export function sendWakeOnLan(macStr, targetIp) {
  return new Promise((resolve, reject) => {
    let packet;
    try {
      packet = buildMagicPacket(macStr);
    } catch (e) {
      return reject(e);
    }

    const targets = new Set(['255.255.255.255']);
    if (targetIp && /^\d+\.\d+\.\d+\.\d+$/.test(targetIp)) {
      const parts = targetIp.split('.');
      targets.add(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
    }

    const sock = dgram.createSocket('udp4');
    sock.on('error', (err) => {
      try { sock.close(); } catch (e) {}
      reject(err);
    });

    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch (e) {}
      let pending = 0;
      const done = () => {
        if (--pending <= 0) {
          try { sock.close(); } catch (e) {}
          resolve({ ok: true, mac: macStr });
        }
      };
      for (const addr of targets) {
        for (const port of [9, 7]) {
          pending++;
          sock.send(packet, port, addr, done);
        }
      }
      if (pending === 0) done();
    });
  });
}
