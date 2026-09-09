export async function importResume(file: File): Promise<string> {
  if (
    !/\.(doc|docx|pdf)$/i.test(file.name) ||
    file.size > 5 * 1024 * 1024 ||
    !file.size
  )
    throw new Error('请选择不超过 5 MB 的 .doc、.docx 或文字版 .pdf 文件');
  const data = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./resume.worker.ts', import.meta.url), {
      type: 'module',
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('简历解析超时，请另存为 DOCX 或手动粘贴文字'));
    }, 20000);
    const close = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (
      event: MessageEvent<{ type?: string; text?: string; error?: string }>,
    ) => {
      if (event.data?.type !== 'resume-result') return;
      close();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.text || '');
    };
    worker.onerror = () => {
      close();
      reject(new Error('无法解析该简历，请重新导入或手动粘贴文字'));
    };
    worker.postMessage({ name: file.name, data }, [data]);
  });
}
