// Shared persistence helpers for tv_tokens.json, legacy tv_token.txt, and tv_config.json.
import fs from 'node:fs';
import path from 'node:path';

export function loadTokens(dataDir) {
  const tokensPath = path.join(dataDir, 'tv_tokens.json');
  let map = {};
  if (fs.existsSync(tokensPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
      if (raw && typeof raw === 'object') map = raw;
    } catch (e) {}
  }
  return map;
}

export function getTokenEntry(dataDir, ip) {
  const map = loadTokens(dataDir);
  const entry = { ...(map[ip] || {}) };
  // Preserve backward compatibility with single-file tv_token.txt for Samsung TVs
  if (!entry.samsungToken) {
    const legacyPath = path.join(dataDir, 'tv_token.txt');
    if (fs.existsSync(legacyPath)) {
      try {
        const legacy = fs.readFileSync(legacyPath, 'utf8').trim();
        if (legacy) entry.samsungToken = legacy;
      } catch (e) {}
    }
  }
  return entry;
}

export function saveTokenEntry(dataDir, ip, patch) {
  const tokensPath = path.join(dataDir, 'tv_tokens.json');
  const map = loadTokens(dataDir);
  map[ip] = { ...(map[ip] || {}), ...patch };
  try {
    fs.writeFileSync(tokensPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
  } catch (e) {}
  if (patch.samsungToken) {
    const legacyPath = path.join(dataDir, 'tv_token.txt');
    try {
      if (!fs.existsSync(legacyPath)) {
        fs.writeFileSync(legacyPath, String(patch.samsungToken), 'utf8');
      }
    } catch (e) {}
  }
}

export function loadTvConfig(dataDir, defaults = { ip: '192.168.254.113', brand: 'auto' }) {
  const cfgPath = path.join(dataDir, 'tv_config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return { ...defaults, ...parsed };
      }
    } catch (e) {}
  }
  return { ...defaults };
}

export function saveTvConfig(dataDir, cfg) {
  const cfgPath = path.join(dataDir, 'tv_config.json');
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch (e) {}
}
