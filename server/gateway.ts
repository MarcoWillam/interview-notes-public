import { Buffer } from 'node:buffer';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createAnalysisHandler } from './analysis.ts';
import { analyzeWithCodex, codexStatus } from './codex.ts';

function respond(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}
async function readBody(request: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 550000) chunks.push(chunk);
    });
    request.on('end', () =>
      resolve(size > 550000 ? null : Buffer.concat(chunks)),
    );
    request.on('error', reject);
  });
}
export function createGateway(options: {
  port: number;
  frontendPort: number;
  analyze?: typeof analyzeWithCodex;
  status?: typeof codexStatus;
}) {
  const analyze = createAnalysisHandler(options.analyze || analyzeWithCodex);
  const status = options.status || codexStatus;
  const controllers = new Set<AbortController>();
  const server = createServer(
    { requestTimeout: 30000, headersTimeout: 10000 },
    (request, response) => {
      void (async () => {
        const host = request.headers.host;
        if (
          !host ||
          ![`localhost:${options.port}`, `127.0.0.1:${options.port}`].includes(
            host,
          )
        ) {
          respond(response, { error: '仅允许本机工作台访问。' }, 403);
          return;
        }
        const url = new URL(request.url || '/', `http://${host}`);
        if (url.origin !== `http://${host}`) {
          respond(response, { error: '请求地址不受支持。' }, 403);
          return;
        }
        if (
          request.headers['sec-fetch-site'] === 'cross-site' ||
          (request.headers.origin && request.headers.origin !== url.origin)
        ) {
          respond(response, { error: '请从本地工作台发起请求。' }, 403);
          return;
        }
        if (url.pathname === '/api/status' && request.method === 'GET') {
          respond(response, await status());
          return;
        }
        if (url.pathname === '/api/analyze' && request.method === 'POST') {
          if (
            request.headers.origin !== url.origin ||
            !request.headers['content-type']?.startsWith('application/json')
          ) {
            respond(response, { error: '请求来源或格式不受支持。' }, 403);
            return;
          }
          if (Number(request.headers['content-length']) > 550000) {
            request.resume();
            respond(response, { error: '面试资料超过大小限制。' }, 413);
            return;
          }
          const controller = new AbortController();
          controllers.add(controller);
          const cancel = () => controller.abort();
          response.once('close', cancel);
          try {
            const bytes = await readBody(request);
            if (!bytes) {
              respond(response, { error: '面试资料超过大小限制。' }, 413);
              return;
            }
            const result = await analyze(
              new Request(url, {
                method: 'POST',
                headers: {
                  origin: url.origin,
                  'content-type': 'application/json',
                },
                body: new TextDecoder().decode(bytes),
                signal: controller.signal,
              }),
            );
            if (!response.destroyed) {
              response.writeHead(
                result.status,
                Object.fromEntries(result.headers),
              );
              response.end(await result.text());
            }
          } finally {
            controllers.delete(controller);
            response.removeListener('close', cancel);
          }
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          respond(response, { error: '本地工作台仅启用文本评估。' }, 404);
          return;
        }
        if (!['GET', 'HEAD'].includes(request.method || '')) {
          respond(response, { error: '不支持的请求方法。' }, 405);
          return;
        }
        const upstream = httpRequest(
          {
            hostname: '127.0.0.1',
            port: options.frontendPort,
            path: url.pathname + url.search,
            method: request.method,
            headers: { ...request.headers, host },
          },
          (incoming) => {
            response.writeHead(incoming.statusCode || 502, incoming.headers);
            incoming.pipe(response);
          },
        );
        upstream.on('error', () => {
          if (!response.headersSent)
            respond(
              response,
              { error: '本地页面服务暂不可用，请重启工作台。' },
              502,
            );
          else response.destroy();
        });
        response.on('close', () => upstream.destroy());
        upstream.end();
      })().catch(() => {
        if (!response.headersSent && !response.destroyed)
          respond(response, { error: '本地服务请求失败，请重试。' }, 500);
      });
    },
  );
  server.on('close', () =>
    controllers.forEach((controller) => controller.abort()),
  );
  return {
    server,
    cancelAll: () => controllers.forEach((controller) => controller.abort()),
  };
}
