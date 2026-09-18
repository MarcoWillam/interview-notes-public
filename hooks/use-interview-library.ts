'use client';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import {
  localStore,
  type SavedInterview,
  type AudioRecord,
  type InterviewGroup,
  type NewInterviewSeed,
  type Preference,
  type InterviewConflict,
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
  type InterviewWorkspace,
} from '@/lib/interview-sync';
import { mergeFollowUpRefresh } from '@/lib/interview-follow-up-refresh';
import {
  interviewDraft,
  reconcileInterviewDraft,
  sameInterviewDraft,
  type InterviewDraft,
} from '@/lib/interview-draft-merge';
export type Draft = Omit<SavedInterview, 'id' | 'createdAt' | 'updatedAt'>;
type FollowUpFields = Pick<
  Draft,
  'outlineSupplements' | 'followUpOutlineJobId'
>;
export function useInterviewLibrary(
  draft: Draft,
  restore: (session: SavedInterview) => Promise<void>,
  clear: (seed: NewInterviewSeed) => void,
  options: {
    cloud: boolean;
  } = { cloud: false },
) {
  const access = useLocalAccess();
  const [id, setId] = useState('');
  const activeId = useRef('');
  function selectId(nextId: string) {
    activeId.current = nextId;
    setId(nextId);
  }
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [syncStatus, setSyncStatus] = useState<
    'local' | 'syncing' | 'synced' | 'pending' | 'conflict'
  >(options.cloud ? 'syncing' : 'local');
  const [syncError, setSyncError] = useState('');
  const [conflictCount, setConflictCount] = useState(0);
  const [conflicts, setConflicts] = useState<InterviewConflict[]>([]);
  const [sessions, setSessions] = useState<SavedInterview[]>([]);
  const [groups, setGroups] = useState<InterviewGroup[]>([]);
  const [workspacePreferences, setWorkspacePreferences] = useState<Pick<
    InterviewWorkspace,
    'sortMode' | 'manualOrder' | 'collapsedGroupIds'
  > | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
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
  const callbacks = useRef({
    draft,
    restore,
    clear,
  });
  // Background synchronization may advance IndexedDB without changing the page.
  // Keep the last snapshot this page actually restored or persisted as its base.
  const visibleDraftBase = useRef(new Map<string, SavedInterview>());
  const followUpFields = useRef(
    new Map<
      string,
      { epoch: number; fields: FollowUpFields; draft: Draft; upload: boolean }
    >(),
  );
  const createdAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef(Promise.resolve());
  const syncs = useRef(Promise.resolve());
  const transport = useRef(createInterviewSyncTransport());
  const workspaceRef = useRef<InterviewWorkspace>({
    groups: [],
    sortMode: 'newest',
    manualOrder: [],
    collapsedGroupIds: [],
  });
  const workspaceDirty = useRef(false);
  const signature = JSON.stringify(draft);
  const synchronize = useCallback(async () => {
    if (!options.cloud) return;
    setSyncStatus('syncing');
    const next = syncs.current
      .catch(() => {})
      .then(async () => {
        const store = localStore();
        await migrateAndSyncInterviews(store, transport.current);
        const remoteWorkspace = await transport.current.workspace();
        const localGroups = await store.listInterviewGroups();
        if (workspaceDirty.current) {
          const localWorkspace = {
            ...workspaceRef.current,
            groups: workspaceRef.current.groups,
          };
          const resolvedWorkspace = await transport.current.putWorkspace(
            localWorkspace,
            remoteWorkspace.revision,
            crypto.randomUUID(),
          );
          workspaceDirty.current = false;
          workspaceRef.current = {
            groups: resolvedWorkspace.groups,
            sortMode: resolvedWorkspace.sortMode,
            manualOrder: resolvedWorkspace.manualOrder,
            collapsedGroupIds: resolvedWorkspace.collapsedGroupIds,
          };
          setGroups(resolvedWorkspace.groups);
          setWorkspacePreferences({
            sortMode: resolvedWorkspace.sortMode,
            manualOrder: resolvedWorkspace.manualOrder,
            collapsedGroupIds: resolvedWorkspace.collapsedGroupIds,
          });
        } else if (remoteWorkspace.revision > 0) {
          await store.replaceInterviewGroups(remoteWorkspace.groups);
          workspaceRef.current = {
            groups: remoteWorkspace.groups,
            sortMode: remoteWorkspace.sortMode,
            manualOrder: remoteWorkspace.manualOrder,
            collapsedGroupIds: remoteWorkspace.collapsedGroupIds,
          };
          setGroups(remoteWorkspace.groups);
          setWorkspacePreferences({
            sortMode: remoteWorkspace.sortMode,
            manualOrder: remoteWorkspace.manualOrder,
            collapsedGroupIds: remoteWorkspace.collapsedGroupIds,
          });
        } else {
          workspaceRef.current = {
            ...workspaceRef.current,
            groups: localGroups,
          };
          setGroups(localGroups);
        }
        setWorkspaceReady(true);
        const [pending, conflicts, rows] = await Promise.all([
          store.listPendingSync(),
          store.listInterviewConflicts(),
          store.listInterviews(),
        ]);
        setSessions(rows.sort((a, b) => b.updatedAt - a.updatedAt));
        setConflictCount(conflicts.length);
        setConflicts(conflicts);
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
    callbacks.current = {
      draft,
      restore,
      clear,
    };
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
          visibleDraftBase.current.set(latest.id, latest);
          await callbacks.current.restore(await normalizeSession(latest));
          if (disposed) return;
          selectId(latest.id);
        } else {
          const seed = await localStore().getNewInterviewSeed();
          if (disposed) return;
          createdAt.current = Date.now();
          callbacks.current.clear(seed);
          selectId(crypto.randomUUID());
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
    let stamp = JSON.stringify(value);
    const fieldEpoch = followUpFields.current.get(currentId)?.epoch || 0;
    const updatedAt = Date.now();
    createdAt.current ??= updatedAt;
    let saved: SavedInterview = {
      ...value,
      id: currentId,
      createdAt: createdAt.current,
      updatedAt,
    };
    const next = writes.current
      .catch(() => {})
      .then(async () => {
        const refreshed = followUpFields.current.get(currentId);
        if (refreshed && refreshed.epoch !== fieldEpoch) {
          const latest =
            currentId === activeId.current
              ? callbacks.current.draft
              : refreshed.draft;
          const reconciled = { ...latest, ...refreshed.fields };
          saved = {
            ...reconciled,
            id: currentId,
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
          };
          stamp = JSON.stringify(reconciled);
          if (!refreshed.upload && stamp === JSON.stringify(refreshed.draft))
            return saved;
        }
        const store = localStore();
        const previous = await store.getInterview(currentId);
        const persisted = await store.saveInterviewDraft(saved);
        saved = persisted;
        visibleDraftBase.current.set(currentId, persisted);
        if (options.cloud) {
          await store.queueInterviewSync(
            persisted,
            cloudVersionReason(previous, persisted),
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
  const writeEvent = useEffectEvent(write);
  useEffect(() => {
    if (!ready || !id) return;
    timer.current = setTimeout(() => {
      void writeEvent(id, callbacks.current.draft).catch(() => {});
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
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
  async function flush(overrides?: Partial<Draft>) {
    if (timer.current) clearTimeout(timer.current);
    if (!ready || !id || activeId.current !== id)
      throw new Error('本地存储尚未就绪');
    const value = { ...callbacks.current.draft, ...overrides };
    await write(id, value);
    if (overrides && activeId.current === id)
      callbacks.current.draft = { ...callbacks.current.draft, ...overrides };
  }
  async function flushForTask(overrides?: Partial<Draft>) {
    await flush(overrides);
    if (!options.cloud) return undefined;
    await synchronize();
    const meta = await localStore().getSyncMeta(id);
    if (!meta) throw new Error('面试记录尚未同步到云端，请稍后重试。');
    return { interviewId: id, interviewRevision: meta.revision };
  }
  async function flushDirtyForNavigation() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const currentId = activeId.current;
    if (!ready || !currentId) throw new Error('本地存储尚未就绪');
    let conflictId: string | undefined;
    while (activeId.current === currentId) {
      const queuedWrites = writes.current;
      await queuedWrites.catch(() => {});
      if (writes.current !== queuedWrites) continue;

      const visibleBase = visibleDraftBase.current.get(currentId);
      const commonBase: InterviewDraft | undefined =
        visibleBase?.id === currentId ? interviewDraft(visibleBase) : undefined;
      const value = structuredClone(callbacks.current.draft);
      const stamp = value;
      const persisted = await localStore().getInterview(currentId);
      if (
        activeId.current !== currentId ||
        writes.current !== queuedWrites ||
        !sameInterviewDraft(callbacks.current.draft, stamp)
      )
        continue;
      if (!persisted) {
        if (commonBase)
          throw new Error('当前面试记录已在其他页面删除，请刷新后重试。');
        await write(currentId, value);
      } else {
        const result = reconcileInterviewDraft(
          commonBase,
          value,
          interviewDraft(persisted),
        );
        if (result.kind === 'clean') return;
        if (result.kind === 'conflict') {
          conflictId ||= crypto.randomUUID();
          const local: SavedInterview = {
            ...(visibleBase || persisted),
            ...value,
            id: currentId,
            createdAt:
              visibleBase?.createdAt ??
              persisted.createdAt ??
              createdAt.current ??
              Date.now(),
            updatedAt: Date.now(),
          };
          const store = localStore();
          const pending = (await store.listPendingSync()).find(
            (item) => item.id === currentId,
          );
          if (
            activeId.current !== currentId ||
            writes.current !== queuedWrites ||
            !sameInterviewDraft(callbacks.current.draft, stamp)
          )
            continue;
          await store.saveInterviewConflictAndDropPending(
            local,
            persisted,
            conflictId,
            pending,
          );
          if (activeId.current !== currentId) break;
          if (
            writes.current !== queuedWrites ||
            !sameInterviewDraft(callbacks.current.draft, stamp)
          )
            continue;
          const nextConflicts = await store.listInterviewConflicts();
          if (activeId.current !== currentId) break;
          setConflicts(nextConflicts);
          setConflictCount(nextConflicts.length);
          setSyncStatus('conflict');
          setError(
            '面试资料存在同时编辑的冲突，双方版本均已保留，请在记录管理中处理。',
          );
          return;
        }
        await write(currentId, result.draft);
        if (activeId.current !== currentId) break;
        // The page still displays `value` until navigation completes. Keep that
        // visible snapshot as the next common base if input arrives meanwhile.
        visibleDraftBase.current.set(currentId, {
          ...persisted,
          ...value,
          id: currentId,
          updatedAt: Date.now(),
        });
      }
      if (activeId.current !== currentId) break;
      if (sameInterviewDraft(callbacks.current.draft, stamp)) return;
    }
    throw new Error('面试记录已切换，请重试。');
  }
  async function refreshFollowUpFromCloud(interviewId = id) {
    if (!options.cloud) return;
    const previousSyncs = syncs.current;
    // Reserve both queues before the GET. Autosaves can keep accepting input,
    // but neither a stale write nor an outbox upload may pass this reconciliation.
    const next = writes.current
      .catch(() => {})
      .then(async () => {
        await previousSyncs;
        const store = localStore();
        const persisted = await store.getInterview(interviewId);
        if (!persisted) return;
        const base = visibleDraftBase.current.get(interviewId) || persisted;
        const pending = (await store.listPendingSync()).find(
          (item) => item.id === interviewId,
        );
        const unresolvedConflict = (await store.listInterviewConflicts()).some(
          (item) => item.interviewId === interviewId,
        );
        const startingDraft =
          interviewId === activeId.current
            ? callbacks.current.draft
            : interviewDraft(base);
        const value = await transport.current.get(interviewId);
        if (value.deletedAt != null) return;
        const fields: FollowUpFields = {
          outlineSupplements: value.record.outlineSupplements,
          followUpOutlineJobId: value.record.followUpOutlineJobId,
        };
        const conflictId = crypto.randomUUID();
        // Persistence is asynchronous. If the user types during it, compare that
        // newer draft against the same common base before publishing any state.
        while (true) {
          const latest =
            interviewId === activeId.current
              ? callbacks.current.draft
              : startingDraft;
          const stamp = JSON.stringify(latest);
          const result = mergeFollowUpRefresh(
            base,
            latest,
            value.record,
            !!pending || unresolvedConflict,
          );
          const merged: SavedInterview = {
            ...value.record,
            ...result.draft,
            updatedAt: result.upload ? Date.now() : value.record.updatedAt,
          };
          await store.saveFollowUpRefresh(merged, value.revision, {
            upload: result.upload,
            reason: cloudVersionReason(base, merged),
            conflictId,
            conflict: result.conflict
              ? {
                  id: conflictId,
                  interviewId,
                  local: {
                    ...base,
                    ...latest,
                    ...fields,
                    updatedAt: Date.now(),
                  },
                  remote: value.record,
                  createdAt: Date.now(),
                }
              : undefined,
          });
          const conflicts = await store.listInterviewConflicts();
          if (
            interviewId === activeId.current &&
            JSON.stringify(callbacks.current.draft) !== stamp
          )
            continue;
          visibleDraftBase.current.set(interviewId, merged);
          followUpFields.current.set(interviewId, {
            epoch: (followUpFields.current.get(interviewId)?.epoch || 0) + 1,
            fields,
            draft: result.draft,
            upload: result.upload,
          });
          if (interviewId === activeId.current) {
            callbacks.current.draft = result.draft;
            await callbacks.current.restore(merged);
          }
          setSessions((rows) => updateInterviewSummary(rows, merged));
          setConflicts(conflicts);
          setConflictCount(conflicts.length);
          setSyncStatus(
            conflicts.length
              ? 'conflict'
              : result.upload
                ? 'pending'
                : 'synced',
          );
          if (result.conflict && interviewId === activeId.current)
            setError(
              '面试资料存在同时编辑的冲突，双方版本均已保留，请在记录管理中处理。',
            );
          break;
        }
      });
    writes.current = next.catch(() => {});
    syncs.current = next.catch(() => {});
    await next;
    void synchronize().catch(() => {});
  }
  async function refreshFromCloud(interviewId = id) {
    if (!options.cloud) return;
    if (interviewId === activeId.current) {
      if (timer.current) clearTimeout(timer.current);
    }
    try {
      // Finish accepted local changes before replacing their cloud snapshot.
      await writes.current.catch(() => {});
      await syncs.current;
      const value = await transport.current.get(interviewId);
      await localStore().saveRemoteInterview(value.record, value.revision);
      const normalized = await normalizeSession(value.record);
      if (interviewId === activeId.current) {
        setReady(false);
        if (timer.current) clearTimeout(timer.current);
        createdAt.current = value.record.createdAt ?? value.record.updatedAt;
        visibleDraftBase.current.set(interviewId, value.record);
        await callbacks.current.restore(normalized);
      }
      await refresh();
      setSyncStatus('synced');
    } finally {
      if (interviewId === activeId.current) setReady(true);
    }
  }
  async function openRecord(nextId: string, latest: boolean) {
    setWorking(true);
    try {
      await flushDirtyForNavigation();
      if (latest && options.cloud) await synchronize();
      const row = await localStore().getInterview(nextId);
      if (!row) throw new Error('记录已不存在');
      setReady(false);
      createdAt.current = row.createdAt ?? row.updatedAt;
      const restored = await normalizeSession(row);
      selectId(nextId);
      visibleDraftBase.current.set(nextId, row);
      await callbacks.current.restore(restored);
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
  async function open(nextId: string) {
    await openRecord(nextId, false);
  }
  async function openLatest(nextId: string) {
    await openRecord(nextId, true);
  }
  async function create(override?: NewInterviewSeed) {
    setWorking(true);
    try {
      await flush();
      const seed = override || (await localStore().getNewInterviewSeed());
      setReady(false);
      createdAt.current = Date.now();
      callbacks.current.clear(seed);
      selectId(crypto.randomUUID());
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
        if (meta) await synchronize();
      }
      await localStore().deleteInterview(target);
      if (target === id) {
        setReady(false);
        createdAt.current = Date.now();
        callbacks.current.clear(seed!);
        selectId(crypto.randomUUID());
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
      workspaceRef.current = {
        ...workspaceRef.current,
        groups: [...current, saved],
      };
      workspaceDirty.current = true;
      if (options.cloud) void synchronize().catch(() => {});
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
      workspaceRef.current = {
        ...workspaceRef.current,
        groups: current.map((item) => (item.id === saved.id ? saved : item)),
      };
      workspaceDirty.current = true;
      if (options.cloud) void synchronize().catch(() => {});
      return saved;
    } finally {
      setWorking(false);
    }
  }
  async function deleteGroup(id: string) {
    setWorking(true);
    try {
      await writes.current.catch(() => {});
      const store = localStore();
      const affected = sessions.filter((session) => session.groupId === id);
      await store.deleteInterviewGroup(id);
      if (options.cloud) {
        for (const session of affected) {
          const updated = await store.getInterview(session.id);
          if (updated) await store.queueInterviewSync(updated, 'periodic-edit');
        }
      }
      setGroups((current) => current.filter((group) => group.id !== id));
      setSessions((current) =>
        current.map((session) =>
          session.groupId === id ? { ...session, groupId: null } : session,
        ),
      );
      workspaceRef.current = {
        ...workspaceRef.current,
        groups: workspaceRef.current.groups.filter((group) => group.id !== id),
        collapsedGroupIds: workspaceRef.current.collapsedGroupIds.filter(
          (groupId) => groupId !== id,
        ),
      };
      workspaceDirty.current = true;
      if (options.cloud) void synchronize().catch(() => {});
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
        if (moved)
          await localStore().queueInterviewSync(moved, 'periodic-edit');
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
  function updateWorkspacePreferences(
    value: Pick<
      InterviewWorkspace,
      'sortMode' | 'manualOrder' | 'collapsedGroupIds'
    >,
  ) {
    setWorkspacePreferences(value);
    workspaceRef.current = { ...workspaceRef.current, ...value };
    workspaceDirty.current = true;
    if (options.cloud) void synchronize().catch(() => {});
  }
  async function loadVersions(interviewId = id) {
    if (!options.cloud) return [];
    return transport.current.versions(interviewId);
  }
  async function loadVersion(interviewId: string, revision: number) {
    if (!options.cloud) throw new Error('本地预览没有云端版本历史。');
    return transport.current.version(interviewId, revision);
  }
  async function loadTrash() {
    if (!options.cloud) return [];
    return transport.current.list(true);
  }
  async function restoreVersion(interviewId: string, revision: number) {
    const store = localStore();
    const meta = await store.getSyncMeta(interviewId);
    if (!meta) throw new Error('这份记录尚未同步，暂时不能恢复历史版本。');
    const result = await transport.current.restoreVersion(
      interviewId,
      revision,
      meta.revision,
      crypto.randomUUID(),
    );
    await store.saveRemoteInterview(result.record, result.revision);
    if (interviewId === id) {
      setReady(false);
      createdAt.current = result.record.createdAt ?? result.record.updatedAt;
      visibleDraftBase.current.set(interviewId, result.record);
      await callbacks.current.restore(await normalizeSession(result.record));
      setReady(true);
    }
    await refresh();
    setSyncStatus('synced');
  }
  async function restoreDeleted(interviewId: string, revision: number) {
    if (!options.cloud) throw new Error('本地预览没有云端回收站。');
    const result = await transport.current.restoreDeleted(
      interviewId,
      revision,
      crypto.randomUUID(),
    );
    await localStore().saveRemoteInterview(result.record, result.revision);
    await refresh();
    setSyncStatus('synced');
  }
  async function resolveConflict(
    conflictId: string,
    action: 'keep-cloud' | 'duplicate-local' | 'replace-cloud',
  ) {
    const conflict = conflicts.find((item) => item.id === conflictId);
    if (!conflict) throw new Error('冲突副本已处理，请刷新后重试。');
    const store = localStore();
    if (action === 'duplicate-local') {
      const stamp = Date.now();
      const duplicate = {
        ...conflict.local,
        id: crypto.randomUUID(),
        candidate: `${conflict.local.candidate || '未命名面试'}（冲突副本）`,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await store.saveInterviewDraft(duplicate);
      await store.queueInterviewSync(duplicate, 'periodic-edit');
    } else if (action === 'replace-cloud') {
      const current = await transport.current.get(conflict.interviewId);
      const record = { ...conflict.local, updatedAt: Date.now() };
      const result = await transport.current.put(
        conflict.interviewId,
        current.revision,
        crypto.randomUUID(),
        record,
        'periodic-edit',
      );
      await store.saveRemoteInterview(result.record, result.revision);
    }
    await store.deleteInterviewConflict(conflictId);
    await synchronize().catch(() => {});
  }
  async function loadPendingResults(interviewId = id) {
    if (!options.cloud) return [];
    return transport.current.pendingResults(interviewId);
  }
  async function applyPendingResult(interviewId: string, jobId: string) {
    const meta = await localStore().getSyncMeta(interviewId);
    if (!meta) throw new Error('请先同步当前面试记录。');
    const result = await transport.current.applyPendingResult(
      interviewId,
      jobId,
      meta.revision,
      crypto.randomUUID(),
    );
    await localStore().saveRemoteInterview(result.record, result.revision);
    if (interviewId === id) {
      visibleDraftBase.current.set(interviewId, result.record);
      await callbacks.current.restore(await normalizeSession(result.record));
    }
    await refresh();
  }
  async function discardPendingResult(interviewId: string, jobId: string) {
    await transport.current.discardPendingResult(interviewId, jobId);
  }
  return {
    access,
    id,
    ready,
    working,
    error,
    sessions,
    groups,
    workspacePreferences,
    workspaceReady,
    updateWorkspacePreferences,
    audio,
    preferences,
    globalSettings,
    saveGlobalPreferences,
    storage,
    unsaved: saved !== id + signature,
    syncStatus,
    syncError,
    conflictCount,
    conflicts,
    cloud: options.cloud,
    retrySync: synchronize,
    flush,
    flushForTask,
    refreshFromCloud,
    refreshFollowUpFromCloud,
    open,
    openLatest,
    create,
    remove,
    persist,
    refresh,
    createGroup,
    renameGroup,
    deleteGroup,
    moveToGroup,
    loadVersions,
    loadVersion,
    loadTrash,
    restoreVersion,
    restoreDeleted,
    resolveConflict,
    loadPendingResults,
    applyPendingResult,
    discardPendingResult,
  };
}
