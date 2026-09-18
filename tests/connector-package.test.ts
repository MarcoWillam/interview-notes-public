import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { connectorPackageFiles } from '../scripts/connector-package-files.mjs';
import { CONNECTOR_VERSION } from '../lib/connector-release.ts';
import { unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

function zipUnixMode(archive: Uint8Array, target: string) {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  let eocd = archive.byteLength - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  assert.ok(eocd >= 0, 'ZIP end-of-central-directory record is missing');
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const filename = decoder.decode(
      archive.subarray(offset + 46, offset + 46 + filenameLength),
    );
    if (filename === target) {
      assert.equal(view.getUint16(offset + 4, true) >> 8, 3);
      return (view.getUint32(offset + 38, true) >>> 16) & 0xffff;
    }
    offset += 46 + filenameLength + extraLength + commentLength;
  }
  assert.fail(`ZIP entry is missing: ${target}`);
}

void test('connector package keeps interview prompts and validators on the server', () => {
  for (const file of [
    'server/codex.ts',
    'server/execution-contract.ts',
    'lib/assessment.ts',
    'lib/resume-reading.ts',
    'lib/written-test-supplement.ts',
    'lib/outline-regeneration.ts',
    'lib/work-sample.ts',
    'lib/interview-outline-v2.ts',
    'lib/interview-outline-v2-prompt.ts',
    'lib/outline-v2-supplement.ts',
    'lib/interview-outline-v3.ts',
    'lib/interview-outline-v3-prompt.ts',
    'lib/outline-v3-supplement.ts',
    'lib/follow-up-outline.ts',
  ])
    assert.equal(
      connectorPackageFiles.includes(file),
      false,
      `${file} must stay server-only`,
    );
  for (const file of [
    'lib/codex-execution-contract.ts',
    'server/codex-runtime.ts',
    'server/contract-executor.ts',
    'server/work-samples/runtime.ts',
  ])
    assert.ok(connectorPackageFiles.includes(file), `${file} must be packaged`);
});

void test('connector package contains every local TypeScript dependency', async () => {
  const packaged = new Set(connectorPackageFiles);
  for (const file of connectorPackageFiles) {
    const source = await readFile(resolve(root, file), 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+\.ts)['"]/g)) {
      const dependency = relative(root, resolve(root, dirname(file), match[1]));
      assert.ok(
        packaged.has(dependency),
        `${file} requires missing connector file ${dependency}`,
      );
    }
  }
});

void test('connector package carries the ZIP reader and its license without install', async () => {
  const archive = await readFile('public/downloads/interview-connector.zip');
  const files = unzipSync(new Uint8Array(archive));
  assert.ok(files['interview-connector/node_modules/fflate/package.json']);
  assert.ok(files['interview-connector/node_modules/fflate/esm/index.mjs']);
  assert.ok(files['interview-connector/node_modules/fflate/LICENSE']);
  const instructions = new TextDecoder().decode(
    files['interview-connector/使用说明.txt'],
  );
  const packageJson = JSON.parse(
    new TextDecoder().decode(files['interview-connector/package.json']),
  ) as { version: string };
  assert.equal(packageJson.version, CONNECTOR_VERSION);
  assert.match(instructions, /works/);
  assert.match(instructions, /50 MB/);
  assert.match(instructions, /作品原件.*不会上传服务器/);
  assert.match(instructions, /\.local\/connector\.json/);
  assert.match(instructions, /无需重新配对/);
  assert.match(instructions, /规则更新无需再次替换连接器/);
});

void test('connector package includes a safe executable macOS launcher', async () => {
  const archive = new Uint8Array(
    await readFile('public/downloads/interview-connector.zip'),
  );
  const launcherName = 'interview-connector/连接云端面试工作台.command';
  const files = unzipSync(archive);
  const launcher = new TextDecoder().decode(files[launcherName]);
  assert.match(launcher, /\$\{0:A:h\}/);
  assert.match(launcher, /https:\/\/47\.119\.135\.138/);
  assert.doesNotMatch(launcher, /\/Users\//);
  assert.equal(zipUnixMode(archive, launcherName), 0o755);
});

void test('connector archive excludes private files and unsafe paths', async () => {
  const archive = await readFile('public/downloads/interview-connector.zip');
  const names = Object.keys(unzipSync(new Uint8Array(archive)));
  for (const name of names) {
    assert.ok(name.startsWith('interview-connector/'));
    assert.ok(!name.startsWith('/'));
    assert.ok(!name.split('/').includes('..'));
    assert.doesNotMatch(name, /(?:^|\/)\.env(?:\.|$)/);
    assert.doesNotMatch(name, /(?:^|\/)\.local(?:\/|$)/);
    assert.doesNotMatch(
      name,
      /(?:^|\/)(?:resumes?|简历|credentials?)(?:\/|$)/i,
    );
  }
});
