import type { DatabaseSync } from 'node:sqlite';
import {
  MAX_CLOUD_INTERVIEW_BYTES,
  interviewSummary,
  validateCloudInterview,
  validateCloudVersionReason,
  type CloudInterview,
  type CloudInterviewSummary,
  type CloudVersionReason,
} from '../../lib/cloud-interview.ts';
import {
  applyInterviewJobResult,
  resultVersionReason,
} from '../../lib/interview-job-binding.ts';
import type { CodexExecutionKind } from '../../lib/codex-execution-contract.ts';

type Row = Record<string, string | number | null>;

export type StoredInterview = {
  record: CloudInterview;
  revision: number;
  deletedAt: number | null;
};

export type InterviewVersionSummary = {
  revision: number;
  reason: CloudVersionReason;
  createdAt: number;
};

export type InterviewWorkspace = {
  groups: Array<{ id: string; name: string; createdAt: number; order: number }>;
  sortMode: 'newest' | 'oldest' | 'manual';
  manualOrder: string[];
  collapsedGroupIds: string[];
};

export type StoredWorkspace = InterviewWorkspace & { revision: number };

export type PendingInterviewResult = {
  jobId: string;
  kind: string;
  baseRevision: number;
  result: unknown;
  state: 'pending' | 'applied' | 'discarded';
  createdAt: number;
  updatedAt: number;
};

export class InterviewStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export class RevisionConflict extends InterviewStoreError {
  current: CloudInterviewSummary;
  constructor(current: CloudInterviewSummary) {
    super('面试记录已在其他页面更新，本次修改未覆盖云端内容。', 409);
    this.current = current;
  }
}

function parseRecord(value: string) {
  return validateCloudInterview(JSON.parse(value));
}

function validateMutationId(value: string) {
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(value))
    throw new InterviewStoreError('同步操作编号无效。');
}

function validateWorkspace(value: unknown): InterviewWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InterviewStoreError('工作台设置格式无效。');
  const item = value as Record<string, unknown>;
  if (
    !Array.isArray(item.groups) ||
    item.groups.length > 100 ||
    !Array.isArray(item.manualOrder) ||
    item.manualOrder.length > 10_000 ||
    !Array.isArray(item.collapsedGroupIds) ||
    item.collapsedGroupIds.length > 100 ||
    !['newest', 'oldest', 'manual'].includes(String(item.sortMode))
  )
    throw new InterviewStoreError('工作台设置格式无效。');
  const identifiers = (values: unknown[], maximum: number) =>
    values.map((entry) => {
      if (typeof entry !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(entry))
        throw new InterviewStoreError('工作台记录编号无效。');
      return entry.slice(0, maximum);
    });
  const groups = item.groups.map((entry) => {
    if (!entry || typeof entry !== 'object')
      throw new InterviewStoreError('分组设置格式无效。');
    const group = entry as Record<string, unknown>;
    if (
      typeof group.id !== 'string' ||
      !/^[a-zA-Z0-9-]{8,100}$/.test(group.id) ||
      typeof group.name !== 'string' ||
      !group.name.trim() ||
      group.name.length > 40 ||
      !Number.isSafeInteger(group.createdAt) ||
      Number(group.createdAt) < 0 ||
      !Number.isSafeInteger(group.order) ||
      Number(group.order) < 0
    )
      throw new InterviewStoreError('分组设置格式无效。');
    return {
      id: group.id,
      name: group.name.trim(),
      createdAt: Number(group.createdAt),
      order: Number(group.order),
    };
  });
  if (
    new Set(groups.map(({ id }) => id)).size !== groups.length ||
    new Set(groups.map(({ name }) => name.toLocaleLowerCase())).size !==
      groups.length
  )
    throw new InterviewStoreError('分组不能重复。');
  return {
    groups,
    sortMode: item.sortMode as InterviewWorkspace['sortMode'],
    manualOrder: identifiers(item.manualOrder, 100),
    collapsedGroupIds: identifiers(item.collapsedGroupIds, 100),
  };
}

