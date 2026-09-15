import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import {
  validateResumeInput,
  validateResumeReading,
} from '../../lib/resume-reading.ts';
import { validateInput, validateReport } from '../../lib/interview.ts';
import {
  validateWrittenTestSupplement,
  validateWrittenTestSupplementInput,
} from '../../lib/written-test-supplement.ts';
import {
  validateWorkSampleAnalysisResult,
  validateWorkSampleInput,
  validateWorkSampleReference,
  type WorkSampleReference,
} from '../../lib/work-sample.ts';
import {
  validateOutlineRegenerationInput,
  validateOutlineRegenerationResult,
} from '../../lib/outline-regeneration.ts';
import {
  validateFollowUpOutlineInput,
  validateFollowUpOutlineResult,
} from '../../lib/follow-up-outline.ts';
import {
  CONNECTOR_VERSION,
  OUTLINE_CONNECTOR_PROTOCOL,
  OUTLINE_V2_CONNECTOR_PROTOCOL,
  OUTLINE_V3_CONNECTOR_PROTOCOL,
  SERVER_DRIVEN_EXECUTION_PROTOCOL,
  connectorSupportsOutline,
  connectorUpdateState,
  validateConnectorReport,
  type ConnectorReport,
} from '../../lib/connector-release.ts';
import { executionContractFor } from '../execution-contract.ts';
import type { CodexExecutionKind } from '../../lib/codex-execution-contract.ts';
import { InterviewStore } from '../interviews/store.ts';
import {
  assertInterviewJobInputMatches,
  interviewJobSource,
} from '../../lib/interview-job-binding.ts';
export type JobKind = CodexExecutionKind;
export class QueueError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const token = () => Buffer.from(randomBytes(32)).toString('base64url');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
type Row = Record<string, string | number | null>;
const PREPARATION_PRIORITY =
  "CASE WHEN kind IN ('resume','written-test','work-sample','outline','follow-up-outline') THEN 0 ELSE 1 END";
