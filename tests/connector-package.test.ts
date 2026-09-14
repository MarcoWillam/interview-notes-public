import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { connectorPackageFiles } from '../scripts/connector-package-files.mjs';
import { CONNECTOR_VERSION } from '../lib/connector-release.ts';
import { unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

void test('connector package includes the structured outline runtime modules', () => {
  for (const file of [
    'lib/interview-outline-v2.ts',
    'lib/interview-outline-v2-prompt.ts',
    'lib/outline-v2-supplement.ts',
    'lib/interview-outline-v3.ts',
    'lib/interview-outline-v3-prompt.ts',
    'lib/outline-v3-supplement.ts',
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