export class InterviewStore {
  private db: DatabaseSync;
  private now: () => number;
  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS interviews(
        user TEXT NOT NULL,
        id TEXT NOT NULL,
        content TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        deletedAt INTEGER,
        PRIMARY KEY(user,id)
      );
      CREATE TABLE IF NOT EXISTS interview_versions(
        user TEXT NOT NULL,
        interview TEXT NOT NULL,
        revision INTEGER NOT NULL,
        reason TEXT NOT NULL,
        content TEXT NOT NULL,
        created INTEGER NOT NULL,
        PRIMARY KEY(user,interview,revision)
      );
      CREATE TABLE IF NOT EXISTS interview_mutations(
        user TEXT NOT NULL,
        mutationId TEXT NOT NULL,
        interview TEXT NOT NULL,
        baseRevision INTEGER NOT NULL,
        resultRevision INTEGER NOT NULL,
        created INTEGER NOT NULL,
        PRIMARY KEY(user,mutationId)
      );
      CREATE TABLE IF NOT EXISTS interview_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT NOT NULL,
        interview TEXT NOT NULL,
        type TEXT NOT NULL,
        jobId TEXT,
        jobKind TEXT,
        ruleVersion TEXT,
        status TEXT,
        summary TEXT,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS interview_pending_results(
        user TEXT NOT NULL,
        interview TEXT NOT NULL,
        jobId TEXT NOT NULL,
        kind TEXT NOT NULL,
        baseRevision INTEGER NOT NULL,
        result TEXT NOT NULL,
        state TEXT NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY(user,interview,jobId)
      );
      CREATE TABLE IF NOT EXISTS interview_workspace(
        user TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        content TEXT NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS interviews_user_updated ON interviews(user,deletedAt,updated DESC);
      CREATE INDEX IF NOT EXISTS interview_versions_record ON interview_versions(user,interview,created DESC);
      CREATE INDEX IF NOT EXISTS interview_events_record ON interview_events(user,interview,created DESC);
      CREATE INDEX IF NOT EXISTS interview_pending_record ON interview_pending_results(user,interview,state,created DESC);
    `);
  }

  private row(user: string, id: string) {
    return this.db
      .prepare(
        'SELECT content,revision,created,updated,deletedAt FROM interviews WHERE user=? AND id=?',
      )
      .get(user, id) as Row | undefined;
  }

  private stored(user: string, id: string, includeDeleted = false): StoredInterview {
    const row = this.row(user, id);
    if (!row || (!includeDeleted && row.deletedAt !== null))
      throw new InterviewStoreError('面试记录不存在。', 404);
    return {
      record: parseRecord(String(row.content)),
      revision: Number(row.revision),
      deletedAt: row.deletedAt === null ? null : Number(row.deletedAt),
    };
  }

  get(user: string, id: string, includeDeleted = false) {
    return this.stored(user, id, includeDeleted);
  }

  list(user: string, includeDeleted = false): CloudInterviewSummary[] {
    const rows = this.db
      .prepare(
        `SELECT content,revision,deletedAt FROM interviews WHERE user=? ${
          includeDeleted ? '' : 'AND deletedAt IS NULL'
        } ORDER BY updated DESC`,
      )
      .all(user) as Row[];
    return rows.map((row) =>
      interviewSummary(
        parseRecord(String(row.content)),
        Number(row.revision),
        row.deletedAt === null ? null : Number(row.deletedAt),
      ),
    );
  }

  private repeatedMutation(user: string, mutationId: string) {
    return this.db
      .prepare(
        'SELECT interview,resultRevision FROM interview_mutations WHERE user=? AND mutationId=?',
      )
      .get(user, mutationId) as Row | undefined;
  }

  put(
    user: string,
    id: string,
    baseRevision: number,
    mutationId: string,
    value: unknown,
    reasonValue: unknown = 'periodic-edit',
  ): StoredInterview {
    validateMutationId(mutationId);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0)
      throw new InterviewStoreError('面试修订号无效。');
    const record = validateCloudInterview(value);
    if (record.id !== id) throw new InterviewStoreError('面试编号不一致。');
    const reason = validateCloudVersionReason(reasonValue);
    const repeated = this.repeatedMutation(user, mutationId);
    if (repeated) {
      if (String(repeated.interview) !== id)
        throw new InterviewStoreError('同步操作编号已被其他记录使用。', 409);
      return this.stored(user, id, true);
    }
    const current = this.row(user, id);
    if (
      (!!current && Number(current.revision) !== baseRevision) ||
      (!current && baseRevision !== 0)
    ) {
      if (!current) throw new InterviewStoreError('面试记录不存在。', 404);
      throw new RevisionConflict(
        interviewSummary(
          parseRecord(String(current.content)),
          Number(current.revision),
          current.deletedAt === null ? null : Number(current.deletedAt),
        ),
      );
    }
    if (current?.deletedAt !== null && current)
      throw new InterviewStoreError('面试记录已在回收站中。', 409);
    const now = this.now();
    const revision = baseRevision + 1;
    const content = JSON.stringify(record);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (current)
        this.db
          .prepare(
            'UPDATE interviews SET content=?,revision=?,updated=? WHERE user=? AND id=?',
          )
          .run(content, revision, now, user, id);
      else
        this.db
          .prepare(
            'INSERT INTO interviews(user,id,content,revision,created,updated,deletedAt) VALUES(?,?,?,?,?,?,NULL)',
          )
          .run(user, id, content, revision, now, now);
      const lastPeriodic = this.db
        .prepare(
          "SELECT created FROM interview_versions WHERE user=? AND interview=? AND reason='periodic-edit' ORDER BY created DESC LIMIT 1",
        )
        .get(user, id) as Row | undefined;
      if (
        reason !== 'periodic-edit' ||
        !lastPeriodic ||
        Number(lastPeriodic.created) <= now - 600_000
      )
        this.db
          .prepare(
            'INSERT INTO interview_versions(user,interview,revision,reason,content,created) VALUES(?,?,?,?,?,?)',
          )
          .run(user, id, revision, reason, content, now);
      this.db
        .prepare(
          'INSERT INTO interview_mutations(user,mutationId,interview,baseRevision,resultRevision,created) VALUES(?,?,?,?,?,?)',
        )
        .run(user, mutationId, id, baseRevision, revision, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { record, revision, deletedAt: null };
  }

  private changeDeletion(
    user: string,
    id: string,
    baseRevision: number,
    mutationId: string,
    restore: boolean,
  ) {
    validateMutationId(mutationId);
    const repeated = this.repeatedMutation(user, mutationId);
    if (repeated) return this.stored(user, id, true);
    const current = this.stored(user, id, true);
    if (current.revision !== baseRevision)
      throw new RevisionConflict(
        interviewSummary(current.record, current.revision, current.deletedAt),
      );
    if (restore ? current.deletedAt === null : current.deletedAt !== null)
      return current;
    const now = this.now();
    const revision = current.revision + 1;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'UPDATE interviews SET revision=?,updated=?,deletedAt=? WHERE user=? AND id=?',
        )
        .run(revision, now, restore ? null : now, user, id);
      this.db
        .prepare(
          'INSERT INTO interview_mutations(user,mutationId,interview,baseRevision,resultRevision,created) VALUES(?,?,?,?,?,?)',
        )
        .run(user, mutationId, id, baseRevision, revision, now);
      if (restore)
        this.db
          .prepare(
            'INSERT INTO interview_versions(user,interview,revision,reason,content,created) VALUES(?,?,?,?,?,?)',
          )
          .run(
            user,
            id,
            revision,
            'restored',
            JSON.stringify(current.record),
            now,
          );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return {
      record: current.record,
      revision,
      deletedAt: restore ? null : now,
    } satisfies StoredInterview;
  }

  remove(user: string, id: string, baseRevision: number, mutationId: string) {
    return this.changeDeletion(user, id, baseRevision, mutationId, false);
  }

  restoreDeleted(
    user: string,
    id: string,
    baseRevision: number,
    mutationId: string,
  ) {
    return this.changeDeletion(user, id, baseRevision, mutationId, true);
  }

  versions(user: string, id: string): InterviewVersionSummary[] {
    this.stored(user, id, true);
    return (
      this.db
        .prepare(
          'SELECT revision,reason,created FROM interview_versions WHERE user=? AND interview=? ORDER BY created DESC,revision DESC',
        )
        .all(user, id) as Row[]
    ).map((row) => ({
      revision: Number(row.revision),
      reason: validateCloudVersionReason(row.reason),
      createdAt: Number(row.created),
    }));
  }

  version(user: string, id: string, revision: number) {
    this.stored(user, id, true);
    const row = this.db
      .prepare(
        'SELECT content,reason,created FROM interview_versions WHERE user=? AND interview=? AND revision=?',
      )
      .get(user, id, revision) as Row | undefined;
    if (!row) throw new InterviewStoreError('面试历史版本不存在。', 404);
    return {
      record: parseRecord(String(row.content)),
      revision,
      reason: validateCloudVersionReason(row.reason),
      createdAt: Number(row.created),
    };
  }

  restoreVersion(
    user: string,
    id: string,
    revision: number,
    baseRevision: number,
    mutationId: string,
  ) {
    const source = this.version(user, id, revision).record;
    return this.put(
      user,
      id,
      baseRevision,
      mutationId,
      { ...source, updatedAt: this.now() },
      'restored',
    );
  }

  workspace(user: string): StoredWorkspace {
    const row = this.db
      .prepare('SELECT revision,content FROM interview_workspace WHERE user=?')
      .get(user) as Row | undefined;
    return row
      ? { ...validateWorkspace(JSON.parse(String(row.content))), revision: Number(row.revision) }
      : {
          groups: [],
          sortMode: 'newest',
          manualOrder: [],
          collapsedGroupIds: [],
          revision: 0,
        };
  }

  putWorkspace(
    user: string,
    baseRevision: number,
    mutationId: string,
    value: unknown,
  ) {
    validateMutationId(mutationId);
    const repeated = this.repeatedMutation(user, mutationId);
    if (repeated) return this.workspace(user);
    const current = this.workspace(user);
    if (current.revision !== baseRevision)
      throw new InterviewStoreError('工作台设置已在其他页面更新。', 409);
    const workspace = validateWorkspace(value);
    const revision = baseRevision + 1;
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO interview_workspace(user,revision,content,updated) VALUES(?,?,?,?)
           ON CONFLICT(user) DO UPDATE SET revision=excluded.revision,content=excluded.content,updated=excluded.updated`,
        )
        .run(user, revision, JSON.stringify(workspace), now);
      this.db
        .prepare(
          'INSERT INTO interview_mutations(user,mutationId,interview,baseRevision,resultRevision,created) VALUES(?,?,?,?,?,?)',
        )
        .run(user, mutationId, '@workspace', baseRevision, revision, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { ...workspace, revision };
  }

