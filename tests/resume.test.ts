import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractResume } from '../lib/resume.ts';
void test('binary Word 97 document extracts actual document text', async () => {
  const bytes = await readFile(
    new URL('./fixtures/legacy.doc', import.meta.url),
  );
  const text = await extractResume('resume.doc', Uint8Array.from(bytes).buffer);
  assert.ok(text.length > 100);
  assert.match(text, /JSDoc|showcase|heading|Heading|Lorem/);
});
void test('renamed or corrupt DOC files fail explicitly', async () => {
  await assert.rejects(
    extractResume('bad.doc', new Uint8Array([1, 2, 3]).buffer),
  );
});
import { zipSync, strToU8 } from 'fflate';
void test('DOCX paragraphs and Chinese text are extracted as text, never HTML', async () => {
  const doc = zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>测试候选人</w:t></w:r></w:p><w:p><w:r><w:t>三年产品调研经验</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  const text = await extractResume('resume.docx', Uint8Array.from(doc).buffer);
  assert.match(text, /测试候选人/);
  assert.match(text, /三年产品调研经验/);
  assert.ok(!text.includes('<w:'));
});
void test('large and unsupported resume inputs fail before parsing', async () => {
  await assert.rejects(
    extractResume('large.doc', new ArrayBuffer(5 * 1024 * 1024 + 1)),
  );
  await assert.rejects(extractResume('resume.pdf', new ArrayBuffer(2)));
});
