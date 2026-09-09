import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createGateway } from './gateway.ts';
const port = 8787,
  frontendPort = 8788;
// The frontend is only a local renderer; API keys are not needed by this process.
const frontend = spawn(
  process.execPath,
  [
    resolve('node_modules/wrangler/bin/wrangler.js'),
    'dev',
    '--config',
    resolve('dist/server/wrangler.json'),
    '--ip',
    '127.0.0.1',
    '--port',
    String(frontendPort),
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
);
const { server, cancelAll } = createGateway({ port, frontendPort });
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  cancelAll();
  server.close();
  server.closeAllConnections();
  try {
    if (frontend.pid) {
      if (process.platform === 'win32') frontend.kill();
      else process.kill(-frontend.pid, 'SIGTERM');
    }
  } catch {
    /* Already exited. */
  }
  process.exitCode = code;
  setTimeout(() => {
    try {
      if (frontend.pid && process.platform !== 'win32')
        process.kill(-frontend.pid, 'SIGKILL');
    } catch {
      /* Already exited. */
    }
    process.exit(code);
  }, 1500).unref();
}
frontend.stdout.resume();
frontend.stderr.resume();
frontend.on('error', () => {
  console.error('无法启动本地页面服务，请先安装依赖并运行 npm run build。');
  stop(1);
});
frontend.on('exit', () => {
  if (!stopping) {
    console.error(
      '本地页面服务已退出，请检查端口 8788 是否被占用，并重新启动。',
    );
    stop(1);
  }
});
server.on('error', () => {
  console.error('无法监听本地 8787 端口，请关闭旧预览后重试。');
  stop(1);
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
let ready = false;
for (let attempt = 0; attempt < 80 && !stopping; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${frontendPort}/`, {
      signal: AbortSignal.timeout(1000),
    });
    await response.body?.cancel();
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Renderer is starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!stopping) {
  if (!ready) {
    console.error('本地页面启动超时，请先运行 npm run build。');
    stop(1);
  } else
    server.listen(port, '127.0.0.1', () =>
      console.log(`本地 Codex 面试工作台：http://localhost:${port}/`),
    );
}