  savePendingResult(
    user: string,
    interview: string,
    jobId: string,
    kind: string,
    baseRevision: number,
    result: unknown,
  ) {
    this.stored(user, interview, true);
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(jobId) || kind.length > 40)
      throw new InterviewStoreError('待确认结果信息无效。');
    const serialized = JSON.stringify(result);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).length > MAX_CLOUD_INTERVIEW_BYTES
    )
      throw new InterviewStoreError('待确认结果超过大小限制。');
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO interview_pending_results(user,interview,jobId,kind,baseRevision,result,state,created,updated)
         VALUES(?,?,?,?,?,?,'pending',?,?)
         ON CONFLICT(user,interview,jobId) DO NOTHING`,
      )
      .run(user, interview, jobId, kind, baseRevision, serialized, now, now);
  }

  applyJobResult(
    user: string,
    interview: string,
    jobId: string,
    kind: CodexExecutionKind,
    result: unknown,
  ) {
    const current = this.get(user, interview);
    if (current.deletedAt !== null)
      throw new InterviewStoreError('面试记录已在回收站，结果未自动应用。', 409);
    return this.put(
      user,
      interview,
      current.revision,
      `job-${jobId}`,
      applyInterviewJobResult(current.record, kind, result, this.now(), { jobId }),
      resultVersionReason(kind),
    );
  }

  pendingResults(user: string, interview: string): PendingInterviewResult[] {
    return (
      this.db
        .prepare(
          'SELECT jobId,kind,baseRevision,result,state,created,updated FROM interview_pending_results WHERE user=? AND interview=? ORDER BY created DESC',
        )
        .all(user, interview) as Row[]
    ).map((row) => ({
      jobId: String(row.jobId),
      kind: String(row.kind),
      baseRevision: Number(row.baseRevision),
      result: JSON.parse(String(row.result)),
      state: String(row.state) as PendingInterviewResult['state'],
      createdAt: Number(row.created),
      updatedAt: Number(row.updated),
    }));
  }

  discardPendingResult(user: string, interview: string, jobId: string) {
    const changed = this.db
      .prepare(
        "UPDATE interview_pending_results SET state='discarded',updated=? WHERE user=? AND interview=? AND jobId=? AND state='pending'",
      )
      .run(this.now(), user, interview, jobId);
    if (!changed.changes)
      throw new InterviewStoreError('待确认结果不存在。', 404);
  }

  applyPendingResult(
    user: string,
    interview: string,
    jobId: string,
    baseRevision: number,
    mutationId: string,
  ) {
    const row = this.db
      .prepare(
        "SELECT kind,result FROM interview_pending_results WHERE user=? AND interview=? AND jobId=? AND state='pending'",
      )
      .get(user, interview, jobId) as Row | undefined;
    if (!row) throw new InterviewStoreError('待确认结果不存在。', 404);
    const kind = String(row.kind) as CodexExecutionKind;
    if (!['resume', 'written-test', 'work-sample', 'outline', 'follow-up-outline', 'second-round-outline', 'second-round-assessment', 'interview'].includes(kind))
      throw new InterviewStoreError('待确认结果类型无效。');
    const current = this.get(user, interview);
    if (current.revision !== baseRevision)
      throw new RevisionConflict(
        interviewSummary(current.record, current.revision, current.deletedAt),
      );
    const saved = this.put(
      user,
      interview,
      baseRevision,
      mutationId,
      applyInterviewJobResult(
        current.record,
        kind,
        JSON.parse(String(row.result)),
        this.now(),
        { jobId },
      ),
      resultVersionReason(kind),
    );
    this.db
      .prepare(
        "UPDATE interview_pending_results SET state='applied',updated=? WHERE user=? AND interview=? AND jobId=?",
      )
      .run(this.now(), user, interview, jobId);
    return saved;
  }

  sweep() {
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const expired = this.db
        .prepare('SELECT user,id FROM interviews WHERE deletedAt IS NOT NULL AND deletedAt<?')
        .all(now - 30 * 86_400_000) as Row[];
      for (const row of expired) {
        const user = String(row.user), id = String(row.id);
        this.db.prepare('DELETE FROM interview_versions WHERE user=? AND interview=?').run(user, id);
        this.db.prepare('DELETE FROM interview_events WHERE user=? AND interview=?').run(user, id);
        this.db.prepare('DELETE FROM interview_pending_results WHERE user=? AND interview=?').run(user, id);
        this.db.prepare('DELETE FROM interview_mutations WHERE user=? AND interview=?').run(user, id);
        this.db.prepare('DELETE FROM interviews WHERE user=? AND id=?').run(user, id);
      }
      this.db
        .prepare("DELETE FROM interview_versions WHERE reason='periodic-edit' AND created<?")
        .run(now - 90 * 86_400_000);
      this.db.exec(`DELETE FROM interview_versions
        WHERE rowid IN (
          SELECT rowid FROM (
            SELECT rowid,ROW_NUMBER() OVER (PARTITION BY user,interview ORDER BY created DESC,revision DESC) AS position
            FROM interview_versions WHERE reason='periodic-edit'
          ) WHERE position>50
        )`);
      this.db.prepare('DELETE FROM interview_mutations WHERE created<?').run(now - 7 * 86_400_000);
      this.db
        .prepare("DELETE FROM interview_pending_results WHERE state!='pending' AND updated<?")
        .run(now - 90 * 86_400_000);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
