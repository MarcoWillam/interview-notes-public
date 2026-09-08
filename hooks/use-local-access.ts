'use client';
import { useEffect, useState } from 'react';
export function useLocalAccess() {
  const [access, setAccess] = useState<
    'loading' | 'ready' | 'blocked' | 'unavailable'
  >('loading');
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    if (!navigator.locks || !globalThis.indexedDB) {
      queueMicrotask(() => {
        if (!disposed) setAccess('unavailable');
      });
      return () => {
        disposed = true;
      };
    }
    void navigator.locks
      .request('miantan-local-editor', { ifAvailable: true }, async (lock) => {
        if (disposed) return;
        if (!lock) {
          setAccess('blocked');
          return;
        }
        setAccess('ready');
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => {
        if (!disposed) setAccess('unavailable');
      });
    return () => {
      disposed = true;
      release?.();
    };
  }, []);
  return access;
}
