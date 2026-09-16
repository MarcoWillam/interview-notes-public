import type {
  CloudInterview,
  CloudInterviewSummary,
  CloudVersionReason,
} from './cloud-interview.ts';
import type { LocalStore } from './local/store.ts';
import { RemoteError, remoteRequest } from './remote-analysis.ts';

export type SyncedInterview = {
  record: CloudInterview;
  revision: number;
  deletedAt: number | null;
};

export type InterviewVersionSummary = {
  revision: number;
  reason: CloudVersionReason;
  createdAt: number;
};

export type InterviewVersion = InterviewVersionSummary & {
  record: CloudInterview;
};

export type PendingInterviewResult = {
  jobId: string;
  kind: string;
  baseRevision: number;
  result: unknown;
  state: 'pending' | 'applied' | 'discarded';
  createdAt: number;
  updatedAt: number;
};

export type InterviewWorkspace = {
  groups: Array<{ id: string; name: string; createdAt: number; order: number }>;
  sortMode: 'newest' | 'oldest' | 'manual';
  manualOrder: string[];
  collapsedGroupIds: string[];
};

export type SyncedInterviewWorkspace = InterviewWorkspace & { revision: number };

export type InterviewSyncTransport = {
  list: (trash?: boolean) => Promise<CloudInterviewSummary[]>;
  get: (id: string) => Promise<SyncedInterview>;
  put: (
    id: string,
    baseRevision: number,
    mutationId: string,
    record: CloudInterview,
    reason: CloudVersionReason,
  ) => Promise<SyncedInterview>;
  remove: (
    id: string,
    baseRevision: number,
    mutationId: string,
  ) => Promise<SyncedInterview>;
};

export type InterviewManagementTransport = InterviewSyncTransport & {
  versions: (id: string) => Promise<InterviewVersionSummary[]>;
  version: (id: string, revision: number) => Promise<InterviewVersion>;
  restoreVersion: (
    id: string,
    revision: number,
    baseRevision: number,
    mutationId: string,
  ) => Promise<SyncedInterview>;
  restoreDeleted: (
    id: string,
    baseRevision: number,
    mutationId: string,
  ) => Promise<SyncedInterview>;
  pendingResults: (id: string) => Promise<PendingInterviewResult[]>;
  applyPendingResult: (
    id: string,
    jobId: string,
    baseRevision: number,
    mutationId: string,
  ) => Promise<SyncedInterview>;
  discardPendingResult: (id: string, jobId: string) => Promise<void>;
  workspace: () => Promise<SyncedInterviewWorkspace>;
  putWorkspace: (
    workspace: InterviewWorkspace,
    baseRevision: number,
    mutationId: string,
  ) => Promise<SyncedInterviewWorkspace>;
};

export class InterviewSyncConflict extends Error {
  current: CloudInterviewSummary;
  constructor(current: CloudInterviewSummary) {
    super('面试记录已在其他页面更新。');
    this.current = current;
  }
}

export function cloudVersionReason(
  previous: CloudInterview | undefined,
  next: CloudInterview,
): CloudVersionReason {
  if (!previous) return 'periodic-edit';
  if (!previous.priorRoundText && next.priorRoundText)
    return 'second-round-material-imported';
  if (!previous.secondRoundOutline && next.secondRoundOutline)
    return 'second-round-outline-generated';
  if (
    previous.secondRoundOutline &&
    next.secondRoundOutline &&
    JSON.stringify(previous.secondRoundOutline) !== JSON.stringify(next.secondRoundOutline)
  )
    return 'second-round-outline-regenerated';
  if (
    !previous.priorRoundComparison?.length &&
    !!next.priorRoundComparison?.length
  )
    return 'second-round-assessment-generated';
  if (
    (previous.outlineSupplements?.length || 0) >
    (next.outlineSupplements?.length || 0)
  )
    return 'follow-up-outline-deleted';
  if (!previous.confirmed && next.confirmed) return 'manually-confirmed';
  if (!previous.report && next.report) return 'assessment-generated';
  if (
    previous.outlineRegeneratedAt !== next.outlineRegeneratedAt &&
    next.outlineRegeneratedAt !== undefined
  )
    return 'outline-regenerated';
  if (!previous.workSample && next.workSample) return 'work-sample-analyzed';
  if (
    !previous.hasWrittenTest &&
    next.hasWrittenTest &&
    previous.resumeReading &&
    next.resumeReading
  )
    return 'written-test-supplemented';
  if (!previous.resumeReading && next.resumeReading) return 'outline-generated';
  if (
    previous.transcript !== next.transcript &&
    previous.transcriptName !== next.transcriptName &&
    !!next.transcriptName
  )
    return 'transcript-imported';
  return 'periodic-edit';
}

