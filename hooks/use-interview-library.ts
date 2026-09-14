'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  localStore,
  type SavedInterview,
  type AudioRecord,
  type InterviewGroup,
  type NewInterviewSeed,
  type Preference,
} from '@/lib/local/store';
import { useLocalAccess } from './use-local-access';
import {
  defaultStandards,
  normalizeStandards,
  type GlobalSettings,
} from '@/lib/standards';
import {
  normalizeInterviewTemplateState,
  normalizeOutlineVersion,
} from '@/lib/interview-template-state';
import { BUILTIN_TEMPLATE_IDS } from '@/lib/default-role-templates';
import { updateInterviewSummary } from '@/lib/interview-sidebar';
import {
  cloudVersionReason,
  createInterviewSyncTransport,
  migrateAndSyncInterviews,
} from '@/lib/interview-sync';
export type Draft = Omit<SavedInterview, 'id' | 'createdAt' | 'updatedAt'>;
export function useInterviewLibrary(
  draft: Draft,
  restore: (session: SavedInterview) => Promise<void>,
  clear: (seed: NewInterviewSeed) => void,
  options: { cloud: boolean } = { cloud: false },
) {
  const access = useLocalAccess();
  const [id, setId] = useState('');
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [syncStatus, setSyncStatus] = useState<
    'local' | 'syncing' | 'synced' | 'pending' | 'conflict'
  >(options.cloud ? 'syncing' : 'local');
  const [syncError, setSyncError] = useState('');
  const [conflictCount, setConflictCount] = useState(0);
  const [sessions, setSessions] = useState<SavedInterview[]>([]);
  const [groups, setGroups] = useState<InterviewGroup[]>([]);
  const [audio, setAudio] = useState<AudioRecord[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({
    id: 'global',
    defaultTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
    defaults: { ...defaultStandards },
  });
  const [storage, setStorage] = useState({
    usage: 0,
    quota: 0,
    persistent: false,
  });
  const callbacks = useRef({ draft, restore, clear });
  const createdAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef(Promise.resolve());
  const syncs = useRef(Promise.resolve());
  const transport = useRef(createInterviewSyncTransport());
  const signature = JSON.stringify(draft);
  const synchronize = useCallback(async () => {
    if (!options.cloud) return;
    setSyncStatus('syncing');
    const next = syncs.current
      .catch(() => {})
      .then(async () => {
        const store = localStore();
        await migrateAndSyncInterviews(store, transport.current);
        const [pending, conflicts, rows] = await Promise.all([
          store.listPendingSync(),
          store.listInterviewConflicts(),
          store.listInterviews(),
        ]);
        setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt));
        setConflictCount(conflicts.length);
        setSyncStatus(
          conflicts.length ? 'conflict' : pending.length ? 'pending' : 'synced',
        );
        setSyncError('');
      })
      .catch((reason: unknown) => {
        setSyncStatus('pending');
        setSyncError(
          reason instanceof Error
            ? reason.message
            : '暂时无法同步云端，已保存在当前浏览器。',
        );
        throw reason;
      });
    syncs.current = next.catch(() => {});
    return next;
  }, [options.cloud]);
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
      outlineVersion: normalizeOutlineVersion(session),
    };
  }
  useEffect(() => {
    callbacks.current = { draft, restore, clear };
  });
  async function refresh() {
    const store = localStore();
    const [rows, groupRows, audios, prefs, estimate, persistent, settings] =
      await Promise.all([
        store.listInterviews(),
        store.listInterviewGroups(),
        store.listAudio(),
        store.listPreferences(),
        navigator.storage?.estimate().catch(() => ({ usage: 0, quota: 0 })),
        navigator.storage?.persisted().catch(() => false),
        store.getSettings(),
      ]);
    setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt));
    setGroups(groupRows);
    setAudio(audios);
    setPreferences(prefs);
    setGlobalSettings(
      settings || {
        id: 'global',
        defaultTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
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
        if (options.cloud) await synchronize().catch(() => {});
        const rows = await localStore().listInterviews();
        if (disposed) return;
        const latest = rows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (latest) {
          createdAt.current = latest.createdAt ?? latest.updatedAt;
          await callbacks.current.restore(await normalizeSession(latest));
          if (disposed) return;
          setId(latest.id);
        } else {
          const seed = await localStore().getNewInterviewSeed();
          if (disposed) return;
          createdAt.current = Date.now();
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
  }, [access, options.cloud, synchronize]);
  function write(currentId: string, value: Draft) {
    const stamp = JSON.stringify(value);
    const updatedAt = Date.now();
    createdAt.current ??= updatedAt;
    const saved = {
      ...value,
      id: currentId,
      createdAt: createdAt.current,
      updatedAt,
    };
    const next = writes.current
      .catch(() => {})
      .then(async () => {
        const store = localStore();
        const previous = await store.getInterview(currentId);
        await store.saveInterviewDraft(saved);
        if (options.cloud) {
          await store.queueInterviewSync(
            saved,
            cloudVersionReason(previous, saved),
          );
          setSyncStatus('pending');
          void synchronize().catch(() => {});
        }
        return saved;
      });
    writes.current = next.then(() => {});
    return next
      .then((saved) => {
        setSessions((rows) => updateInterviewSummary(rows, saved));
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
  useEffect(() => {
    if (!options.cloud) return;
    const retry = () => void synchronize().catch(() => {});
    const visible = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [options.cloud, synchronize]);
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
      createdAt.current = row.createdAt ?? row.updatedAt;
      const restored = await normalizeSession(row);
      await callbacks.current.restore(restored);
      setId(nextId);
      setSaved(
        nextId +
          JSON.stringify({
            ...restored,
            id: undefined,
            createdAt: undefined,
            updatedAt: undefined,
          }),
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
      createdAt.current = Date.now();
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
      const store = localStore();
      const targetRecord = await store.getInterview(target);
      if (options.cloud && targetRecord) {
        const meta = await store.getSyncMeta(target);
        if (meta) await store.queueInterviewDelete(targetRecord);
        else await store.dropPendingSync(target);
        setSyncStatus('pending');
      }
      await localStore().deleteInterview(target);
      if (target === id) {
        setReady(false);
        createdAt.current = Date.now();
        callbacks.current.clear(seed!);
        setId(crypto.randomUUID());
        setSaved('');
        setReady(true);
      }
      await refresh();
      if (options.cloud) void synchronize().catch(() => {});
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
  async function createGroup(name: string) {
    setWorking(true);
    try {
      const store = localStore();
      const current = await store.listInterviewGroups();
      const nextOrder = current.reduce(
        (maximum, group) => Math.max(maximum, group.order + 1),
        0,
      );
      const saved = await store.saveInterviewGroup({
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        order: nextOrder,
      });
      setGroups([...current, saved]);
      return saved;
    } finally {
      setWorking(false);
    }
  }
  async function renameGroup(id: string, name: string) {
    setWorking(true);
    try {
      const current = await localStore().listInterviewGroups();
      const group = current.find((item) => item.id === id);
      if (!group) throw new Error('分组已不存在，请刷新后重试');
      const saved = await localStore().saveInterviewGroup({ ...group, name });
      setGroups(current.map((item) => (item.id === saved.id ? saved : item)));
      return saved;
    } finally {
      setWorking(false);
    }
  }
  async function deleteGroup(id: string) {
    setWorking(true);
    try {
      await writes.current.catch(() => {});
      await localStore().deleteInterviewGroup(id);
      setGroups((current) => current.filter((group) => group.id !== id));
      setSessions((current) =>
        current.map((session) =>
          session.groupId === id ? { ...session, groupId: null } : session,
        ),
      );
    } finally {
      setWorking(false);
    }
  }
  async function moveToGroup(interviewId: string, groupId: string | null) {
    setWorking(true);
    try {
      await flush();
      await localStore().moveInterviewToGroup(interviewId, groupId);
      if (options.cloud) {
        const moved = await localStore().getInterview(interviewId);
        if (moved) await localStore().queueInterviewSync(moved, 'periodic-edit');
        setSyncStatus('pending');
        void synchronize().catch(() => {});
      }
      setSessions((current) =>
        current.map((session) =>
          session.id === interviewId ? { ...session, groupId } : session,
        ),
      );
    } finally {
      setWorking(false);
    }
  }
  return {
    access,
    id,
    ready,
    working,
    error,
    sessions,
    groups,
    audio,
    preferences,
    globalSettings,
    saveGlobalPreferences,
    storage,
    unsaved: saved !== id + signature,
    syncStatus,
    syncError,
    conflictCount,
    retrySync: synchronize,
    flush,
    open,
    create,
    remove,
    persist,
    refresh,
    createGroup,
    renameGroup,
    deleteGroup,
    moveToGroup,
  };
}
