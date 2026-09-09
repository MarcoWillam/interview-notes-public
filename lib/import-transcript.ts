/** Read a bounded UTF-8 Markdown file as literal text; never render its HTML. */
export async function importTranscript(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
): Promise<string> {
  if (!/\.md$/i.test(file.name)) throw new Error('面试记录仅支持 .md 文件。');
  if (file.size > 1024 * 1024) throw new Error('面试记录文件不能超过 1 MB。');
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error('无法读取文件，请重新选择面试记录。');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('请将面试记录保存为 UTF-8 编码的 .md 文件后重试。');
  }
  text = text.replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('文件中没有可用文字，请检查面试记录。');
  // oxlint-disable-next-line no-control-regex -- Reject binary control bytes while preserving tabs and line breaks.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
    throw new Error('文件包含非文本内容，请上传纯文本 Markdown 文件。');
  if (text.length > 80000)
    throw new Error('面试记录超过 80,000 字，请拆分整理后重新导入。');
  return text;
}