function conflictFrom(error: unknown) {
  if (error instanceof InterviewSyncConflict) return error;
  if (error instanceof RemoteError && error.status === 409) {
    const payload = error.payload as { current?: CloudInterviewSummary } | null;
    if (payload?.current) return new InterviewSyncConflict(payload.current);
  }
  return null;
}

export function createInterviewSyncTransport(
  fetcher: typeof fetch = fetch,
): InterviewManagementTransport {
  return {
    async list(trash = false) {
      const response = await remoteRequest<{ interviews: CloudInterviewSummary[] }>(
        `/api/interviews${trash ? '?trash=1' : ''}`,
        {},
        fetcher,
      );
      return response.interviews;
    },
    get(id) {
      return remoteRequest<SyncedInterview>(
        `/api/interviews/${encodeURIComponent(id)}`,
        {},
        fetcher,
      );
    },
    put(id, baseRevision, mutationId, record, reason) {
      return remoteRequest<SyncedInterview>(
        `/api/interviews/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ baseRevision, mutationId, record, reason }),
        },
        fetcher,
      );
    },
    remove(id, baseRevision, mutationId) {
      return remoteRequest<SyncedInterview>(
        `/api/interviews/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ baseRevision, mutationId }),
        },
        fetcher,
      );
    },
    async versions(id) {
      const response = await remoteRequest<{ versions: InterviewVersionSummary[] }>(
        `/api/interviews/${encodeURIComponent(id)}/versions`,
        {},
        fetcher,
      );
      return response.versions;
    },
    version(id, revision) {
      return remoteRequest<InterviewVersion>(
        `/api/interviews/${encodeURIComponent(id)}/versions/${revision}`,
        {},
        fetcher,
      );
    },
    restoreVersion(id, revision, baseRevision, mutationId) {
      return remoteRequest<SyncedInterview>(
        `/api/interviews/${encodeURIComponent(id)}/versions/${revision}/restore`,
        {
          method: 'POST',
          body: JSON.stringify({ baseRevision, mutationId }),
        },
        fetcher,
      );
    },
    restoreDeleted(id, baseRevision, mutationId) {
      return remoteRequest<SyncedInterview>(
        `/api/interviews/${encodeURIComponent(id)}/restore`,
        {
          method: 'POST',
          body: JSON.stringify({ baseRevision, mutationId }),
        },
        fetcher,
      );
    },
    async pendingResults(id) {
      const response = await remoteRequest<{ results: PendingInterviewResult[] }>(
        `/api/interviews/${encodeURIComponent(id)}/pending-results`,
        {},
        fetcher,
      );
      return response.results;
    },
    applyPendingResult(id, jobId, baseRevision, mutationId) {
      return remoteRequest<SyncedInterview>(
        `/api/interviews/${encodeURIComponent(id)}/pending-results/${encodeURIComponent(jobId)}/apply`,
        {
          method: 'POST',
          body: JSON.stringify({ baseRevision, mutationId }),
        },
        fetcher,
      );
    },
    async discardPendingResult(id, jobId) {
      await remoteRequest(
        `/api/interviews/${encodeURIComponent(id)}/pending-results/${encodeURIComponent(jobId)}/discard`,
        { method: 'POST', body: '{}' },
        fetcher,
      );
    },
    workspace() {
      return remoteRequest<SyncedInterviewWorkspace>(
        '/api/interview-workspace',
        {},
        fetcher,
      );
    },
    putWorkspace(workspace, baseRevision, mutationId) {
      return remoteRequest<SyncedInterviewWorkspace>(
        '/api/interview-workspace',
        {
          method: 'PUT',
          body: JSON.stringify({ workspace, baseRevision, mutationId }),
        },
        fetcher,
      );
    },
  };
}

