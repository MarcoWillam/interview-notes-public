import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('computer connection dialog explains first pairing and later startup', async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL('../components/interview/remote-workspace.tsx', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /首次配对/);
  assert.match(source, /保持连接/);
  assert.match(source, /以后启动/);
  assert.match(source, /配对码仅可使用一次，10 分钟内有效/);
  assert.match(source, /关闭终端会停止领取任务，但不会使已保存的配对失效/);
  assert.match(source, /\.local\/connector\.json/);
  assert.match(source, /首次配对命令/);
  assert.match(source, /npm run connector/);
  assert.match(css, /\.remote-connector-guide/);
  assert.match(css, /\.remote-connector-step/);
});
