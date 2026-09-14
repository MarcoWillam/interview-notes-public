import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { MAX_API_BODY_BYTES, queueApi, type QueueConfig } from './api.ts';
import { QueueStore } from './store.ts';
export function queueHttp(
  store: QueueStore,
  config: QueueConfig,
  directory: string,
) {
  const api = queueApi(store, config),
    root = resolve(directory);
  return createServer(
    { requestTimeout: 30000, headersTimeout: 10000 },
    (req, res) => {
      void (async () => {
        const send = (value: unknown, status: number) => {
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify(value));
        };
        const origin = new URL(config.origin);
        if (req.headers.host !== origin.host) {
          send({ error: '请求地址不受支持。' }, 403);
          return;
        }
        const url = new URL(req.url || '/', config.origin);
        if (url.origin !== origin.origin) {
          send({ error: '请求地址不受支持。' }, 403);
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          const bodyLimit = url.pathname.startsWith('/api/interviews/')
            ? MAX_API_BODY_BYTES
            : 550000;
          if (Number(req.headers['content-length']) > bodyLimit) {
            req.resume();
            send({ error: '资料超过大小限制。' }, 413);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          await new Promise<void>((resolve, reject) => {
            req.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size <= bodyLimit) chunks.push(chunk);
            });
            req.on('end', resolve);
            req.on('error', reject);
          });
          if (size > bodyLimit) {
            send({ error: '资料超过大小限制。' }, 413);
            return;
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers))
            if (value)
              headers.set(key, Array.isArray(value) ? value.join(',') : value);
          const socketAddress = req.socket.remoteAddress || 'unknown';
          const realIP = req.headers['x-real-ip'];
          const loopback =
            socketAddress === '::1' ||
            (isIP(socketAddress) === 4 && socketAddress.startsWith('127.')) ||
            (isIP(socketAddress) === 6 &&
              socketAddress.startsWith('::ffff:127.'));
          const clientAddress =
            config.trustProxy === true &&
            loopback &&
            typeof realIP === 'string' &&
            isIP(realIP)
              ? realIP
              : socketAddress;
          const response = await api(
            new Request(url, {
              method: req.method,
              headers,
            ...(['POST', 'PUT', 'DELETE'].includes(req.method || '')
                ? { body: Buffer.concat(chunks).toString('utf8') }
                : {}),
            }),
            clientAddress,
          );
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          send({ error: '不支持的方法。' }, 405);
          return;
        }
        let name: string;
        try {
          name = decodeURIComponent(url.pathname);
        } catch {
          send({ error: '无效地址。' }, 400);
          return;
        }
        const file = resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (!file.startsWith(root + sep)) {
          send({ error: '不存在。' }, 404);
          return;
        }
        try {
          if (!(await stat(file)).isFile()) throw new Error();
          const bytes = await readFile(file);
          const type =
            (
              {
                '.html': 'text/html; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.ico': 'image/x-icon',
                '.woff2': 'font/woff2',
              } as Record<string, string>
            )[extname(file)] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': type,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control':
              extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
          });
          res.end(req.method === 'HEAD' ? undefined : bytes);
        } catch {
          send({ error: '页面不存在，请先构建网页。' }, 404);
        }
      })().catch(() => {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(500);
          res.end();
        }
      });
    },
  );
}
