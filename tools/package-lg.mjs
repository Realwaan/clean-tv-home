#!/usr/bin/env node
// Pure Node.js LG webOS (.ipk) Packager for Clean TV Home (zero external npm packages).
// Uses `ares-package` automatically if installed on PATH, otherwise constructs a valid
// OpenEmbedded / Debian ar + POSIX ustar tar.gz `.ipk` (webOS Package Format v2).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const DIST_DIR = path.join(ROOT, 'dist');
const STAGE_DIR = path.join(DIST_DIR, 'lg-app');

const IGNORED_NAMES = new Set(['config.xml', 'service', '.DS_Store', 'Thumbs.db']);

function copyFilteredDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyFilteredDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) {
    throw new Error(`Invalid PNG file: ${filePath}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function splitTarPath(posixPath) {
  if (Buffer.byteLength(posixPath, 'utf8') <= 100) {
    return { name: posixPath, prefix: '' };
  }
  const idx = posixPath.lastIndexOf('/');
  if (idx > 0) {
    const prefix = posixPath.slice(0, idx);
    const name = posixPath.slice(idx + 1);
    if (Buffer.byteLength(name, 'utf8') <= 100 && Buffer.byteLength(prefix, 'utf8') <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`Path too long for ustar header: ${posixPath}`);
}

function buildTarHeader({ name, isDir, size, mtime }) {
  const hdr = Buffer.alloc(512, 0);
  const split = splitTarPath(name);
  hdr.write(split.name, 0, 100, 'utf8');
  hdr.write((isDir ? '0000755' : '0000644') + '\0', 100, 8, 'ascii');
  hdr.write('0000000\0', 108, 8, 'ascii');
  hdr.write('0000000\0', 116, 8, 'ascii');
  hdr.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  hdr.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
  hdr.fill(0x20, 148, 156); // checksum placeholder
  hdr.write(isDir ? '5' : '0', 156, 1, 'ascii');
  hdr.write('ustar\0', 257, 6, 'ascii');
  hdr.write('00', 263, 2, 'ascii');
  hdr.write('root', 265, 32, 'ascii');
  hdr.write('root', 297, 32, 'ascii');
  if (split.prefix) {
    hdr.write(split.prefix, 345, 155, 'utf8');
  }
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += hdr[i];
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return hdr;
}

export function buildTarGz(entries, mtime = Math.floor(Date.now() / 1000)) {
  const blocks = [];
  for (const entry of entries) {
    const data = entry.isDir ? Buffer.alloc(0) : entry.data;
    blocks.push(buildTarHeader({ name: entry.name, isDir: !!entry.isDir, size: data.length, mtime }));
    if (data.length > 0) {
      blocks.push(data);
      const rem = data.length % 512;
      if (rem !== 0) blocks.push(Buffer.alloc(512 - rem, 0));
    }
  }
  blocks.push(Buffer.alloc(1024, 0)); // two EOF zero blocks
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}

export function buildArArchive(members, mtime = Math.floor(Date.now() / 1000)) {
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  const ts = String(mtime).padEnd(12, ' ').slice(0, 12);
  for (const m of members) {
    const hdr = Buffer.alloc(60, 0x20);
    hdr.write(m.name.slice(0, 16), 0, 16, 'ascii');
    hdr.write(ts, 16, 12, 'ascii');
    hdr.write('0     ', 28, 6, 'ascii');
    hdr.write('0     ', 34, 6, 'ascii');
    hdr.write('100644  ', 40, 8, 'ascii');
    hdr.write(String(m.data.length).padEnd(10, ' ').slice(0, 10), 48, 10, 'ascii');
    hdr.write('`\n', 58, 2, 'ascii');
    parts.push(hdr);
    parts.push(m.data);
    if (m.data.length % 2 === 1) {
      parts.push(Buffer.from('\n', 'ascii')); // GNU ar even-byte boundary padding
    }
  }
  return Buffer.concat(parts);
}

function collectFilesAndDirs(baseDir, tarPrefix) {
  const entries = [];
  const prefixParts = tarPrefix.split('/').filter(Boolean);
  let acc = '';
  for (const part of prefixParts) {
    acc += part + '/';
    entries.push({ name: acc, isDir: true });
  }

  function walk(dir, rel) {
    const items = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of items) {
      const full = path.join(dir, item.name);
      const itemRel = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push({ name: `${tarPrefix}/${itemRel}/`, isDir: true });
        walk(full, itemRel);
      } else if (item.isFile()) {
        entries.push({ name: `${tarPrefix}/${itemRel}`, isDir: false, data: fs.readFileSync(full) });
      }
    }
  }
  walk(baseDir, '');
  return entries;
}

