const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.resolve('dist/index.html');
const swPath = path.resolve('dist/sw.js');

if (!fs.existsSync(htmlPath) || !fs.existsSync(swPath)) {
  throw new Error('Khong tim thay dist/index.html hoac dist/sw.js. Hay build Vite truoc.');
}

const html = fs.readFileSync(htmlPath, 'utf8');
const pattern = /(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g;
const assets = [...html.matchAll(pattern)].map(match => new URL(match[1], 'http://localhost').pathname);
const uniqueAssets = [...new Set(assets)];

if (uniqueAssets.length === 0) {
  throw new Error('Khong tim thay tai nguyen /assets/ trong dist/index.html.');
}

const sw = fs.readFileSync(swPath, 'utf8');
const shellPattern = /const APP_SHELL = \[[^\]]*\];/;

if (!shellPattern.test(sw)) {
  throw new Error('Khong tim thay khai bao APP_SHELL trong dist/sw.js.');
}

const replacement = 'const APP_SHELL = ' +
  JSON.stringify(['/', '/index.html', '/manifest.webmanifest', ...uniqueAssets]) + ';';

fs.writeFileSync(swPath, sw.replace(shellPattern, replacement), 'utf8');

console.log('Danh sach precache da tao:');
for (const asset of uniqueAssets) console.log('  ' + asset);