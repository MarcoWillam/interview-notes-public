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
export class QueueStore {
  db: DatabaseSync;
  now: () => number;
  constructor(path: string, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pairs(hash TEXT PRIMARY KEY,user TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user TEXT NOT NULL,name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,seen INTEGER NOT NULL,ready INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user TEXT NOT NULL,client TEXT NOT NULL,inputHash TEXT NOT NULL,label TEXT NOT NULL,state TEXT NOT NULL,input TEXT,report TEXT,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,device TEXT,lease TEXT,until INTEGER,kind TEXT NOT NULL DEFAULT 'interview',queued INTEGER,started INTEGER,UNIQUE(user,client));
      CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(user,created);
      CREATE INDEX IF NOT EXISTS jobs_claim ON jobs(user,state,created);
      CREATE INDEX IF NOT EXISTS devices_owner ON devices(user);`);
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
    this.db.exec('UPDATE jobs SET queued=created WHERE queued IS NULL');
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
      !this.db
        .prepare('SELECT 1 FROM users WHERE id=? AND active=1')
        .get(user)
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
      !this.db
        .prepare('SELECT 1 FROM users WHERE id=? AND active=1')
        .get(user)
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
  redeem(code: string, name: string) {
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
          'SELECT id,name,seen,ready FROM devices WHERE user=? AND revoked=0',
        )
        .all(user) as Row[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      lastSeen: row.seen,
      online: Number(row.seen) > this.now() - 45000,
      ready: !!row.ready,
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
  }
  sweep() {
    const now = this.now();
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
  }
  submit(
    user: string,
    client: string,
    label: string,
    value: unknown,
    kind: 'interview' | 'resume' = 'interview',
  ) {
    this.sweep();
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(client))
      throw new QueueError('任务标识无效。');
    const input = JSON.stringify(
        kind === 'resume' ? validateResumeInput(value) : validateInput(value),
      ),
      digest = hash(kind + input),
      safeLabel = label.slice(0, 100) || '未命名面试';
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
    const active = this.db
      .prepare(
        "SELECT id FROM jobs WHERE user=? AND kind=? AND inputHash=? AND label=? AND state IN ('queued','running','paused') ORDER BY created LIMIT 1",
      )
      .get(user, kind, digest, safeLabel) as Row | undefined;
    if (active) return this.get(user, String(active.id));
    const count = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE user=? AND state IN ('queued','running')",
      )
      .get(user) as Row;
    if (Number(count.n) >= 20)
      throw new QueueError('待处理任务已达 20 项，请先处理或取消。', 429);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO jobs(id,user,client,inputHash,label,state,input,created,updated,kind,queued) VALUES(?,?,?,?,?,'queued',?,?,?,?,?)",
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
      );
    return this.get(user, id);
  }
  get(user: string, id: string) {
    this.sweep();
    const row = this.db
      .prepare(
        'SELECT id,label,kind,state,report,error,created,updated,queued,started FROM jobs WHERE user=? AND id=?',
      )
      .get(user, id) as Row | undefined;
    if (!row) throw new QueueError('任务不存在。', 404);
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
        row.state === 'queued' ? this.queuePosition(user, String(row.id)) : null,
      error: row.error,
      report: row.report ? (JSON.parse(String(row.report)) as unknown) : null,
    };
  }
  private queuePosition(user: string, id: string) {
    const rows = this.db
      .prepare(
        "SELECT id FROM jobs WHERE user=? AND state='queued' ORDER BY CASE WHEN kind='resume' THEN 0 ELSE 1 END,queued,created,rowid",
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
          'SELECT id,label,kind,state,error,created,updated,queued,started FROM jobs WHERE user=? ORDER BY created DESC LIMIT 100',
        )
        .all(user) as Row[]
    ).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      kind: String(row.kind),
      state: String(row.state),
      created: Number(row.created),
      updated: Number(row.updated),
      queuedAt: Number(row.queued),
      startedAt: row.started === null ? null : Number(row.started),
      position:
        row.state === 'queued' ? this.queuePosition(user, String(row.id)) : null,
      error: row.error,
    }));
  }
  action(
    user: string,
    id: string,
    action: 'pause' | 'resume' | 'stop',
  ) {
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
              "UPDATE jobs SET state='paused',device=NULL,lease=NULL,until=NULL,updated=? WHERE user=? AND id=?",
            )
            .run(this.now(), user, id);
        }
      } else if (action === 'resume') {
        if (state !== 'queued') {
          if (state !== 'paused')
            throw new QueueError('当前任务不能恢复。', 409);
          this.db
            .prepare(
              "UPDATE jobs SET state='queued',queued=?,started=NULL,device=NULL,lease=NULL,until=NULL,updated=? WHERE user=? AND id=?",
            )
            .run(this.now(), this.now(), user, id);
        }
      } else if (state !== 'cancelled') {
        if (!['queued', 'running', 'paused'].includes(state))
          throw new QueueError('当前任务不能停止。', 409);
        this.db
          .prepare(
            "UPDATE jobs SET state='cancelled',input=NULL,report=NULL,error=NULL,device=NULL,lease=NULL,until=NULL,started=NULL,updated=? WHERE user=? AND id=?",
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
    kinds: ('interview' | 'resume')[] = ['interview'],
  ) {
    this.sweep();
    const device = this.device(secret);
    this.db
      .prepare('UPDATE devices SET seen=?,ready=? WHERE id=?')
      .run(this.now(), ready ? 1 : 0, device.id);
    if (!ready) return null;
    const lease = token();
    const row = this.db
      .prepare(
        `UPDATE jobs SET state='running',device=?,lease=?,until=?,updated=?,started=? WHERE id=(SELECT id FROM jobs WHERE user=? AND state='queued' AND (kind='interview' OR (kind='resume' AND ?=1)) AND NOT EXISTS(SELECT 1 FROM jobs WHERE device=? AND state='running') ORDER BY CASE WHEN kind='resume' THEN 0 ELSE 1 END,queued,created,rowid LIMIT 1) RETURNING id,input,kind`,
      )
      .get(
        device.id,
        lease,
        this.now() + 60000,
        this.now(),
        this.now(),
        device.user,
        kinds.includes('resume') ? 1 : 0,
        device.id,
      ) as Row | undefined;
    return row
      ? {
          id: String(row.id),
          lease,
          kind: String(row.kind),
          input: JSON.parse(String(row.input)) as unknown,
        }
      : null;
  }
  heartbeat(secret: string, id: string, lease: string) {
    this.sweep();
    const device = this.device(secret);
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
  ) {
    this.sweep();
    const device = this.device(secret);
    const job = this.db
      .prepare(
        'SELECT * FROM jobs WHERE id=? AND user=?',
      )
      .get(id, device.user) as Row | undefined;
    if (!job) throw new QueueError('任务不属于此连接器。', 403);
    if (job.state === 'completed' || job.state === 'failed') {
      if (job.device !== device.id || job.lease !== lease)
        throw new QueueError('任务不属于此连接器。', 403);
      return { accepted: true };
    }
    if (job.state !== 'running') return { accepted: false };
    if (job.device !== device.id || job.lease !== lease)
      throw new QueueError('任务不属于此连接器。', 403);
    let report: string | null = null,
      error: string | null = null;
    if (failed)
      error = '本地 Codex 未完成分析，请检查登录、网络或使用额度后重新提交。';
    else {
      try {
        report = JSON.stringify(
          job.kind === 'resume'
            ? validateResumeReading(
                result,
                validateResumeInput(JSON.parse(String(job.input))),
              )
            : validateReport(
                result,
                validateInput(JSON.parse(String(job.input))),
              ),
        );
      } catch {
        error = '评估引用或结构校验失败，请核实后重新提交。';
      }
    }
    this.db
      .prepare(
        'UPDATE jobs SET state=?,report=?,error=?,input=NULL,updated=? WHERE id=?',
      )
      .run(error ? 'failed' : 'completed', report, error, this.now(), id);
    return { accepted: true };
  }
}