function validateStoredWorkSampleResult(result: unknown, storedInput: unknown) {
  const input = validateWorkSampleInput(storedInput);
  return validateWorkSampleAnalysisResult(result, input, {
    conciseQuestions: true,
  });
}
export class QueueStore {
  db: DatabaseSync;
  now: () => number;
  interviews: InterviewStore;
  constructor(path: string, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pairs(hash TEXT PRIMARY KEY,user TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user TEXT NOT NULL,name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,seen INTEGER NOT NULL,ready INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0,version TEXT,protocol INTEGER,versionSeen INTEGER);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user TEXT NOT NULL,client TEXT NOT NULL,inputHash TEXT NOT NULL,label TEXT NOT NULL,state TEXT NOT NULL,input TEXT,report TEXT,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,device TEXT,lease TEXT,until INTEGER,leaseProtocol INTEGER,kind TEXT NOT NULL DEFAULT 'interview',queued INTEGER,started INTEGER,scope TEXT,requiredProtocol INTEGER NOT NULL DEFAULT 1,attempt INTEGER NOT NULL DEFAULT 1,feedback TEXT,UNIQUE(user,client));
      CREATE TABLE IF NOT EXISTS outline_completions(user TEXT NOT NULL,scope TEXT NOT NULL,job TEXT NOT NULL,inputHash TEXT NOT NULL,completed INTEGER NOT NULL,PRIMARY KEY(user,scope));
      CREATE TABLE IF NOT EXISTS artifacts(user TEXT NOT NULL,device TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,modified INTEGER NOT NULL,seen INTEGER NOT NULL,PRIMARY KEY(device,id));
      CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(user,created);
      CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(user,state,created);
      CREATE INDEX IF NOT EXISTS devices_owner ON devices(user);
      CREATE INDEX IF NOT EXISTS artifacts_owner ON artifacts(user,seen);`);
    if (
      !(this.db.prepare('PRAGMA table_info(users)').all() as Row[]).some(
        (column) => column.name === 'active',
      )
    )
      this.db.exec(
        'ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
      );
    let jobColumns = this.db.prepare('PRAGMA table_info(jobs)').all() as Row[];
    if (!jobColumns.some((column) => column.name === 'kind')) {
      this.db.exec(
        "ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'interview'",
      );
      jobColumns = this.db.prepare('PRAGMA table_info(jobs)').all() as Row[];
    }
    if (!jobColumns.some((column) => column.name === 'queued'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN queued INTEGER');
    if (!jobColumns.some((column) => column.name === 'started'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN started INTEGER');
    if (!jobColumns.some((column) => column.name === 'targetDevice'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN targetDevice TEXT');
    if (!jobColumns.some((column) => column.name === 'artifactId'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN artifactId TEXT');
    if (!jobColumns.some((column) => column.name === 'scope'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN scope TEXT');
    if (!jobColumns.some((column) => column.name === 'requiredProtocol'))
      this.db.exec(
        'ALTER TABLE jobs ADD COLUMN requiredProtocol INTEGER NOT NULL DEFAULT 1',
      );
    if (!jobColumns.some((column) => column.name === 'attempt'))
      this.db.exec(
        'ALTER TABLE jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1',
      );
    if (!jobColumns.some((column) => column.name === 'feedback'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN feedback TEXT');
    if (!jobColumns.some((column) => column.name === 'leaseProtocol'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN leaseProtocol INTEGER');
    if (!jobColumns.some((column) => column.name === 'interviewId'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN interviewId TEXT');
    if (!jobColumns.some((column) => column.name === 'interviewRevision'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN interviewRevision INTEGER');
    if (!jobColumns.some((column) => column.name === 'sourceHash'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN sourceHash TEXT');
    if (!jobColumns.some((column) => column.name === 'resultDisposition'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN resultDisposition TEXT');
    this.db
      .prepare(
        "UPDATE jobs SET state='failed',input=NULL,report=NULL,error='旧版提纲任务缺少面试记录范围，请重新提交。',updated=? WHERE kind='outline' AND scope IS NULL AND state IN ('queued','running','paused','completed')",
      )
      .run(this.now());
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS outline_record_once ON jobs(user,scope) WHERE kind='outline' AND scope IS NOT NULL AND state IN ('queued','running','paused','completed')",
    );
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS follow_up_outline_record_once ON jobs(user,scope) WHERE kind='follow-up-outline' AND scope IS NOT NULL AND state IN ('queued','running','paused')",
    );
    const deviceColumns = this.db
      .prepare('PRAGMA table_info(devices)')
      .all() as Row[];
    if (!deviceColumns.some((column) => column.name === 'version'))
      this.db.exec('ALTER TABLE devices ADD COLUMN version TEXT');
    if (!deviceColumns.some((column) => column.name === 'protocol'))
      this.db.exec('ALTER TABLE devices ADD COLUMN protocol INTEGER');
    if (!deviceColumns.some((column) => column.name === 'versionSeen'))
      this.db.exec('ALTER TABLE devices ADD COLUMN versionSeen INTEGER');
    this.db.exec(
      "UPDATE jobs SET leaseProtocol=COALESCE((SELECT protocol FROM devices WHERE devices.id=jobs.device),1) WHERE state='running' AND leaseProtocol IS NULL",
    );
    this.db.exec('UPDATE jobs SET queued=created WHERE queued IS NULL');
    this.interviews = new InterviewStore(this.db, this.now);
  }
  close() {
    this.db.close();
  }
  createUser(username: string, password: string, id: string = randomUUID()) {
    this.validateUserInput(username, password);
    if (this.db.prepare('SELECT 1 FROM users WHERE username=?').get(username))
      throw new QueueError('账号已存在。', 409);
    const salt = token();
    this.db
      .prepare(
        'INSERT INTO users(id,username,salt,password,active) VALUES(?,?,?,?,1)',
      )
      .run(
        id,
        username,
        salt,
        Buffer.from(scryptSync(password, salt, 32)).toString('hex'),
      );
    return { id, username };
  }
  private validateUserInput(username: string, password: string) {
    if (
      !/^[\p{L}\p{N}_@.-]{2,80}$/u.test(username) ||
      password.length < 12 ||
      password.length > 200
    )
      throw new QueueError('账号需 2–80 字，密码需 12–200 字。');
  }
  private userByName(username: string) {
    const user = this.db
      .prepare('SELECT id,username,active FROM users WHERE username=?')
      .get(username) as Row | undefined;
    if (!user) throw new QueueError('账号不存在。', 404);
    return user;
  }
  private revokeUserAccess(
    user: string,
    unfinished: 'running' | 'all',
    message: string,
  ) {
    this.db.prepare('DELETE FROM sessions WHERE user=?').run(user);
    this.db.prepare('DELETE FROM pairs WHERE user=?').run(user);
    this.db.prepare('UPDATE devices SET revoked=1 WHERE user=?').run(user);
    const states =
      unfinished === 'all'
        ? "state IN ('queued','running')"
        : "state='running'";
    this.db
      .prepare(
        `UPDATE jobs SET state='failed',input=NULL,error=?,updated=? WHERE user=? AND ${states}`,
      )
      .run(message, this.now(), user);
  }
  listUsers() {
    return (
      this.db
        .prepare('SELECT username,active FROM users ORDER BY username')
        .all() as Row[]
    ).map((user) => ({
      username: String(user.username),
      active: !!user.active,
    }));
  }
  setUserActive(username: string, active: boolean) {
    const user = this.userByName(username);
    if (!!user.active === active) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('UPDATE users SET active=? WHERE id=?')
        .run(active ? 1 : 0, user.id);
      if (!active)
        this.revokeUserAccess(
          String(user.id),
          'all',
          '账号已停用，任务已终止。',
        );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  resetUserPassword(username: string, password: string) {
    this.validateUserInput(username, password);
    const user = this.userByName(username),
      salt = token();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('UPDATE users SET salt=?,password=? WHERE id=?')
        .run(
          salt,
          Buffer.from(scryptSync(password, salt, 32)).toString('hex'),
          user.id,
        );
      this.revokeUserAccess(
        String(user.id),
        'running',
        '账号凭据已更新，请重新提交。',
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  userCount() {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n,
    );
  }
  login(username: string, password: string) {
    const user = this.db
      .prepare('SELECT * FROM users WHERE username=?')
      .get(username) as Row | undefined;
    const calculated = scryptSync(
      password,
      user ? String(user.salt) : 'invalid-user-salt',
      32,
    );
    if (
      !user ||
      !user.active ||
      !timingSafeEqual(calculated, Buffer.from(String(user.password), 'hex'))
    )
      throw new QueueError('账号或密码错误。', 401);
    return this.newSession(String(user.id));
  }
  newSession(user: string) {
    if (
      !this.db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(user)
    )
      throw new QueueError('账号或密码错误。', 401);
    const value = token();
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(hash(value), user, this.now() + 7 * 86400000);
    return value;
  }
  session(value: string) {
    return this.db
      .prepare(
        'SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user WHERE sessions.hash=? AND expires>? AND users.active=1',
      )
      .get(hash(value), this.now()) as
      | { id: string; username: string }
      | undefined;
  }
  logout(value: string) {
    this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(value));
  }
  pairing(user: string) {
    if (
      !this.db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(user)
    )
      throw new QueueError('账号已停用。', 403);
    this.db
      .prepare('DELETE FROM pairs WHERE user=? OR expires<?')
      .run(user, this.now());
    const code = Buffer.from(randomBytes(9)).toString('hex');
    this.db
      .prepare('INSERT INTO pairs VALUES(?,?,?)')
      .run(hash(code), user, this.now() + 600000);
    return { code, expiresAt: this.now() + 600000 };
  }
  private connector(value: unknown): ConnectorReport | null {
    try {
      return validateConnectorReport(value);
    } catch {
      throw new QueueError('连接器版本格式不正确。');
    }
  }
  private recordConnector(id: string, value: unknown) {
    const report = this.connector(value);
    if (report)
      this.db
        .prepare(
          'UPDATE devices SET version=?,protocol=?,versionSeen=? WHERE id=?',
        )
        .run(report.version, report.protocol, this.now(), id);
    return report;
  }
  redeem(code: string, name: string, connector?: unknown) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const pair = this.db
        .prepare('DELETE FROM pairs WHERE hash=? AND expires>? RETURNING user')
        .get(hash(code), this.now()) as Row | undefined;
      if (!pair) throw new QueueError('配对码无效、已使用或已过期。', 403);
      const id = randomUUID(),
        secret = token();
      this.db
        .prepare(
          'INSERT INTO devices(id,user,name,hash,seen) VALUES(?,?,?,?,?)',
        )
        .run(
          id,
          String(pair.user),
          name.slice(0, 80) || '我的电脑',
          hash(secret),
          this.now(),
        );
      this.recordConnector(id, connector);
      this.db.exec('COMMIT');
      return { id, token: secret };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  device(secret: string) {
    const row = this.db
      .prepare(
        'SELECT devices.id,devices.user FROM devices JOIN users ON users.id=devices.user WHERE devices.hash=? AND devices.revoked=0 AND users.active=1',
      )
      .get(hash(secret)) as { id: string; user: string } | undefined;
    if (!row) throw new QueueError('连接器授权已失效，请重新配对。', 401);
    return row;
  }
  devices(user: string) {
    return (
      this.db
        .prepare(
          'SELECT id,name,seen,ready,version,protocol,versionSeen FROM devices WHERE user=? AND revoked=0',
        )
        .all(user) as Row[]
    ).map((row) => {
      const supportsOutline = connectorSupportsOutline(
        row.protocol === null ? null : Number(row.protocol),
      );
      return {
        id: row.id,
        name: row.name,
        lastSeen: row.seen,
        online: Number(row.seen) > this.now() - 45000,
        ready: !!row.ready,
        version: row.version ? String(row.version) : null,
        protocol: row.protocol === null ? null : Number(row.protocol),
        versionSeen: row.versionSeen === null ? null : Number(row.versionSeen),
        updateState: connectorUpdateState(
          row.version ? String(row.version) : null,
          row.protocol === null ? null : Number(row.protocol),
        ),
        supportsOrdinaryAnalysis:
          row.protocol === null || Number(row.protocol) >= 1,
        supportsOutline,
        unsupportedCapabilities: supportsOutline
          ? []
          : ['outline-regeneration'],
        latestVersion: CONNECTOR_VERSION,
      };
    });
  }
  syncArtifacts(
    secret: string,
    values: unknown,
    connector?: unknown,
  ): WorkSampleReference[] {
    const device = this.device(secret);
    this.recordConnector(device.id, connector);
    if (!Array.isArray(values) || values.length > 100)
      throw new QueueError('作品清单超过限制。');
    const artifacts = values.map((value) => {
      try {
        const artifact = validateWorkSampleReference(value);
        if (artifact.deviceId !== device.id) throw new Error();
        return artifact;
      } catch {
        throw new QueueError('作品清单包含无效项目。');
      }
    });
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM artifacts WHERE device=?').run(device.id);
      const insert = this.db.prepare(
        'INSERT INTO artifacts(user,device,id,name,sha256,bytes,modified,seen) VALUES(?,?,?,?,?,?,?,?)',
      );
      for (const artifact of artifacts)
        insert.run(
          device.user,
          device.id,
          artifact.id,
          artifact.name,
          artifact.sha256,
          artifact.bytes,
          artifact.modifiedAt,
          now,
        );
      this.db
        .prepare('UPDATE devices SET seen=? WHERE id=?')
        .run(now, device.id);
      this.db.exec('COMMIT');
      return artifacts;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  artifacts(user: string) {
    const now = this.now();
    return (
      this.db
        .prepare(
          `SELECT artifacts.id,artifacts.device AS deviceId,artifacts.name,artifacts.sha256,artifacts.bytes,artifacts.modified AS modifiedAt,artifacts.seen,devices.name AS deviceName,devices.seen AS deviceSeen,devices.revoked
           FROM artifacts JOIN devices ON devices.id=artifacts.device
           WHERE artifacts.user=? ORDER BY artifacts.modified DESC,artifacts.name`,
        )
        .all(user) as Row[]
    ).map((row) => ({
      id: String(row.id),
      deviceId: String(row.deviceId),
      name: String(row.name),
      sha256: String(row.sha256),
      bytes: Number(row.bytes),
      modifiedAt: Number(row.modifiedAt),
      syncedAt: Number(row.seen),
      deviceName: String(row.deviceName),
      available:
        !row.revoked &&
        Number(row.seen) > now - 45000 &&
        Number(row.deviceSeen) > now - 45000,
    }));
  }
  revoke(user: string, id: string) {
    this.db
      .prepare('UPDATE devices SET revoked=1 WHERE id=? AND user=?')
      .run(id, user);
    this.db
      .prepare(
        "UPDATE jobs SET state='failed',input=NULL,error='执行电脑已解除配对，请重新提交。',updated=? WHERE device=? AND user=? AND state='running'",
      )
      .run(this.now(), id, user);
    this.db
      .prepare(
        "UPDATE jobs SET state='failed',input=NULL,error='保存作品的电脑已解除配对，请重新选择作品。',device=NULL,lease=NULL,until=NULL,leaseProtocol=NULL,updated=? WHERE targetDevice=? AND user=? AND state IN ('queued','running','paused')",
      )
      .run(this.now(), id, user);
    this.db
      .prepare('DELETE FROM artifacts WHERE device=? AND user=?')
      .run(id, user);
  }
  sweep() {
    const now = this.now();
    this.interviews.sweep();
    this.db
      .prepare(
        "UPDATE jobs SET state='failed',input=NULL,error='电脑连接中断，未自动重复分析。请确认后重新提交。',updated=? WHERE state='running' AND until<?",
      )
      .run(now, now);
    this.db
      .prepare(
        "UPDATE jobs SET state='failed',input=NULL,error='任务等待超过 24 小时，请重新提交。',updated=? WHERE state='queued' AND created<?",
      )
      .run(now, now - 86400000);
    this.db
      .prepare(
        "DELETE FROM jobs WHERE state NOT IN ('queued','running') AND updated<?",
      )
      .run(now - 7 * 86400000);
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    this.db.prepare('DELETE FROM pairs WHERE expires<?').run(now);
    this.db.prepare('DELETE FROM artifacts WHERE seen<?').run(now - 86400000);
  }
  submit(
    user: string,
    client: string,
    label: string,
    value: unknown,
    kind: JobKind = 'interview',
    scope = '',
    binding?: { interviewId: string; interviewRevision: number },
  ) {
    this.sweep();
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(client))
      throw new QueueError('任务标识无效。');
    if (scope && !/^[a-zA-Z0-9-]{8,100}$/.test(scope))
      throw new QueueError('任务范围无效。');
    if (kind === 'outline' && !scope)
      throw new QueueError('重新生成提纲需要绑定面试记录。');
    if (kind === 'follow-up-outline' && (!scope || !binding))
      throw new QueueError('补充追问需要绑定面试记录。');
    if (
      scope &&
      kind !== 'resume' &&
      kind !== 'written-test' &&
      kind !== 'work-sample' &&
      kind !== 'outline' &&
      kind !== 'follow-up-outline'
    )
      throw new QueueError('该任务类型不支持任务范围。');
    let interviewId: string | null = null,
      interviewRevision: number | null = null,
      sourceHash: string | null = null,
      boundRecord: ReturnType<InterviewStore['get']> | null = null;
    if (binding) {
      if (
        !/^[a-zA-Z0-9-]{8,100}$/.test(binding.interviewId) ||
        !Number.isSafeInteger(binding.interviewRevision) ||
        binding.interviewRevision < 1
      )
        throw new QueueError('面试档案版本无效。');
      const saved = this.interviews.get(user, binding.interviewId, true);
      boundRecord = saved;
      if (saved.deletedAt !== null)
        throw new QueueError('面试记录已在回收站。', 409);
      if (saved.revision !== binding.interviewRevision)
        throw new QueueError('面试记录已更新，请同步后重新提交。', 409);
      if (scope && scope !== binding.interviewId)
        throw new QueueError('任务与面试记录不匹配。', 409);
      interviewId = binding.interviewId;
      interviewRevision = binding.interviewRevision;
      sourceHash = hash(JSON.stringify(interviewJobSource(saved.record, kind)));
    }
    const validatedInput =
        kind === 'resume'
          ? validateResumeInput(value)
          : kind === 'written-test'
            ? validateWrittenTestSupplementInput(value)
            : kind === 'work-sample'
              ? validateWorkSampleInput(value)
              : kind === 'outline'
                ? validateOutlineRegenerationInput(value)
                : kind === 'follow-up-outline'
                  ? validateFollowUpOutlineInput(value)
                : kind === 'interview'
                  ? validateInput(value)
                  : (() => {
                      throw new QueueError('作品评估任务尚未包含有效输入。');
                  })(),
      input = JSON.stringify(validatedInput),
      digest = hash(
        kind +
          (scope ? '\n' + scope + '\n' : '') +
          (interviewId ? `\n${interviewId}@${interviewRevision}\n` : '') +
          input,
      ),
      safeLabel = label.slice(0, 100) || '未命名面试',
      requiredProtocol =
        kind === 'follow-up-outline'
          ? SERVER_DRIVEN_EXECUTION_PROTOCOL
          : 'outlineVersion' in validatedInput &&
              validatedInput.outlineVersion === 3
            ? OUTLINE_V3_CONNECTOR_PROTOCOL
            : 'outlineVersion' in validatedInput &&
                validatedInput.outlineVersion === 2
              ? OUTLINE_V2_CONNECTOR_PROTOCOL
              : 1;
    if (boundRecord && kind !== 'follow-up-outline')
      assertInterviewJobInputMatches(
        boundRecord.record,
        kind,
        validatedInput as unknown as Record<string, unknown>,
      );
    if (
      kind === 'outline' &&
      !this.db
        .prepare(
          'SELECT 1 FROM devices WHERE user=? AND revoked=0 AND protocol>=? LIMIT 1',
        )
        .get(user, Math.max(OUTLINE_CONNECTOR_PROTOCOL, requiredProtocol))
    )
      throw new QueueError(
        '当前连接器不支持重新生成提纲，请先下载并启动新版连接器。',
        409,
      );
    if (kind === 'outline') {
      if (
        this.db
          .prepare('SELECT 1 FROM outline_completions WHERE user=? AND scope=?')
          .get(user, scope)
      )
        throw new QueueError('当前面试记录已经成功重新生成过提纲。', 409);
      const scoped = this.db
        .prepare(
          "SELECT id,inputHash,state FROM jobs WHERE user=? AND kind='outline' AND scope=? AND state IN ('queued','running','paused') ORDER BY created LIMIT 1",
        )
        .get(user, scope) as Row | undefined;
      if (scoped) {
        if (scoped.inputHash === digest)
          return this.get(user, String(scoped.id));
        throw new QueueError(
          '当前面试记录已有提纲重新生成任务，请在任务中心查看。',
          409,
        );
      }
    }
    if (scope) {
      const conflicting = this.db
        .prepare(
          "SELECT kind FROM jobs WHERE user=? AND scope=? AND kind<>? AND kind IN ('resume','written-test','work-sample','outline','follow-up-outline') AND state IN ('queued','running','paused') LIMIT 1",
        )
        .get(user, scope, kind) as Row | undefined;
      if (conflicting)
        throw new QueueError(
          '当前面试记录已有准备任务，请在任务中心等待完成或停止后重试。',
          409,
        );
    }
    const workSample: WorkSampleReference | undefined =
      (kind === 'resume' || kind === 'work-sample') &&
      'workSample' in validatedInput
        ? validateWorkSampleReference(validatedInput.workSample)
        : undefined;
    let targetDevice: string | null = null,
      artifactId: string | null = null;
    if (workSample) {
      const artifact = this.db
        .prepare(
          'SELECT device,id,seen FROM artifacts WHERE user=? AND device=? AND id=? AND name=? AND sha256=? AND bytes=? AND modified=?',
        )
        .get(
          user,
          workSample.deviceId,
          workSample.id,
          workSample.name,
          workSample.sha256,
          workSample.bytes,
          workSample.modifiedAt,
        ) as Row | undefined;
      if (!artifact || Number(artifact.seen) <= this.now() - 45000)
        throw new QueueError(
          '所选笔试作品已离线或发生变化，请刷新作品清单。',
          409,
        );
      targetDevice = String(artifact.device);
      artifactId = String(artifact.id);
    }
    const previous = this.db
      .prepare('SELECT id,inputHash FROM jobs WHERE user=? AND client=?')
      .get(user, client) as Row | undefined;
    if (previous) {
      if (
        previous.inputHash !== digest &&
        !(kind === 'interview' && previous.inputHash === hash(input))
      )
        throw new QueueError('任务标识已用于其他材料。', 409);
      return this.get(user, String(previous.id));
    }
    const reusable = this.db
      .prepare(
        kind !== 'interview'
          ? "SELECT id FROM jobs WHERE user=? AND kind=? AND inputHash=? AND label=? AND state IN ('queued','running','paused','completed') ORDER BY created LIMIT 1"
          : "SELECT id FROM jobs WHERE user=? AND kind=? AND inputHash=? AND label=? AND state IN ('queued','running','paused') ORDER BY created LIMIT 1",
      )
      .get(user, kind, digest, safeLabel) as Row | undefined;
    if (reusable) return this.get(user, String(reusable.id));
    const count = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE user=? AND state IN ('queued','running')",
      )
      .get(user) as Row;
    if (Number(count.n) >= 20)
      throw new QueueError('待处理任务已达 20 项，请先处理或取消。', 429);
    const id = randomUUID();
    try {
      this.db
        .prepare(
          "INSERT INTO jobs(id,user,client,inputHash,label,state,input,created,updated,kind,queued,targetDevice,artifactId,scope,requiredProtocol,interviewId,interviewRevision,sourceHash) VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          user,
          client,
          digest,
          safeLabel,
          input,
          this.now(),
          this.now(),
          kind,
          this.now(),
          targetDevice,
          artifactId,
          scope || null,
          requiredProtocol,
          interviewId,
          interviewRevision,
          sourceHash,
        );
    } catch (insertError) {
      if (kind === 'outline')
        throw new QueueError(
          '当前面试记录已有提纲重新生成任务，请在任务中心查看。',
          409,
        );
      if (kind === 'follow-up-outline')
        throw new QueueError(
          '当前面试记录已有补充追问任务，请等待完成或先停止任务。',
          409,
        );
      throw insertError;
    }
    return this.get(user, id);
  }
  get(user: string, id: string) {
    this.sweep();
    const row = this.db
      .prepare(
        'SELECT id,label,kind,state,report,error,created,updated,queued,started,targetDevice,artifactId,requiredProtocol,interviewId,interviewRevision,resultDisposition FROM jobs WHERE user=? AND id=?',
      )
      .get(user, id) as Row | undefined;
    if (!row) throw new QueueError('任务不存在。', 404);
    const target = row.targetDevice
      ? (this.db
          .prepare(
            'SELECT name,seen,ready,revoked FROM devices WHERE id=? AND user=?',
          )
          .get(row.targetDevice, user) as Row | undefined)
      : undefined;
    return {
      id: String(row.id),
      label: String(row.label),
      kind: String(row.kind),
      state: String(row.state),
      created: Number(row.created),
      updated: Number(row.updated),
      queuedAt: Number(row.queued),
      startedAt: row.started === null ? null : Number(row.started),
      position:
        row.state === 'queued'
          ? this.queuePosition(user, String(row.id))
          : null,
      error: row.error,
      report: row.report ? (JSON.parse(String(row.report)) as unknown) : null,
      artifactId: row.artifactId ? String(row.artifactId) : null,
      targetDeviceName: target ? String(target.name) : null,
      waitingForDevice:
        row.state === 'queued' &&
        !!row.targetDevice &&
        (!target ||
          !!target.revoked ||
          !target.ready ||
          Number(target.seen) <= this.now() - 45000),
      requiredProtocol: Number(row.requiredProtocol),
      interviewId: row.interviewId ? String(row.interviewId) : null,
      interviewRevision:
        row.interviewRevision === null ? null : Number(row.interviewRevision),
      resultDisposition: row.resultDisposition
        ? String(row.resultDisposition)
        : null,
    };
  }
  private queuePosition(user: string, id: string) {
    const rows = this.db
      .prepare(
        `SELECT id FROM jobs WHERE user=? AND state='queued' ORDER BY ${PREPARATION_PRIORITY},queued,created,rowid`,
      )
      .all(user) as Row[];
    const index = rows.findIndex((row) => row.id === id);
    return index < 0 ? null : index + 1;
  }
  list(user: string) {
    this.sweep();
    return (
      this.db
        .prepare(
          'SELECT id,label,kind,state,error,created,updated,queued,started,targetDevice,artifactId,requiredProtocol,interviewId,interviewRevision,resultDisposition FROM jobs WHERE user=? ORDER BY created DESC LIMIT 100',
        )
        .all(user) as Row[]
    ).map((row) => {
      const target = row.targetDevice
        ? (this.db
            .prepare(
              'SELECT name,seen,ready,revoked FROM devices WHERE id=? AND user=?',
            )
            .get(row.targetDevice, user) as Row | undefined)
        : undefined;
      return {
        id: String(row.id),
        label: String(row.label),
        kind: String(row.kind),
        state: String(row.state),
        created: Number(row.created),
        updated: Number(row.updated),
        queuedAt: Number(row.queued),
        startedAt: row.started === null ? null : Number(row.started),
        position:
          row.state === 'queued'
            ? this.queuePosition(user, String(row.id))
            : null,
        error: row.error,
        artifactId: row.artifactId ? String(row.artifactId) : null,
        targetDeviceName: target ? String(target.name) : null,
        waitingForDevice:
          row.state === 'queued' &&
          !!row.targetDevice &&
          (!target ||
            !!target.revoked ||
            !target.ready ||
            Number(target.seen) <= this.now() - 45000),
        requiredProtocol: Number(row.requiredProtocol),
        interviewId: row.interviewId ? String(row.interviewId) : null,
        interviewRevision:
          row.interviewRevision === null ? null : Number(row.interviewRevision),
        resultDisposition: row.resultDisposition
          ? String(row.resultDisposition)
          : null,
      };
    });
  }
  action(user: string, id: string, action: 'pause' | 'resume' | 'stop') {
    this.sweep();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare('SELECT state FROM jobs WHERE user=? AND id=?')
        .get(user, id) as Row | undefined;
      if (!row) throw new QueueError('任务不存在。', 404);
      const state = String(row.state);
      if (action === 'pause') {
        if (state !== 'paused') {
          if (state !== 'queued' && state !== 'running')
            throw new QueueError('当前任务不能暂停。', 409);
          this.db
            .prepare(
              "UPDATE jobs SET state='paused',device=NULL,lease=NULL,until=NULL,leaseProtocol=NULL,updated=? WHERE user=? AND id=?",
            )
            .run(this.now(), user, id);
        }
      } else if (action === 'resume') {
        if (state !== 'queued') {
          if (state !== 'paused')
            throw new QueueError('当前任务不能恢复。', 409);
          this.db
            .prepare(
              "UPDATE jobs SET state='queued',queued=?,started=NULL,device=NULL,lease=NULL,until=NULL,leaseProtocol=NULL,updated=? WHERE user=? AND id=?",
            )
            .run(this.now(), this.now(), user, id);
        }
      } else if (state !== 'cancelled') {
        if (!['queued', 'running', 'paused'].includes(state))
          throw new QueueError('当前任务不能停止。', 409);
        this.db
          .prepare(
            "UPDATE jobs SET state='cancelled',input=NULL,report=NULL,error=NULL,device=NULL,lease=NULL,until=NULL,leaseProtocol=NULL,started=NULL,updated=? WHERE user=? AND id=?",
          )
          .run(this.now(), user, id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.get(user, id);
  }
  cancel(user: string, id: string) {
    return this.action(user, id, 'stop');
  }
  claim(
    secret: string,
    ready: boolean,
    kinds: JobKind[] = ['interview'],
    connector?: unknown,
  ) {
    this.sweep();
    const device = this.device(secret);
    const release = this.recordConnector(device.id, connector);
    const storedProtocol = this.db
      .prepare('SELECT protocol FROM devices WHERE id=?')
      .get(device.id) as Row | undefined;
    const connectorProtocol = Number(
      release?.protocol || storedProtocol?.protocol || 1,
    );
    this.db
      .prepare('UPDATE devices SET seen=?,ready=? WHERE id=?')
      .run(this.now(), ready ? 1 : 0, device.id);
    if (!ready) return null;
    const lease = token();
    const row = this.db
      .prepare(
        `UPDATE jobs SET state='running',device=?,lease=?,until=?,leaseProtocol=?,updated=?,started=? WHERE id=(SELECT id FROM jobs WHERE user=? AND state='queued' AND requiredProtocol<=? AND (targetDevice IS NULL OR targetDevice=?) AND (kind='interview' OR (kind='resume' AND ?=1) OR (kind='written-test' AND ?=1) OR (kind='work-sample' AND ?=1) OR (kind='outline' AND ?=1) OR (kind='follow-up-outline' AND ?=1)) AND NOT EXISTS(SELECT 1 FROM jobs WHERE device=? AND state='running') ORDER BY ${PREPARATION_PRIORITY},queued,created,rowid LIMIT 1) RETURNING id,input,kind,artifactId,attempt,feedback`,
      )
      .get(
        device.id,
        lease,
        this.now() + 60000,
        connectorProtocol,
        this.now(),
        this.now(),
        device.user,
        connectorProtocol,
        device.id,
        kinds.includes('resume') ? 1 : 0,
        kinds.includes('written-test') ? 1 : 0,
        kinds.includes('work-sample') ? 1 : 0,
        kinds.includes('outline') && connectorSupportsOutline(release?.protocol)
          ? 1
          : 0,
        kinds.includes('follow-up-outline') ? 1 : 0,
        device.id,
      ) as Row | undefined;
    if (!row) return null;
    const input = JSON.parse(String(row.input)) as unknown;
    const base = {
      id: String(row.id),
      lease,
      kind: String(row.kind),
      artifactId: row.artifactId ? String(row.artifactId) : null,
    };
    return connectorProtocol >= SERVER_DRIVEN_EXECUTION_PROTOCOL
      ? {
          ...base,
          execution: executionContractFor(row.kind as JobKind, input, {
            attempt: Number(row.attempt || 1),
            feedback: row.feedback ? String(row.feedback) : undefined,
          }),
        }
      : { ...base, input };
  }
  heartbeat(secret: string, id: string, lease: string, connector?: unknown) {
    this.sweep();
    const device = this.device(secret);
    this.recordConnector(device.id, connector);
    this.db
      .prepare('UPDATE devices SET seen=?,ready=1 WHERE id=?')
      .run(this.now(), device.id);
    const result = this.db
      .prepare(
        "UPDATE jobs SET until=?,updated=? WHERE id=? AND device=? AND user=? AND lease=? AND state='running'",
      )
      .run(this.now() + 60000, this.now(), id, device.id, device.user, lease);
    return { active: result.changes === 1 };
  }
  finish(
    secret: string,
    id: string,
    lease: string,
    result: unknown,
    failed = false,
    failure?: unknown,
    executionAttempt?: unknown,
  ) {
    this.sweep();
    const device = this.device(secret);
    const job = this.db
      .prepare('SELECT * FROM jobs WHERE id=? AND user=?')
      .get(id, device.user) as Row | undefined;
    if (!job) throw new QueueError('任务不属于此连接器。', 403);
    const executionProtocol = Number(job.leaseProtocol || 1);
    if (
      executionProtocol >= SERVER_DRIVEN_EXECUTION_PROTOCOL &&
      executionAttempt === undefined
    )
      throw new QueueError('协议 5 完成任务时必须提供执行合同次数。');
    if (job.state === 'completed' || job.state === 'failed') {
      if (job.device !== device.id || job.lease !== lease)
        throw new QueueError('任务不属于此连接器。', 403);
      return { accepted: true };
    }
    if (job.state !== 'running') return { accepted: false };
    if (job.device !== device.id || job.lease !== lease)
      throw new QueueError('任务不属于此连接器。', 403);
    if (
      executionProtocol >= SERVER_DRIVEN_EXECUTION_PROTOCOL &&
      executionAttempt !== undefined
    ) {
      if (!Number.isSafeInteger(executionAttempt) || Number(executionAttempt) < 1)
        throw new QueueError('执行合同次数无效。');
      if (
        Number(executionAttempt) < Number(job.attempt || 1) &&
        job.feedback
      )
        return {
          accepted: false,
          retry: {
            execution: executionContractFor(
              job.kind as JobKind,
              JSON.parse(String(job.input)),
              {
                attempt: Number(job.attempt),
                feedback: String(job.feedback),
              },
            ),
          },
        };
      if (Number(executionAttempt) !== Number(job.attempt || 1))
        throw new QueueError('执行合同已过期，请重新领取任务。', 409);
    }
    let report: string | null = null,
      error: string | null = null,
      validationFeedback: string | null = null;
    if (failed) {
      const messages: Record<string, string> = {
        'artifact-missing': '本地笔试作品未找到，请放回原 ZIP 后重新提交。',
        'artifact-changed':
          '本地笔试作品已发生变化，请刷新作品清单后重新选择。',
        'artifact-invalid':
          '笔试作品 ZIP 无法安全读取，请检查文件内容后重新提交。',
        validation: 'Codex 输出的引用或结构校验失败，请重新提交。',
        timeout:
          '本地 Codex 作品分析超时。较大的作品可能需要更久，请保持连接器运行后重新提交。',
        network: '本地 Codex 作品分析时网络连接中断，请确认网络后重新提交。',
        login:
          '本地 Codex 登录已失效，请在连接器电脑运行 codex login 后重新提交。',
        quota: '本地 Codex 使用额度不足或请求受限，请稍后重新提交。',
        codex: '本地 Codex 未完成分析，请检查登录、网络或使用额度后重新提交。',
      };
      error =
        messages[typeof failure === 'string' ? failure : ''] || messages.codex;
    } else {
      try {
        const storedInput = JSON.parse(String(job.input)) as unknown;
        report = JSON.stringify(
          job.kind === 'resume'
            ? validateResumeReading(result, validateResumeInput(storedInput), {
                conciseQuestions: true,
              })
            : job.kind === 'written-test'
              ? validateWrittenTestSupplement(
                  result,
                  validateWrittenTestSupplementInput(storedInput),
                  { conciseQuestions: true },
                )
              : job.kind === 'work-sample'
                ? validateStoredWorkSampleResult(result, storedInput)
                : job.kind === 'outline'
                  ? validateOutlineRegenerationResult(
                      result,
                      validateOutlineRegenerationInput(storedInput),
                    )
                  : job.kind === 'follow-up-outline'
                    ? validateFollowUpOutlineResult(
                        result,
                        validateFollowUpOutlineInput(storedInput),
                      )
                  : validateReport(result, validateInput(storedInput)),
        );
      } catch (validationError) {
        validationFeedback =
          validationError instanceof Error
            ? validationError.message.slice(0, 1000)
            : '返回结果未通过校验。';
        error = '评估引用或结构校验失败，请核实后重新提交。';
      }
    }
    if (
      !failed &&
      error &&
      validationFeedback &&
      executionProtocol >= SERVER_DRIVEN_EXECUTION_PROTOCOL &&
      Number(job.attempt || 1) < 2
    ) {
      const attempt = Number(job.attempt || 1) + 1;
      this.db
        .prepare(
          'UPDATE jobs SET attempt=?,feedback=?,until=?,updated=? WHERE id=?',
        )
        .run(
          attempt,
          validationFeedback,
          this.now() + 60000,
          this.now(),
          id,
        );
      return {
        accepted: false,
        retry: {
          execution: executionContractFor(
            job.kind as JobKind,
            JSON.parse(String(job.input)),
            { attempt, feedback: validationFeedback },
          ),
        },
      };
    }
    if (!error && job.kind === 'outline' && !job.scope) {
      report = null;
      error = '旧版提纲任务缺少面试记录范围，请重新提交。';
    }
    if (
      !error &&
      job.kind === 'outline' &&
      this.db
        .prepare('SELECT 1 FROM outline_completions WHERE user=? AND scope=?')
        .get(job.user, job.scope)
    ) {
      report = null;
      error = '当前面试记录已有成功提纲，本次重复结果未应用。';
    }
    let resultDisposition: 'applied' | 'pending' | null = null;
    if (!error && report && job.interviewId && job.sourceHash) {
      const parsed = JSON.parse(report) as unknown;
      const current = this.interviews.get(
        String(job.user),
        String(job.interviewId),
        true,
      );
      const currentSourceHash = hash(
        JSON.stringify(
          interviewJobSource(current.record, job.kind as JobKind),
        ),
      );
      if (current.deletedAt === null && currentSourceHash === job.sourceHash) {
        this.interviews.applyJobResult(
          String(job.user),
          String(job.interviewId),
          String(job.id),
          job.kind as JobKind,
          parsed,
        );
        resultDisposition = 'applied';
      } else {
        this.interviews.savePendingResult(
          String(job.user),
          String(job.interviewId),
          String(job.id),
          String(job.kind),
          Number(job.interviewRevision),
          parsed,
        );
        resultDisposition = 'pending';
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!error && job.kind === 'outline') {
        const completion = this.db
          .prepare(
            'INSERT OR IGNORE INTO outline_completions(user,scope,job,inputHash,completed) VALUES(?,?,?,?,?)',
          )
          .run(job.user, job.scope, job.id, job.inputHash, this.now());
        if (completion.changes === 0) {
          report = null;
          error = '当前面试记录已有成功提纲，本次重复结果未应用。';
        }
      }
      this.db
        .prepare(
          'UPDATE jobs SET state=?,report=?,error=?,resultDisposition=?,input=NULL,updated=? WHERE id=?',
        )
        .run(
          error ? 'failed' : 'completed',
          report,
          error,
          resultDisposition,
          this.now(),
          id,
        );
      this.db.exec('COMMIT');
    } catch (finishError) {
      this.db.exec('ROLLBACK');
      throw finishError;
    }
    return { accepted: true };
  }
}
