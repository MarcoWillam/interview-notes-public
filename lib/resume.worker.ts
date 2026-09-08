import { extractResume } from './resume';
self.onmessage = (event: MessageEvent<{ name: string; data: ArrayBuffer }>) => {
  void extractResume(event.data.name, event.data.data)
    .then((text) => self.postMessage({ text }))
    .catch((e: unknown) =>
      self.postMessage({
        error: e instanceof Error ? e.message : '简历解析失败',
      }),
    );
};
