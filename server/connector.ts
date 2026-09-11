import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { hostname } from 'node:os';
import {
  ensureWorkSampleInbox,
  scanWorkSampleInbox,
} from './work-samples/inventory.ts';
import { cleanupStaleWorkSampleDirectories } from './work-samples/archive.ts';
import { analyzeWithCodex, codexStatus } from './codex.ts';
import {
  connectorRequest,
  runConnector,
  validateServer,
  type Credentials,
} from './queue/connector-client.ts';
import {
  CONNECTOR_VERSION,
  connectorRelease,
} from '../lib/connector-release.ts';
const { values } = parseArgs({
  options: {
    server: { type: 'string' },
    pair: { type: 'string' },
    config: { type: 'string' },
  },
});
const file = resolve(values.config || '.local/connector.json');
try {
  let credentials: Credentials;
  if (values.pair) {
    if (!values.server) throw new Error('请同时提供 --server 和 --pair。');
    const server = validateServer(values.server);
    const data = await connectorRequest(server, '/api/pair/redeem', {
      code: values.pair,
      name: hostname().slice(0, 80),
      connector: connectorRelease,
    });
    if (typeof data.token !== 'string' || typeof data.id !== 'string')
      throw new Error('配对响应无效。');
    credentials = { server, token: data.token, id: data.id };
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(credentials), { mode: 0o600 });
    await chmod(file, 0o600);
    console.log('配对成功，连接凭据已保存到本机。');
  } else {
    try {
      credentials = JSON.parse(await readFile(file, 'utf8')) as Credentials;
      if (
        typeof credentials.server !== 'string' ||
        typeof credentials.token !== 'string' ||
        typeof credentials.id !== 'string'
      )
        throw new Error();
      validateServer(credentials.server);
    } catch {
      throw new Error(
        '无法读取有效的本机连接凭据，请先用 --server 和 --pair 配对。',
      );
    }
  }
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  process.on('SIGTERM', () => controller.abort());
  const workSampleInbox = await ensureWorkSampleInbox();
  await cleanupStaleWorkSampleDirectories();
  console.log(`连接器版本：${CONNECTOR_VERSION}`);
  console.log(`本地作品箱：${workSampleInbox}`);
  console.log('连接器已启动，等待属于此账号的面试评估任务。');
  await runConnector(credentials, controller.signal, {
    analyze: analyzeWithCodex,
    status: codexStatus,
    workSamples: () => scanWorkSampleInbox(workSampleInbox, credentials.id),
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : '连接器启动失败。');
  process.exitCode = 1;
}
