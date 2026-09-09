import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueStore } from '../server/queue/store.ts';
import { queueApi } from '../server/queue/api.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';
const resumeInput = {
  role: '产品经理',
  requirements: '用户研究与需求分析',
  dimensionText: '需求分析、沟通协作',
  focus: '主动发现问题并推进解决',
  scoringGuidance: '根据具体行动和结果判断证据充分性',
  reportRequirements: '列明待核实内容',
  resumeText: '姓名：张三。示例大学毕业。我访谈了五位用户。',
  hasWrittenTest: false,
};
const reading = {
  candidateName: '张三',
  candidateNameEvidence: '姓名：张三。',
  summary: '简历自述，待面试核实。',
  sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
    name,
    items:
      name === '教育背景'
        ? [{ text: '示例大学毕业', evidence: '示例大学毕业。' }]
        : [],
  })),
  interviewQuestions: Array.from({ length: 6 }, (_, index) => ({
    question: `请描述第 ${index + 1} 次主动发现用户问题并推进解决的具体经历。`,
    dimensions: [index % 2 === 0 ? '需求分析' : '沟通协作'],
    reason: '核实自驱力、具体行动与结果。',
    resumeEvidence: index === 5 ? null : '我访谈了五位用户。',
    questionSource: index === 5 ? 'role' : 'resume',
    listenFor: ['个人行动', '结果与反思'],
    probes: ['你如何验证效果？'],
  })),
  followUps: ['请补充项目时间范围。'],
};
const input = {
  role: '产品经理',
  requirements: '用户调研',
  dimensions: ['需求分析'],
  transcript: '候选人：我访谈了五位用户。',
};
const report = {
  summary: '有调研经验。',
  dimensions: [
    {
      name: '需求分析',
      score: 3,
      assessment: '有访谈经历。',
      evidence: ['我访谈了五位用户。'],
    },
  ],
  followUps: [],
};
const setup = () => {
  let now = 1000000;
  const s = new QueueStore(':memory:', () => now);
  const a = s.createUser('alice', 'password-alice-123').id,
    b = s.createUser('bob', 'password-bob-123').id;
  return {
    s,
    a,
    b,
    tick: (n: number) => {
      now += n;
    },
  };
};
void test('account administration lists users and rejects duplicate usernames', () => {
  const { s } = setup();
  try {
    assert.deepEqual(s.listUsers(), [
      { username: 'alice', active: true },
      { username: 'bob', active: true },
    ]);
    assert.throws(
      () => s.createUser('alice', 'another-password-123'),
      /账号已存在/,
    );
  } finally {
    s.close();
  }
});
void test('legacy user tables gain active status without changing existing login', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-user-migration-'));
  const file = join(directory, 'queue.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    const salt = 'legacy-salt';
    legacy.exec(
      'CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL)',
    );
    legacy
      .prepare('INSERT INTO users VALUES(?,?,?,?)')
      .run(
        'legacy-id',
        'legacy-user',
        salt,
        Buffer.from(scryptSync('legacy-password-123', salt, 32)).toString('hex'),
      );
    legacy.close();

    const migrated = new QueueStore(file);
    assert.deepEqual(migrated.listUsers(), [
      { username: 'legacy-user', active: true },
    ]);
    assert.ok(migrated.login('legacy-user', 'legacy-password-123'));
    migrated.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
void test('disabling an account revokes every session, connector and unfinished job', () => {
  const { s, a } = setup();
  try {
    const session = s.newSession(a);
    const device = s.redeem(s.pairing(a).code, 'Alice 的电脑');
    const running = s.submit(a, 'disable-running', '进行中', input);
    const queued = s.submit(a, 'disable-queued', '等待中', input);
    assert.equal(s.claim(device.token, true)?.id, running.id);

    s.setUserActive('alice', false);

    assert.equal(s.session(session), undefined);
    assert.throws(() => s.device(device.token), /连接器授权已失效/);
    assert.throws(() => s.login('alice', 'password-alice-123'));
    assert.equal(s.get(a, running.id).state, 'failed');
    assert.equal(s.get(a, queued.id).state, 'failed');
    assert.equal(
      s.db.prepare('SELECT input FROM jobs WHERE user=? AND input IS NOT NULL').get(a),
      undefined,
    );
    assert.deepEqual(s.listUsers()[0], { username: 'alice', active: false });

    s.setUserActive('alice', true);
    assert.ok(s.login('alice', 'password-alice-123'));
    assert.throws(() => s.device(device.token), /连接器授权已失效/);
  } finally {
    s.close();
  }
});
void test('resetting a password revokes access while preserving queued work', () => {
  const { s, a } = setup();
  try {
    const session = s.newSession(a);
    const device = s.redeem(s.pairing(a).code, 'Alice 的电脑');
    const running = s.submit(a, 'reset-running', '进行中', input);
    const queued = s.submit(a, 'reset-queued', '等待中', input);
    assert.equal(s.claim(device.token, true)?.id, running.id);

    s.resetUserPassword('alice', 'new-password-alice-123');

    assert.equal(s.session(session), undefined);
    assert.throws(() => s.device(device.token), /连接器授权已失效/);
    assert.throws(() => s.login('alice', 'password-alice-123'));
    assert.ok(s.login('alice', 'new-password-alice-123'));
    assert.equal(s.get(a, running.id).state, 'failed');
    assert.equal(s.get(a, queued.id).state, 'queued');
  } finally {
    s.close();
  }
});
void test('stale account tabs cannot submit, pair, list devices or log out a different cookie account', async () => {
  const { s, a, b } = setup();
  try {
    const api = queueApi(s, { origin: 'https://interview.example' });
    const cookie = 'interview_session=' + s.newSession(b);
    for (const [path, method, body] of [
      ['/api/jobs', 'POST', { client: 'stale-123', label: 'A 的材料', input }],
      ['/api/pair', 'POST', {}],
      ['/api/devices', 'GET', null],
      ['/api/logout', 'POST', {}],
    ] as const) {
      const response = await api(
        new Request('https://interview.example' + path, {
          method,
          headers: {
            Origin: 'https://interview.example',
            Cookie: cookie,
            'X-Interview-Account': a,
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
      assert.equal(response.status, 409);
    }
    assert.equal(s.list(b).length, 0);
    assert.ok(s.session(cookie.slice(18)));
  } finally {
    s.close();
  }
});
void test('queued work survives a database restart and separate connections cannot claim it twice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-persist-test-'));
  const file = join(directory, 'queue.sqlite');
  let first: QueueStore | undefined, second: QueueStore | undefined;
  try {
    first = new QueueStore(file);
    const user = first.createUser('testuser', 'test-password-123').id;
    const job = first.submit(user, 'persist-123', '面试', input);
    const a = first.redeem(first.pairing(user).code, '电脑 A');
    const b = first.redeem(first.pairing(user).code, '电脑 B');
    first.close();
    first = undefined;
    first = new QueueStore(file);
    second = new QueueStore(file);
    assert.equal(first.get(user, job.id).state, 'queued');
    assert.equal(first.claim(a.token, true)?.id, job.id);
    assert.equal(second.claim(b.token, true), null);
  } finally {
    first?.close();
    second?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('heartbeats extend ownership and queued material expires after 24 hours', () => {
  const { s, a, tick } = setup();
  try {
    const d = s.redeem(s.pairing(a).code, '电脑');
    const job = s.submit(a, 'lease-123', '面试', input);
    const claim = s.claim(d.token, true)!;
    tick(50000);
    assert.equal(s.heartbeat(d.token, job.id, claim.lease).active, true);
    tick(50000);
    assert.equal(s.get(a, job.id).state, 'running');
    s.cancel(a, job.id);
    const queued = s.submit(a, 'expire-123', '离线面试', input);
    tick(86400001);
    assert.equal(s.get(a, queued.id).state, 'failed');
    assert.equal(
      s.db.prepare('SELECT input FROM jobs WHERE id=?').get(queued.id)?.input,
      null,
    );
  } finally {
    s.close();
  }
});
void test('pairing is single-use, expiring, revocable and bound to an account', () => {
  const { s, a, b, tick } = setup();
  try {
    const code = s.pairing(a).code;
    const d = s.redeem(code, '电脑');
    assert.equal(s.device(d.token).user, a);
    assert.throws(() => s.redeem(code, '再用'));
    assert.equal(s.devices(b).length, 0);
    const expired = s.pairing(b).code;
    tick(600001);
    assert.throws(() => s.redeem(expired, '电脑'));
    s.revoke(a, d.id);
    assert.throws(() => s.device(d.token));
  } finally {
    s.close();
  }
});
void test('jobs are isolated, idempotent and claimed once', () => {
  const { s, a, b } = setup();
  try {
    const job = s.submit(a, 'request-123', '面试', input);
    assert.equal(s.submit(a, 'request-123', '面试', input).id, job.id);
    assert.throws(() =>
      s.submit(a, 'request-123', '面试', { ...input, role: '其他' }),
    );
    assert.throws(() => s.get(b, String(job.id)));
    const da = s.redeem(s.pairing(a).code, 'A'),
      db = s.redeem(s.pairing(b).code, 'B');
    assert.equal(s.claim(db.token, true), null);
    const claim = s.claim(da.token, true)!;
    assert.equal(claim.id, job.id);
    assert.equal(s.claim(da.token, true), null);
    assert.throws(() => s.finish(db.token, claim.id, claim.lease, report));
    s.finish(da.token, claim.id, claim.lease, report);
    assert.deepEqual(s.get(a, claim.id).report, report);
    assert.equal(
      s.db.prepare('SELECT input FROM jobs WHERE id=?').get(claim.id)?.input,
      null,
    );
    assert.deepEqual(s.finish(da.token, claim.id, claim.lease, report), {
      accepted: true,
    });
  } finally {
    s.close();
  }
});
void test('same active material and label reuse one task across page submissions', () => {
  const { s, a } = setup();
  try {
    const first = s.submit(a, 'original-123', '张三', input);
    const duplicate = s.submit(a, 'reloaded-123', '张三', input);
    const other = s.submit(a, 'different-123', '李四', input);
    assert.equal(duplicate.id, first.id);
    assert.notEqual(other.id, first.id);
    assert.equal(s.list(a).length, 2);

    s.cancel(a, first.id);
    const retried = s.submit(a, 'after-stop-123', '张三', input);
    assert.notEqual(retried.id, first.id);
  } finally {
    s.close();
  }
});
void test('running work can pause, reject its old lease, and resume from the queue', () => {
  const { s, a, tick } = setup();
  try {
    const d = s.redeem(s.pairing(a).code, '电脑');
    const job = s.submit(a, 'pause-123', '张三', input);
    const claim = s.claim(d.token, true)!;
    assert.equal(s.get(a, job.id).startedAt, 1000000);

    tick(5000);
    const paused = s.action(a, job.id, 'pause');
    assert.equal(paused.state, 'paused');
    assert.equal(paused.startedAt, 1000000);
    assert.equal(s.heartbeat(d.token, job.id, claim.lease).active, false);
    assert.equal(s.finish(d.token, job.id, claim.lease, report).accepted, false);

    tick(5000);
    const resumed = s.action(a, job.id, 'resume');
    assert.equal(resumed.state, 'queued');
    assert.equal(resumed.queuedAt, 1010000);
    assert.equal(resumed.startedAt, null);
    assert.equal(s.action(a, job.id, 'resume').state, 'queued');
  } finally {
    s.close();
  }
});
void test('stop clears queued material and task ownership irreversibly', () => {
  const { s, a } = setup();
  try {
    const job = s.submit(a, 'stop-123', '张三', input);
    const stopped = s.action(a, job.id, 'stop');
    assert.equal(stopped.state, 'cancelled');
    assert.equal(s.action(a, job.id, 'stop').state, 'cancelled');
    const row = s.db
      .prepare(
        'SELECT input,report,error,device,lease,until,started FROM jobs WHERE id=?',
      )
      .get(job.id) as Record<string, unknown>;
    assert.deepEqual({ ...row }, {
      input: null,
      report: null,
      error: null,
      device: null,
      lease: null,
      until: null,
      started: null,
    });
    assert.throws(() => s.action(a, job.id, 'resume'), /不能恢复/);
  } finally {
    s.close();
  }
});
void test('resume preparation is claimed before older unstarted assessments', () => {
  const { s, a, tick } = setup();
  try {
    const d = s.redeem(s.pairing(a).code, '电脑');
    const running = s.submit(a, 'running-123', '正在评估', input);
    const first = s.claim(d.token, true, ['interview', 'resume'])!;
    assert.equal(first.id, running.id);
    tick(1);
    const assessment = s.submit(a, 'waiting-123', '等待评估', input);
    tick(1);
    const resume = s.submit(a, 'resume-123', '准备面试', resumeInput, 'resume');
    assert.equal(s.get(a, resume.id).position, 1);
    assert.equal(s.get(a, assessment.id).position, 2);
    s.finish(d.token, first.id, first.lease, report);

    const next = s.claim(d.token, true, ['interview', 'resume'])!;
    assert.equal(next.id, resume.id);
  } finally {
    s.close();
  }
});
void test('legacy jobs gain queue timing without losing their state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-job-migration-'));
  const file = join(directory, 'queue.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE jobs(id TEXT PRIMARY KEY,user TEXT NOT NULL,client TEXT NOT NULL,inputHash TEXT NOT NULL,label TEXT NOT NULL,state TEXT NOT NULL,input TEXT,report TEXT,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,device TEXT,lease TEXT,until INTEGER,kind TEXT NOT NULL DEFAULT 'interview',UNIQUE(user,client));`);
    legacy
      .prepare(
        "INSERT INTO jobs(id,user,client,inputHash,label,state,input,created,updated,kind) VALUES('job','user','client','hash','历史任务','queued','{}',100,200,'interview')",
      )
      .run();
    legacy.close();

    const migrated = new QueueStore(file, () => 300);
    assert.equal(migrated.get('user', 'job').state, 'queued');
    assert.equal(migrated.get('user', 'job').queuedAt, 100);
    assert.equal(migrated.get('user', 'job').startedAt, null);
    migrated.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
void test('cancelled and expired leases cannot overwrite a result or run twice automatically', () => {
  const { s, a, tick } = setup();
  try {
    const d = s.redeem(s.pairing(a).code, '电脑');
    const first = s.submit(a, 'request-123', '面试', input);
    const c = s.claim(d.token, true)!;
    s.cancel(a, String(first.id));
    assert.equal(s.heartbeat(d.token, c.id, c.lease).active, false);
    assert.equal(s.finish(d.token, c.id, c.lease, report).accepted, false);
    s.submit(a, 'request-456', '面试', input);
    const next = s.claim(d.token, true)!;
    tick(60001);
    assert.equal(s.heartbeat(d.token, next.id, next.lease).active, false);
    assert.equal(s.get(a, next.id).state, 'failed');
    assert.equal(s.claim(d.token, true), null);
  } finally {
    s.close();
  }
});
void test('fabricated report is rejected, sensitive input cleared and retention applied', () => {
  const { s, a, tick } = setup();
  try {
    const d = s.redeem(s.pairing(a).code, '电脑');
    s.submit(a, 'request-123', '面试', input);
    const c = s.claim(d.token, true)!;
    s.finish(d.token, c.id, c.lease, {
      ...report,
      dimensions: [{ ...report.dimensions[0], evidence: ['虚构'] }],
    });
    assert.equal(s.get(a, c.id).state, 'failed');
    tick(7 * 86400000 + 1);
    assert.throws(() => s.get(a, c.id));
  } finally {
    s.close();
  }
});
void test('API requires session and same-origin writes, connector tokens cannot log into the website', async () => {
  const { s, a } = setup();
  try {
    const api = queueApi(s, { origin: 'https://interview.example' });
    const call = (path: string, method = 'GET', body?: unknown, cookie = '') =>
      api(
        new Request('https://interview.example' + path, {
          method,
          headers: {
            Origin: 'https://interview.example',
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Interview-Account': a,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    assert.equal((await call('/api/jobs')).status, 401);
    const login = await call('/api/login', 'POST', {
      username: 'alice',
      password: 'password-alice-123',
    });
    assert.match(login.headers.get('set-cookie')!, /HttpOnly.*Secure/);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal(
      (
        await call(
          '/api/jobs',
          'POST',
          { client: 'request-123', label: '测试', input },
          cookie,
        )
      ).status,
      202,
    );
    assert.equal(
      (
        await api(
          new Request('https://interview.example/api/jobs', {
            method: 'POST',
            headers: { Origin: 'https://evil.example', Cookie: cookie },
          }),
        )
      ).status,
      403,
    );
    const d = s.redeem(s.pairing(a).code, '电脑');
    assert.equal(
      (
        await call(
          '/api/jobs',
          'GET',
          undefined,
          'interview_session=' + d.token,
        )
      ).status,
      401,
    );
  } finally {
    s.close();
  }
});
void test('only owner can create interviewer accounts from the web workspace', async () => {
  const store = new QueueStore(':memory:');
  try {
    const owner = store.createUser('owner', 'owner-password-123').id;
    const interviewer = store.createUser(
      'interviewer',
      'interviewer-password-123',
    ).id;
    const api = queueApi(store, { origin: 'https://interview.example' });
    const create = (user: string, cookie: string, username: string) =>
      api(
        new Request('https://interview.example/api/accounts', {
          method: 'POST',
          headers: {
            Origin: 'https://interview.example',
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-Interview-Account': user,
          },
          body: JSON.stringify({
            username,
            password: 'new-account-password-123',
          }),
        }),
      );

    const denied = await create(
      interviewer,
      'interview_session=' + store.newSession(interviewer),
      'should-not-exist',
    );
    assert.equal(denied.status, 403);
    assert.equal(store.listUsers().length, 2);

    const created = await create(
      owner,
      'interview_session=' + store.newSession(owner),
      'new-interviewer',
    );
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), {
      user: { username: 'new-interviewer' },
    });
    assert.ok(store.login('new-interviewer', 'new-account-password-123'));
  } finally {
    store.close();
  }
});
void test('resume jobs require an upgraded connector and validate against resume text', () => {
  const { s, a } = setup();
  try {
    const input = {
      ...resumeInput,
      resumeText: `  ${resumeInput.resumeText}  `,
    };
    const job = s.submit(a, 'resume-123', '简历阅读', input, 'resume');
    const d = s.redeem(s.pairing(a).code, '新电脑');
    assert.equal(s.claim(d.token, true), null);
    const claimed = s.claim(d.token, true, ['interview', 'resume'])!;
    assert.equal(claimed.kind, 'resume');
    assert.deepEqual(claimed.input, resumeInput);
    const report = reading;
    s.finish(d.token, claimed.id, claimed.lease, report);
    assert.deepEqual(s.get(a, job.id).report, report);
    assert.equal(s.get(a, job.id).kind, 'resume');
    assert.equal(s.get(a, job.id).state, 'completed');
    const repeated = s.submit(
      a,
      'resume-repeat-123',
      '简历阅读',
      input,
      'resume',
    );
    assert.equal(repeated.id, job.id);
    assert.equal(repeated.state, 'completed');
  } finally {
    s.close();
  }
});

void test('resume finish rejects fabricated question evidence against stored input', () => {
  const { s, a } = setup();
  try {
    const d = s.redeem(s.pairing(a).code, '阅读电脑');
    const job = s.submit(
      a,
      'resume-invalid-123',
      '简历阅读',
      resumeInput,
      'resume',
    );
    const claimed = s.claim(d.token, true, ['resume'])!;
    const invalid = structuredClone(reading);
    invalid.interviewQuestions[0].resumeEvidence = '简历中不存在的项目成果';
    assert.deepEqual(s.finish(d.token, claimed.id, claimed.lease, invalid), {
      accepted: true,
    });
    const result = s.get(a, job.id);
    assert.equal(result.state, 'failed');
    assert.equal(result.report, null);
    assert.match(result.error as string, /引用或结构校验失败/);
    assert.equal(
      s.db.prepare('SELECT input FROM jobs WHERE id=?').get(job.id)?.input,
      null,
    );
  } finally {
    s.close();
  }
});
