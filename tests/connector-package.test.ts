import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { connectorPackageFiles } from '../scripts/connector-package-files.mjs';
import { unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');

void test('connector package contains every local TypeScript dependency', async () => {
  const packaged = new Set(connectorPackageFiles);
  for (const file of connectorPackageFiles) {
    const source = await readFile(resolve(root, file), 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+\.ts)['"]/g)) {
      const dependency = relative(
        root,
        resolve(root, dirname(file), match[1]),
      );
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
});
