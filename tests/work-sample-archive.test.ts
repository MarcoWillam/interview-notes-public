import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  ensureWorkSampleInbox,
  scanWorkSampleInbox,
} from '../server/work-samples/inventory.ts';
import { extractWorkSample } from '../server/work-samples/archive.ts';

async function fixture(entries: Record<string, Uint8Array>) {
  const root = await mkdtemp(join(tmpdir(), 'work-sample-archive-test-'));
  const input = join(root, 'candidate.zip');
  await writeFile(input, zipSync(entries));
  return { root, input, output: join(root, 'output') };
}

void test('local inbox exposes bounded metadata without leaking paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-sample-inbox-test-'));
  try {
    const inbox = await ensureWorkSampleInbox(root);
    await writeFile(
      join(inbox, 'candidate.zip'),
      zipSync({ 'README.md': strToU8('# 作品') }),
    );
    await writeFile(join(inbox, 'ignore.txt'), 'not an archive');
    const index = await scanWorkSampleInbox(inbox, 'device-12345678');
    assert.equal(index.artifacts.length, 1);
    assert.equal(index.artifacts[0].name, 'candidate.zip');
    assert.equal(index.artifacts[0].deviceId, 'device-12345678');
    assert.match(index.artifacts[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal('path' in index.artifacts[0], false);
    assert.equal(index.files.get(index.artifacts[0].id), join(inbox, 'candidate.zip'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('safe extraction keeps source and document files while excluding secrets and dependencies', async () => {
  const item = await fixture({
    'README.md': strToU8('目标用户是运营人员'),
    'src/app.ts': strToU8('export const ready = true;'),
    'docs/brief.pdf': new Uint8Array([37, 80, 68, 70]),
    'node_modules/pkg/index.js': strToU8('ignored'),
    '.env': strToU8('TOKEN=secret'),
    'assets/raw.bin': new Uint8Array([0, 1, 2]),
  });
  try {
    const manifest = await extractWorkSample(item.input, item.output);
    assert.deepEqual(manifest.readable.sort(), [
      'README.md',
      'docs/brief.pdf',
      'src/app.ts',
    ]);
    assert.ok(manifest.excluded.includes('.env'));
    assert.ok(manifest.excluded.includes('node_modules/pkg/index.js'));
    assert.ok(manifest.unsupported.includes('assets/raw.bin'));
    assert.equal(await readFile(join(item.output, 'README.md'), 'utf8'), '目标用户是运营人员');
    await assert.rejects(() => readFile(join(item.output, '.env')));
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

void test('unsafe archive paths and nested archives are rejected before extraction', async () => {
  const cases: Record<string, Uint8Array>[] = [
    { '../escape.txt': strToU8('escape') },
    { '/absolute.txt': strToU8('escape') },
    { 'nested.zip': zipSync({ 'x.txt': strToU8('nested') }) },
    { ['a/'.repeat(21) + 'deep.txt']: strToU8('deep') },
  ];
  for (const entries of cases) {
    const item = await fixture(entries);
    try {
      await assert.rejects(() => extractWorkSample(item.input, item.output));
    } finally {
      await rm(item.root, { recursive: true, force: true });
    }
  }
});

void test('an indexed work sample is not reusable after the ZIP changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-sample-change-test-'));
  try {
    const inbox = await ensureWorkSampleInbox(root);
    const file = join(inbox, 'candidate.zip');
    await writeFile(file, zipSync({ 'a.txt': strToU8('one') }));
    const first = await scanWorkSampleInbox(inbox, 'device-12345678');
    await writeFile(file, zipSync({ 'a.txt': strToU8('two') }));
    const second = await scanWorkSampleInbox(inbox, 'device-12345678');
    assert.notEqual(first.artifacts[0].sha256, second.artifacts[0].sha256);
    assert.notEqual(first.artifacts[0].id, second.artifacts[0].id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('unchanged ZIP metadata reuses the cached content hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-sample-cache-test-'));
  try {
    const inbox = await ensureWorkSampleInbox(root);
    await writeFile(
      join(inbox, 'candidate.zip'),
      zipSync({ 'README.md': strToU8('cached') }),
    );
    let hashes = 0;
    const hashFile = async () => {
      hashes++;
      return 'c'.repeat(64);
    };
    await scanWorkSampleInbox(inbox, 'device-12345678', { hashFile });
    await scanWorkSampleInbox(inbox, 'device-12345678', { hashFile });
    assert.equal(hashes, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
