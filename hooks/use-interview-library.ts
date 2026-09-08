'use client';
import { useEffect, useRef, useState } from 'react';
import {
  localStore,
  type SavedInterview,
  type AudioRecord,
  type Preference,
} from '@/lib/local/store';
import { useLocalAccess } from './use-local-access';
export type Draft = Omit<SavedInterview, 'id' | 'updatedAt'>;
export function useInterviewLibrary(
  draft: Draft,
  restore: (session: SavedInterview) => Promise<void>,
  clear: () => void,
) {
  const access = useLocalAccess();
  const [id, setId] = useState('');
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [sessions, setSessions] = useState<SavedInterview[]>([]);
  const [audio, setAudio] = useState<AudioRecord[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [storage, setStorage] = useState({
    usage: 0,
    quota: 0,
    persistent: false,
  });
  const callbacks = useRef({ draft, restore, clear });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef(Promise.resolve());
  const signature = JSON.stringify(draft);
  useEffect(() => {
    callbacks.current = { draft, restore, clear };
  });
  async function refresh() {
    const store = localStore();
    const [rows, audios, prefs, estimate, persistent] = await Promise.all([
      store.listInterviews(),
      store.listAudio(),
      store.listPreferences(),
      navigator.storage?.estimate().catch(() => ({ usage: 0, quota: 0 })),
      navigator.storage?.persisted().catch(() => false),
    ]);
    setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt));
    setAudio(audios);
    setPreferences(prefs);
    setStorage({
      usage: estimate?.usage || 0,
      quota: estimate?.quota || 0,
      persistent: !!persistent,
    });
  }
  useEffect(() => {
    if (access !== 'ready') return;
    let disposed = false;
    void (async () => {
      try {
        const rows = await localStore().listInterviews();
        if (disposed) return;
        const latest = rows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) {
          await callbacks.current.restore(latest);
          if (disposed) return;
          setId(latest.id);
        } else setId(crypto.randomUUID());
        await refresh();
        if (!disposed) setReady(true);
      } catch {
        if (!disposed)
          setError('无法读取本地记录，请确认 Chrome 允许此站点存储后刷新。');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [access]);
  function write(currentId: string, value: Draft) {
    const stamp = JSON.stringify(value);
    const next = writes.current
      .catch(() => {})
      .then(() =>
        localStore().saveInterview({
          ...value,
          id: currentId,
          updatedAt: Date.now(),
        }),
      );
    writes.current = next;
    return next
      .then(() => {
        setSaved(currentId + stamp);
        setError('');
      })
      .catch((e: unknown) => {
        setError('本地保存失败，可能空间不足。请立即导出记录并下载录音。');
        throw e;
      });
  }
  useEffect(() => {
    if (!ready || !id) return;
    timer.current = setTimeout(() => {
      void write(id, callbacks.current.draft).catch(() => {});
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [ready, id, signature]);
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (!ready || !id) throw new Error('本地存储尚未就绪');
    await write(id, callbacks.current.draft);
  }
  async function open(nextId: string) {
    setWorking(true);
    try {
      await flush();
      const row = await localStore().getInterview(nextId);
      if (!row) throw new Error('记录已不存在');
      setReady(false);
      await callbacks.current.restore(row);
      setId(nextId);
      setSaved(
        nextId +
          JSON.stringify({ ...row, id: undefined, updatedAt: undefined }),
      );
      setReady(true);
    } finally {
      setReady(true);
      setWorking(false);
    }
  }
  async function create() {
    setWorking(true);
    try {
      await flush();
      setReady(false);
      callbacks.current.clear();
      setId(crypto.randomUUID());
      setSaved('');
      setReady(true);
      await refresh();
    } finally {
      setWorking(false);
    }
  }
  async function remove(target: string) {
    setWorking(true);
    try {
      if (target === id) {
        setReady(false);
        if (timer.current) clearTimeout(timer.current);
      }
      await writes.current.catch(() => {});
      await localStore().deleteInterview(target);
      if (target === id) {
        setReady(false);
        callbacks.current.clear();
        setId(crypto.randomUUID());
        setSaved('');
        setReady(true);
      }
      await refresh();
    } finally {
      setReady(true);
      setWorking(false);
    }
  }
  async function savePreference(value: Preference) {
    await localStore().savePreference(value);
    await refresh();
  }
  async function removePreference(target: string) {
    await localStore().deletePreference(target);
    await refresh();
  }
  async function persist() {
    await navigator.storage.persist();
    await refresh();
  }
  return {
    access,
    id,
    ready,
    working,
    error,
    sessions,
    audio,
    preferences,
    storage,
    unsaved: saved !== id + signature,
    flush,
    open,
    create,
    remove,
    savePreference,
    removePreference,
    persist,
    refresh,
  };
}
