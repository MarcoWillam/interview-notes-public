import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importTranscript } from '../lib/import-transcript.ts';

const file = (text: string, name = '面试.md') => new File([text], name);
void test('imports Markdown and TXT as literal text with speaker labels preserved', async () => {
  const text =
    '# 面试记录\n\n[00:01] 面试官：介绍项目。\n候选人：负责开发。\n<script>alert(1)</script>';
  assert.equal(await importTranscript(file(text, '访谈.MD')), text);
  assert.equal(await importTranscript(file(text, '访谈.TXT')), text);
});
void test('normalizes UTF-8 BOM and line endings', async () => {
  assert.equal(
    await importTranscript(file('\uFEFF# 面试\r\n候选人：回答\r下一行')),
    '# 面试\n候选人：回答\n下一行',
  );
});
void test('rejects other extensions even with a text MIME type', async () => {
  for (const name of ['x.pdf', 'x.docx', 'x.rtf', 'x.txt.exe']) {
    await assert.rejects(
      importTranscript(new File(['正文'], name, { type: 'text/plain' })),
      /仅支持.*\.md.*\.txt/,
    );
  }
});
void test('rejects empty or whitespace-only Markdown', async () => {
  for (const text of ['', ' \n\t\uFEFF'])
    await assert.rejects(importTranscript(file(text)), /没有可用文字/);
});
void test('rejects oversized files before reading them', async () => {
  let read = false;
  await assert.rejects(
    importTranscript({
      name: 'large.md',
      size: 1024 * 1024 + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    }),
    /1 MB/,
  );
  assert.equal(read, false);
});
void test('enforces character limit without truncating', async () => {
  assert.equal(
    (await importTranscript(file('字'.repeat(80000)))).length,
    80000,
  );
  await assert.rejects(importTranscript(file('字'.repeat(80001))), /80,000/);
});
void test('rejects invalid UTF-8 and binary data', async () => {
  await assert.rejects(
    importTranscript(new File([new Uint8Array([0xff, 0xfe, 0x61])], 'x.md')),
    /UTF-8/,
  );
  await assert.rejects(importTranscript(file('正文\0二进制')), /纯文本/);
});
void test('reports file read failure', async () => {
  await assert.rejects(
    importTranscript({
      name: 'x.md',
      size: 12,
      arrayBuffer: async () => {
        throw new Error('disk');
      },
    }),
    /无法读取/,
  );
});

void test('interview record accepts pasted text without requiring an imported file', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(page, /直接粘贴或输入面试记录/);
  assert.match(page, /disabled=\{!!busy\}/);
  assert.doesNotMatch(page, /disabled=\{!!busy \|\| !transcriptName\}/);
  assert.match(page, /手动粘贴 \/ 输入/);
  assert.match(page, /accept="\.md,\.txt"/);
  assert.match(page, /支持 \.md、\.txt/);
});
