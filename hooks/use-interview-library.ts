'use client';
import { useEffect, useRef, useState } from 'react';
import {
  localStore,
  type SavedInterview,
  type AudioRecord,
  type NewInterviewSeed,
  type Preference,
} from '@/lib/local/store';
import { useLocalAccess } from './use-local-access';
import {
  defaultStandards,
  normalizeStandards,
  type GlobalSettings,
} from '@/lib/standards';
import { normalizeInterviewTemplateState } from '@/lib/interview-template-state';
export type Draft = Omit<SavedInterview, 'id' | 'updatedAt'>;
export function useInterviewLibrary(
  draft: Draft,
  restore: (session: SavedInterview) => Promise<void>,
  clear: (seed: NewInterviewSeed) => void,
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
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    id: 'global',
    defaultTemplateId: null,
    defaults: { ...defaultStandards },
  });
  const [storage, setStorage] = useState({
    usage: 0,
    quota: 0,
    persistent: false,
  });
  const callbacks = useRef({ draft, restore, clear });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef(Promise.resolve());
  const signature = JSON.stringify(draft);
  async function normalizeSession(session: SavedInterview) {
    const store = localStore();
    const [templates, settings] = await Promise.all([
      store.listPreferences(),
      store.getSettings(),
    ]);
    return {
      ...session,
      ...normalizeInterviewTemplateState(
        normalizeStandards(session),
        session,
        templates,
        settings?.defaults || defaultStandards,
      ),
    };
  }
  useEffect(() => {
    callbacks.current = { draft, restore, clear };
  });
  async function refresh() {
    const store = localStore();
    const [rows, audios, prefs, estimate, persistent, settings] =
      await Promise.all([
        store.listInterviews(),
        store.listAudio(),
        store.listPreferences(),
        navigator.storage?.estimate().catch(() => ({ usage: 0, quota: 0 })),
        navigator.storage?.persisted().catch(() => false),
        store.getSettings(),
      ]);
    setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt));
    setAudio(audios);
    setPreferences(prefs);
    setGlobalSettings(
      settings || {
        id: 'global',
        defaultTemplateId: null,
        defaults: { ...defaultStandards },
      },
    );
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
          await callbacks.current.restore(await normalizeSession(latest));
          if (disposed) return;
          setId(latest.id);
        } else {
          const seed = await localStore().getNewInterviewSeed();
          if (disposed) return;
          callbacks.current.clear(seed);
          setId(crypto.randomUUID());
        }
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
        setError('本地保存失败，可能空间不足。请立即导出记录备份。');
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
      const restored = await normalizeSession(row);
      await callbacks.current.restore(restored);
      setId(nextId);
      setSaved(
        nextId +
          JSON.stringify({ ...restored, id: undefined, updatedAt: undefined }),
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
      const seed = await localStore().getNewInterviewSeed();
      setReady(false);
      callbacks.current.clear(seed);
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
      const seed =
        target === id ? await localStore().getNewInterviewSeed() : null;
      if (target === id) {
        setReady(false);
        if (timer.current) clearTimeout(timer.current);
      }
      await writes.current.catch(() => {});
      await localStore().deleteInterview(target);
      if (target === id) {
        setReady(false);
        callbacks.current.clear(seed!);
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
  async function saveGlobalPreferences(
    settings: GlobalSettings,
    templates: Preference[],
  ) {
    const saved = await localStore().savePreferencesConfig(settings, templates);
    setGlobalSettings(saved.settings);
    setPreferences(saved.templates);
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
    globalSettings,
    saveGlobalPreferences,
    storage,
    unsaved: saved !== id + signature,
    flush,
    open,
    create,
    remove,
    persist,
    refresh,
  };
}
