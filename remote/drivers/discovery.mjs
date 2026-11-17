// Multi-brand TV Brand Detection & LAN Discovery (Samsung Tizen, LG webOS, LG NetCast)
import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';

function tcpProbe(ip, port, timeoutMs = 450) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (e) {}
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
    sock.connect(port, ip);
  });
}

function probeSamsungRest(ip, port = 8001, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:${port}/api/v2/`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json && (json.device || /Samsung/i.test(json.type || ''))) {
            return resolve({
              brand: 'samsung',
              name: json.name || json.device?.name || 'Samsung TV',
              model: json.device?.modelName || json.device?.model || 'Tizen'
            });
          }
        } catch (e) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function probeLgNetcast(ip, port = 8080, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:${port}/roap/api/data?target=version_info`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        // LG NetCast returns 200/401/400 XML; Samsung port 8080 returns 403 XHTML "lighttpd/Forbidden"
        if (/ROAP|NetCast|<envelope>|<data>/i.test(body) || res.statusCode === 200 || res.statusCode === 401) {
          return resolve({
            brand: 'lg-netcast',
            name: 'LG NetCast TV',
            model: 'NetCast 2011-2013'
          });
        }
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

export async function detectTvBrand(ip, ports = {}) {
  const samsungRestPort = ports.samsungRest || 8001;
  const lgWssPort = ports.lgWss || 3001;
  const lgWsPort = ports.lgWs || 3000;
  const lgNetcastPort = ports.lgNetcast || 8080;

  const [samsungInfo, has3001, has3000, netcastInfo] = await Promise.all([
    probeSamsungRest(ip, samsungRestPort),
    tcpProbe(ip, lgWssPort, 900),
    tcpProbe(ip, lgWsPort, 900),
    probeLgNetcast(ip, lgNetcastPort)
  ]);

  if (samsungInfo) return samsungInfo;
  if (has3001 || has3000) {
    return { brand: 'lg-webos', name: 'LG webOS TV', model: has3001 ? 'webOS (WSS 3001)' : 'webOS (WS 3000)' };
  }
  if (netcastInfo) return netcastInfo;
  return { brand: null, name: ip, model: 'Offline or Unknown' };
}

function ssdpDiscover(timeoutMs = 1100) {
  return new Promise((resolve) => {
    const foundIps = new Set();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const done = () => {
      try { sock.close(); } catch (e) {}
      resolve(Array.from(foundIps));
    };

    const timer = setTimeout(done, timeoutMs);
    sock.on('error', () => { clearTimeout(timer); done(); });
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8');
      if (/webos|lge|samsung|udap|roap|mediarenderer/i.test(text) && rinfo?.address) {
        foundIps.add(rinfo.address);
      }
    });

    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch (e) {}
      const targets = [
        'urn:lge-com:service:webos-second-screen:1',
        'urn:samsung.com:device:RemoteControlReceiver:1',
        'ssdp:all'
      ];
      for (const st of targets) {
        const payload = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 1\r\n' +
          `ST: ${st}\r\n\r\n`,
          'ascii'
        );
        sock.send(payload, 1900, '239.255.255.250');
      }
    });
  });
}

export async function scanLanTvs(lanIp) {
  const candidateIps = new Set(await ssdpDiscover(1100));

  if (lanIp && /^\d+\.\d+\.\d+\.\d+$/.test(lanIp) && !lanIp.startsWith('127.')) {
    const prefix = lanIp.split('.').slice(0, 3).join('.');
    const allHosts = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${prefix}.${i}`;
      if (ip !== lanIp) allHosts.push(ip);
    }

    const batchSize = 48;
    for (let i = 0; i < allHosts.length; i += batchSize) {
      const batch = allHosts.slice(i, i + batchSize);
      await Promise.all(batch.map(async (ip) => {
        const [p8001, p3001, p3000] = await Promise.all([
          tcpProbe(ip, 8001, 260),
          tcpProbe(ip, 3001, 260),
          tcpProbe(ip, 3000, 260)
        ]);
        if (p8001 || p3001 || p3000) candidateIps.add(ip);
      }));
    }
  }

  const results = [];
  await Promise.all(Array.from(candidateIps).map(async (ip) => {
    const info = await detectTvBrand(ip);
    if (info.brand) {
      results.push({ ip, ...info });
    }
  }));

  results.sort((a, b) => a.ip.localeCompare(b.ip));
  return results;
}
