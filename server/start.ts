import { Buffer } from 'node:buffer';
import { mkdir, chmod, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { QueueStore } from './queue/store.ts';
import { queueHttp } from './queue/http.ts';
if (process.env.INTERVIEW_ENV_FILE)
  process.loadEnvFile(process.env.INTERVIEW_ENV_FILE);
const preview = process.argv.includes('--preview');
const origin = process.env.INTERVIEW_PUBLIC_ORIGIN || 'http://localhost:8787';
const url = new URL(origin);
if (
  url.origin !== origin ||
  !(
    url.protocol === 'https:' ||
    (url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname))
  )
)
  throw new Error(
    'INTERVIEW_PUBLIC_ORIGIN 必须为 HTTPS 根地址，本机可使用 HTTP。',
  );
if (preview && !['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('免登录预览仅允许本机地址。');
const dataDir = resolve(
  process.env.INTERVIEW_DATA_DIR ||
    (preview ? '.local/preview-server' : '.local/server'),
);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await access(resolve('dist/web/index.html'));
const dbFile = join(dataDir, 'queue.sqlite');
const store = new QueueStore(dbFile);
await chmod(dbFile, 0o600);
let previewUser: string | undefined;
if (preview) {
  const existing = store.db
    .prepare('SELECT id FROM users WHERE id=?')
    .get('local-preview');
  previewUser = existing
    ? 'local-preview'
    : store.createUser(
        '本地预览',
        Buffer.from(randomBytes(24)).toString('hex'),
        'local-preview',
      ).id;
} else if (
  store.db.prepare('SELECT id FROM users WHERE id=?').get('local-preview')
) {
  throw new Error(
    '正式服务不能使用预览数据库，请设置独立的 INTERVIEW_DATA_DIR。',
  );
} else if (!store.userCount()) {
  const user = process.env.INTERVIEW_ADMIN_USER,
    password = process.env.INTERVIEW_ADMIN_PASSWORD;
  if (!user || !password)
    throw new Error(
      '首次启动请设置 INTERVIEW_ADMIN_USER 和 INTERVIEW_ADMIN_PASSWORD（至少12字）。',
    );
  store.createUser(user, password);
}
const server = queueHttp(store, { origin, previewUser }, resolve('dist/web'));
const port = Number(process.env.INTERVIEW_PORT || 8787);
let connector: ReturnType<typeof spawn> | undefined,
  stopping = false;
const sweep = setInterval(() => store.sweep(), 30000);
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(sweep);
  connector?.kill('SIGTERM');
  server.close();
  server.closeAllConnections();
  store.close();
  setTimeout(() => process.exit(code), 1000).unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.on('error', () => {
  console.error('服务器监听失败，请检查端口与配置。');
  stop(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`面试工作台：${origin}${preview ? '（本机预览模式）' : ''}`);
  if (previewUser) {
    void (async () => {
      // The preview worker is an independent process, using the same pairing and queue as a remote computer.
      const old = store.devices(previewUser!);
      for (const d of old)
        if (d.name === '本机预览连接器')
          store.revoke(previewUser!, String(d.id));
      const credential = store.redeem(
        store.pairing(previewUser!).code,
        '本机预览连接器',
      );
      const path = join(dataDir, 'preview-connector.json');
      await writeFile(path, JSON.stringify({ ...credential, server: origin }), {
        mode: 0o600,
      });
      await chmod(path, 0o600);
      const env = { ...process.env };
      delete env.INTERVIEW_ADMIN_PASSWORD;
      delete env.INTERVIEW_ENV_FILE;
      connector = spawn(
        process.execPath,
        ['--experimental-strip-types', 'server/connector.ts', '--config', path],
        { stdio: 'inherit', env },
      );
      connector.on('error', () =>
        console.error('本地连接器启动失败，可手动运行 npm run connector。'),
      );
    })().catch(() => console.error('预览连接器启动失败，请重启工作台。'));
  }
});
