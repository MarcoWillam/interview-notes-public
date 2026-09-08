import type { LocalStore } from './store.ts';

// Only failed chunks remain in memory. A failed read never discards them.
export function createAudioWriter(
  store: LocalStore,
  id: string,
  mime: string,
  onFailure: () => void,
) {
  let writes = Promise.resolve();
  let sequence = 0;
  let failed = false;
  const pending: { sequence: number; blob: Blob; seconds: number }[] = [];
  return {
    append(blob: Blob, seconds: number) {
      const part = { sequence: sequence++, blob, seconds };
      writes = writes.then(async () => {
        if (failed) {
          pending.push(part);
          return;
        }
        try {
          await store.appendAudio(id, part.sequence, blob, seconds);
        } catch {
          failed = true;
          pending.push(part);
          onFailure();
        }
      });
    },
    async finish(seconds: number, retry = false) {
      await writes;
      if (retry) {
        while (pending.length) {
          const part = pending[0];
          try {
            await store.appendAudio(id, part.sequence, part.blob, part.seconds);
            pending.shift();
          } catch {
            // Disk may still be full even when reads have recovered. Expose
            // the combined Blob for download without discarding pending data.
            break;
          }
        }
      }
      const saved = await store.readAudio(id);
      const blob = new Blob(
        [...(saved ? [saved] : []), ...pending.map((p) => p.blob)],
        { type: mime },
      );
      let complete = pending.length === 0;
      try {
        await store.finishAudio(id, seconds, complete);
      } catch {
        complete = false;
      }
      return { blob, complete };
    },
  };
}
