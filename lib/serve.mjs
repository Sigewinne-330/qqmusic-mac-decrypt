// 本地静态服务器：只监听 127.0.0.1，给「网页版」目录提供服务（单页应用，未知路径回退到 index.html）。
// 用法：node serve.mjs <网页目录> <端口>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const [root, port = '8686'] = process.argv.slice(2);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function resolveFile(urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (rel.split(sep).includes('..')) return null;
  // 网页用相对路径引用资源，在 /settings/qmc 这类子路径刷新时会请求 /settings/assets/…，
  // 所以依次去掉前面的路径段再找（/settings/assets/x.js → /assets/x.js）。
  const parts = rel.split(sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const file = join(root, ...parts.slice(i));
    if (await isFile(file)) return file;
  }
  return extname(rel) ? null : join(root, 'index.html');
}

createServer(async (req, res) => {
  const file = await resolveFile(new URL(req.url, 'http://localhost').pathname);
  if (!file) {
    res.writeHead(404).end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(Number(port), '127.0.0.1', () => console.log(`网页版已启动：http://localhost:${port}/`));
