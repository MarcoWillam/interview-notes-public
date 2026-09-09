import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
// Install PDF.js's in-process handler inside our bounded import worker.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
export async function extractPdfResume(data: ArrayBuffer): Promise<string> {
  if (!data.byteLength || data.byteLength > 5 * 1024 * 1024)
    throw new Error('简历文件不能为空，且不能超过 5 MB');
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-')
    throw new Error('PDF 文件格式无效，请重新导出。');
  const browser = typeof location !== 'undefined';
  const task = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    // Dedicated Workers have no document; load CMaps/fonts through worker-safe fetch.
    useWorkerFetch: browser,
    stopAtErrors: true,
    ...(browser
      ? {
          cMapUrl: new URL('/pdf-assets/cmaps/', location.origin).href,
          cMapPacked: true,
          standardFontDataUrl: new URL(
            '/pdf-assets/standard_fonts/',
            location.origin,
          ).href,
        }
      : {}),
  });
  try {
    const document = await task.promise;
    if (document.numPages > 30)
      throw new Error('PDF 简历最多支持 30 页，请精简后上传。');
    const pages: string[] = [];
    let length = 0;
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items)
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      text = text.trim();
      if (!text)
        throw new Error(
          `PDF 第 ${n} 页没有可提取文字，可能是扫描或空白页。请转换为文字版、删除空白页，或手动粘贴正文。`,
        );
      const part = `【第 ${n} 页】\n${text}`;
      length += part.length + 2;
      if (length > 30000)
        throw new Error('简历文字超过 30,000 字，请精简后导入。');
      pages.push(part);
      page.cleanup();
    }
    return pages.join('\n\n');
  } catch (e) {
    if (e instanceof Error && e.name === 'PasswordException')
      throw new Error('PDF 已加密，请另存为未加密文件后上传。');
    if (e instanceof Error && /PDF.*页|30,000/.test(e.message)) throw e;
    throw new Error(
      'PDF 无法读取或已损坏，请重新导出文字版 PDF，或手动粘贴正文。',
    );
  } finally {
    await task.destroy();
  }
}
