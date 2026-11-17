// Turn off Samsung Tizen, LG webOS, or LG NetCast Smart TV from CLI
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTvConfig } from './drivers/storage.mjs';
import { detectTvBrand } from './drivers/discovery.mjs';
import { createSamsungDriver } from './drivers/samsung-tizen.mjs';
import { createLgWebosDriver } from './drivers/lg-webos.mjs';
import { createLgNetcastDriver } from './drivers/lg-netcast.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : '';
}

const cfg = loadTvConfig(__dirname, { ip: '192.168.254.113', brand: 'auto' });
const positionalIp = process.argv.slice(2).find((a) => !a.startsWith('-') && /^\d+\.\d+\.\d+\.\d+$/.test(a));
const ip = getArg('--tv') || positionalIp || cfg.ip || '192.168.254.113';
let brand = getArg('--brand') || cfg.brand || 'auto';

async function main() {
  if (brand === 'auto') {
    console.log(`Detecting TV at ${ip}...`);
    const info = await detectTvBrand(ip);
    brand = info.brand || 'samsung';
  }

  console.log(`Connecting to ${brand} TV at ${ip}...`);
  let driver;
  if (brand === 'lg-webos') driver = createLgWebosDriver({ ip, dataDir: __dirname });
  else if (brand === 'lg-netcast') driver = createLgNetcastDriver({ ip, dataDir: __dirname });
  else driver = createSamsungDriver({ ip, dataDir: __dirname });

  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    const st = driver.getStatus();
    if (st.state === 'authorized' || (brand === 'samsung' && st.isConnected && st.token)) {
      await driver.sendKey('KEY_POWER');
      console.log('Power-off command sent.');
      setTimeout(() => {
        driver.destroy();
        process.exit(0);
      }, 450);
      return;
    }
    if (st.state === 'pin_required') {
      console.error('LG NetCast TV requires PIN pairing first. Pair via http://localhost:5050');
      driver.destroy();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.error('Timed out waiting for TV connection/authorization. Ensure TV is on and Allow prompt was accepted.');
  driver.destroy();
  process.exit(1);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
