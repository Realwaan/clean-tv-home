// Turn off Samsung Smart TV over WebSocket
import fs from 'node:fs';
import path from 'node:path';

const TV_IP = process.argv[2] || '192.168.254.113';
const TOKEN_FILE = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'tv_token.txt');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let token = '';
if (fs.existsSync(TOKEN_FILE)) {
  try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (e) {}
}

const appNameBase64 = Buffer.from('CleanRemote2026').toString('base64');
let url = `wss://${TV_IP}:8002/api/v2/channels/samsung.remote.control?name=${appNameBase64}`;
if (token) {
  url += `&token=${token}`;
}

console.log(`Connecting to Samsung TV at ${TV_IP}...`);
const ws = new WebSocket(url);

const timer = setTimeout(() => {
  console.log('Timeout waiting for TV response. If the TV displayed an "Allow" prompt, please press Allow on your TV remote.');
  ws.close();
  process.exit(1);
}, 8000);

ws.onopen = () => {
  console.log('Connected.');
};

ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);
    if (msg.event === 'ms.channel.connect') {
      clearTimeout(timer);
      if (msg.data && msg.data.token) {
        fs.writeFileSync(TOKEN_FILE, msg.data.token);
        console.log('Authorization token saved.');
      }
      console.log('Sending KEY_POWER command...');
      const powerCmd = {
        method: 'ms.remote.control',
        params: {
          Cmd: 'Click',
          DataOfCmd: 'KEY_POWER',
          Option: 'false',
          TypeOfRemote: 'SendRemoteKey'
        }
      };
      ws.send(JSON.stringify(powerCmd));
      setTimeout(() => {
        console.log('Power command sent. TV turning off.');
        ws.close();
        process.exit(0);
      }, 500);
    }
  } catch (e) {
    console.error('Error handling message:', e);
  }
};

ws.onerror = (err) => {
  console.error('WebSocket connection error:', err.message || err);
};