export async function syncInterviewOutbox(
  store: LocalStore,
  remote: InterviewSyncTransport,
) {
  const pending = (await store.listPendingSync()).sort(
    (left, right) => left.queuedAt - right.queuedAt,
  );
  for (const item of pending) {
    try {
      const saved =
        item.operation === 'delete'
          ? await remote.remove(item.id, item.baseRevision, item.mutationId)
          : await remote.put(
              item.id,
              item.baseRevision,
              item.mutationId,
              item.record!,
              item.reason,
            );
      await store.clearPendingSync(item.id, item.mutationId, saved.revision);
    } catch (error) {
      const conflict = conflictFrom(error);
      if (!conflict || !item.record) throw error;
      const cloud = await remote.get(item.id);
      if (item.operation === 'delete') {
        const removed = await remote.remove(
          item.id,
          cloud.revision,
          item.mutationId,
        );
        await store.clearPendingSync(
          item.id,
          item.mutationId,
          removed.revision,
        );
        continue;
      }
      await store.saveInterviewConflict(item.record, cloud.record);
      await store.saveRemoteInterview(cloud.record, cloud.revision);
      await store.clearPendingSync(item.id, item.mutationId, cloud.revision);
    }
  }
}

export async function pullCloudInterviews(
  store: LocalStore,
  remote: InterviewSyncTransport,
) {
  const pendingIds = new Set(
    (await store.listPendingSync()).map(({ id }) => id),
  );
  const [summaries, deleted] = await Promise.all([
    remote.list(),
    remote.list(true),
  ]);
  for (const summary of summaries) {
    if (pendingIds.has(summary.id)) continue;
    const local = await store.getInterview(summary.id);
    const meta = await store.getSyncMeta(summary.id);
    if (local && meta?.revision === summary.revision) continue;
    const cloud = await remote.get(summary.id);
    await store.saveRemoteInterview(cloud.record, cloud.revision);
  }
  const activeIds = new Set(summaries.map(({ id }) => id));
  const deletedIds = new Set(deleted.map(({ id }) => id));
  for (const local of await store.listInterviews()) {
    if (
      pendingIds.has(local.id) ||
      activeIds.has(local.id) ||
      !(await store.getSyncMeta(local.id))
    )
      continue;
    if (deletedIds.has(local.id) || !activeIds.has(local.id))
      await store.deleteInterview(local.id);
  }
  return summaries;
}

export async function migrateAndSyncInterviews(
  store: LocalStore,
  remote: InterviewSyncTransport,
) {
  if (!(await store.isCloudMigrationComplete())) {
    const [records, pending] = await Promise.all([
      store.listInterviews(),
      store.listPendingSync(),
    ]);
    const queued = new Set(pending.map(({ id }) => id));
    for (const record of records) {
      if (queued.has(record.id) || (await store.getSyncMeta(record.id))) continue;
      await store.queueInterviewSync(record, 'periodic-edit');
    }
    await syncInterviewOutbox(store, remote);
    await pullCloudInterviews(store, remote);
    await store.markCloudMigrationComplete();
    return;
  }
  await syncInterviewOutbox(store, remote);
  await pullCloudInterviews(store, remote);
}
