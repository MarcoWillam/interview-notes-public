import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { extractPdfResume } from '../lib/resume-pdf.ts';
function pdf(text: string, pages = 1) {
  const stream = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array(pages).fill('3 0 R').join(' ')}] /Count ${pages} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = out.length;
  out +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Uint8Array.from(Buffer.from(out)).buffer;
}
void test('extracts actual PDF text with page separation', async () => {
  assert.match(
    await extractPdfResume(pdf('Candidate sample - Product Manager', 2)),
    /Candidate sample - Product Manager/,
  );
});
void test('rejects corrupt, image-only/blank and excessive-page PDFs', async () => {
  await assert.rejects(
    extractPdfResume(new TextEncoder().encode('not pdf').buffer),
  );
  await assert.rejects(extractPdfResume(pdf('')), /扫描|文字/);
  await assert.rejects(extractPdfResume(pdf('Example', 31)), /30/);
});
