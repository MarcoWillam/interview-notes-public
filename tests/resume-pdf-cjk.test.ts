import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { extractPdfResume } from '../lib/resume-pdf.ts';
function chinesePdf() {
  const stream = 'BT /F1 12 Tf 40 700 Td <6D4B8BD5501990094EBA> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const start = out.length;
  out +=
    'xref\n0 8\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Uint8Array.from(Buffer.from(out)).buffer;
}
void test('Chinese PDF can fetch required CMaps over HTTP without a document object', async () => {
  let maps = 0;
  const server = createServer((req, res) => {
    void (async () => {
      const match = req.url?.match(
        /^\/pdf-assets\/(cmaps|standard_fonts)\/([\w.-]+)$/,
      );
      if (!match) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (match[1] === 'cmaps') maps++;
      try {
        res.end(
          await readFile(
            new URL(
              '../node_modules/pdfjs-dist/' + match[1] + '/' + match[2],
              import.meta.url,
            ),
          ),
        );
      } catch {
        res.writeHead(404);
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  const old = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'http://127.0.0.1:' + address.port },
  });
  try {
    assert.equal(typeof globalThis.document, 'undefined');
    assert.match(await extractPdfResume(chinesePdf()), /测试候选人/);
    assert.ok(maps > 0);
  } finally {
    if (old) Object.defineProperty(globalThis, 'location', old);
    else Reflect.deleteProperty(globalThis, 'location');
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
});
