import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importResume } from '../lib/import-resume.ts';
void test('import ignores PDF worker protocol messages and waits for actual text', async () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let terminated = false;
  class WorkerStub {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: unknown;
    terminate() {
      terminated = true;
    }
    postMessage() {
      this.onmessage?.({
        data: { sourceName: 'worker', targetName: 'main', action: 'ready' },
      });
      queueMicrotask(() =>
        this.onmessage?.({
          data: { type: 'resume-result', text: 'Example resume' },
        }),
      );
    }
  }
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: WorkerStub,
  });
  try {
    assert.equal(
      await importResume(new File(['fixture'], 'sample.pdf')),
      'Example resume',
    );
    assert.equal(terminated, true);
  } finally {
    if (old) Object.defineProperty(globalThis, 'Worker', old);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});
void test('unsupported or excessive files are rejected before reading', async () => {
  await assert.rejects(importResume(new File(['test'], 'scan.png')));
  await assert.rejects(
    importResume(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.pdf')),
  );
});
