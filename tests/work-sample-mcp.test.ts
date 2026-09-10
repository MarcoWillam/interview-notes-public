import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkSampleMcp } from '../server/work-samples/mcp.ts';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'work-sample-mcp-test-'));
  await mkdir(join(root, 'docs'));
  await writeFile(
    join(root, 'docs', 'brief.md'),
    '目标用户是运营人员\n验证核心假设',
  );
  await writeFile(join(root, 'screen.png'), new Uint8Array([137, 80, 78, 71]));
  return root;
}

void test('work sample MCP exposes only confined read tools', async () => {
  const root = await workspace();
  try {
    const mcp = createWorkSampleMcp({
      root,
      readable: ['docs/brief.md', 'screen.png'],
    });
    assert.deepEqual(mcp.toolNames(), [
      'list_files',
      'search_files',
      'read_text',
      'read_document',
      'read_image',
    ]);
    const listed = await mcp.call('list_files', {});
    assert.match(JSON.stringify(listed), /docs\/brief\.md/);
    const text = await mcp.call('read_text', { path: 'docs/brief.md' });
    assert.match(JSON.stringify(text), /目标用户是运营人员/);
    const matches = await mcp.call('search_files', { query: '核心假设' });
    assert.match(JSON.stringify(matches), /brief\.md/);
    await assert.rejects(() => mcp.call('write_file', {}), /不支持/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('work sample MCP rejects escapes, links and files outside its manifest', async () => {
  const root = await workspace();
  const outside = join(root, '..', 'work-sample-secret.txt');
  try {
    await writeFile(outside, 'secret');
    await symlink(outside, join(root, 'linked.txt'));
    const mcp = createWorkSampleMcp({
      root,
      readable: ['docs/brief.md', 'linked.txt'],
    });
    for (const path of [
      '../work-sample-secret.txt',
      outside,
      'missing.txt',
      'linked.txt',
    ])
      await assert.rejects(() => mcp.call('read_text', { path }), /无法读取/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

void test('work sample MCP returns images without offering code execution', async () => {
  const root = await workspace();
  try {
    const mcp = createWorkSampleMcp({ root, readable: ['screen.png'] });
    const result = await mcp.call('read_image', { path: 'screen.png' });
    assert.equal(result.content[0].type, 'image');
    assert.equal(result.content[0].mimeType, 'image/png');
    assert.equal(typeof result.content[0].data, 'string');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
