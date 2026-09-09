import docToText from './vendor/docToText.js';
import { unzipSync } from 'fflate';
import mammoth from 'mammoth/mammoth.browser.js';
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export async function extractResume(
  name: string,
  data: ArrayBuffer,
): Promise<string> {
  if (!/\.(doc|docx|pdf)$/i.test(name))
    throw new Error('请选择 .doc、.docx 或文字版 .pdf 简历');
  if (!data.byteLength || data.byteLength > MAX_RESUME_BYTES)
    throw new Error('简历文件不能为空，且不能超过 5 MB');
  if (/\.pdf$/i.test(name))
    return (await import('./resume-pdf.ts')).extractPdfResume(data);
  const bytes = new Uint8Array(data);
  let text: string | null = null;
  if (/\.docx$/i.test(name)) {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
      throw new Error('DOCX 格式无效或已加密，请在 Word 中另存为未加密 DOCX');
    let expanded = 0;
    let documentFound = false;
    try {
      unzipSync(bytes, {
        filter: (entry) => {
          expanded += entry.originalSize;
          if (
            expanded > 16 * 1024 * 1024 ||
            entry.originalSize > 8 * 1024 * 1024
          )
            throw new Error('too large');
          if (entry.name === 'word/document.xml') documentFound = true;
          return false;
        },
      });
      if (!documentFound) throw new Error('no document');
      text = (await mammoth.extractRawText({ arrayBuffer: data })).value;
    } catch {
      throw new Error('DOCX 无法读取、已损坏或解压后过大，请另存后重试');
    }
  } else {
    text = docToText(bytes);
    if (text === null)
      throw new Error(
        'DOC 无法读取：支持未加密的 Word 97–2003 文档。请另存为 DOCX 后重试',
      );
  }
  text = text.replaceAll(String.fromCharCode(0), '').trim();
  if (!text) throw new Error('简历没有可读取的文字；扫描图片需要先转换为文字');
  if (text.length > 30000)
    throw new Error('简历文字超过 30,000 字，请精简后导入');
  return text;
}