export function packageLgIpk() {
  if (fs.existsSync(STAGE_DIR)) fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  copyFilteredDir(APP_DIR, STAGE_DIR);

  const tmdbKeyPath = path.join(os.homedir(), '.config', 'tv-home', 'tmdb.key');
  if (fs.existsSync(tmdbKeyPath)) {
    const tmdbKey = fs.readFileSync(tmdbKeyPath, 'utf8').trim();
    if (tmdbKey) {
      fs.writeFileSync(path.join(STAGE_DIR, 'js', 'key.js'), `window.TVHOME_TMDB_KEY = "${tmdbKey}";\n`, 'utf8');
    }
  }

  const appinfo = JSON.parse(fs.readFileSync(path.join(STAGE_DIR, 'appinfo.json'), 'utf8'));
  const icon80 = readPngDimensions(path.join(STAGE_DIR, appinfo.icon || 'icon80.png'));
  const icon130 = readPngDimensions(path.join(STAGE_DIR, appinfo.largeIcon || 'icon130.png'));
  if (icon80.width !== 80 || icon80.height !== 80) {
    throw new Error(`Expected icon80.png to be 80x80, got ${icon80.width}x${icon80.height}`);
  }
  if (icon130.width !== 130 || icon130.height !== 130) {
    throw new Error(`Expected icon130.png to be 130x130, got ${icon130.width}x${icon130.height}`);
  }

  const outName = `${appinfo.id}_${appinfo.version}_all.ipk`;
  const outPath = path.join(DIST_DIR, outName);

  // Prefer official webOS CLI packager if present
  try {
    const aresCmd = process.platform === 'win32' ? 'ares-package.cmd' : 'ares-package';
    execFileSync(aresCmd, [STAGE_DIR, '-o', DIST_DIR, '--no-minify'], { stdio: 'pipe', timeout: 15000 });
    if (fs.existsSync(outPath)) {
      const stat = fs.statSync(outPath);
      console.log(`Built ${outPath} (${stat.size} bytes) via ares-package`);
      return outPath;
    }
  } catch (e) {
    // Fallback to pure Node.js OpenEmbedded .ipk packager below
  }

  const packageInfo = {
    id: appinfo.id,
    version: appinfo.version,
    app: appinfo.id,
    loc_name: appinfo.title || 'Clean TV Home',
    vendor: appinfo.vendor || 'Clean TV Home',
    package_format_version: 2
  };
  const packageInfoBuf = Buffer.from(JSON.stringify(packageInfo, null, 2) + '\n', 'utf8');

  const appEntries = collectFilesAndDirs(STAGE_DIR, `usr/palm/applications/${appinfo.id}`);
  const dataEntries = [
    { name: 'usr/', isDir: true },
    { name: 'usr/palm/', isDir: true },
    { name: 'usr/palm/packages/', isDir: true },
    { name: `usr/palm/packages/${appinfo.id}/`, isDir: true },
    { name: `usr/palm/packages/${appinfo.id}/packageinfo.json`, isDir: false, data: packageInfoBuf },
    ...appEntries.filter((e) => !['usr/', 'usr/palm/'].includes(e.name))
  ];

  let installedSize = 0;
  for (const e of dataEntries) {
    if (!e.isDir && e.data) installedSize += e.data.length;
  }

  const controlText = [
    `Package: ${appinfo.id}`,
    `Version: ${appinfo.version}`,
    `Section: misc`,
    `Priority: optional`,
    `Architecture: all`,
    `Installed-Size: ${installedSize}`,
    `Maintainer: ${appinfo.vendor || 'Clean TV Home'} <nobody@example.com>`,
    `Description: Clean TV Home for LG webOS and Samsung Tizen`,
    `webOS-Package-Format-Version: 2`,
    `webOS-Packager-Version: 1.12.0`,
    ''
  ].join('\n');

  const mtime = Math.floor(Date.now() / 1000);
  const controlTgz = buildTarGz([
    { name: './', isDir: true },
    { name: './control', isDir: false, data: Buffer.from(controlText, 'utf8') }
  ], mtime);
  const dataTgz = buildTarGz(dataEntries, mtime);
  const ipkBuf = buildArArchive([
    { name: 'debian-binary', data: Buffer.from('2.0\n', 'ascii') },
    { name: 'control.tar.gz', data: controlTgz },
    { name: 'data.tar.gz', data: dataTgz }
  ], mtime);

  fs.writeFileSync(outPath, ipkBuf);
  console.log(`Built ${outPath} (${ipkBuf.length} bytes)`);
  return outPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  packageLgIpk();
}
