import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { QueueStore } from '../server/queue/store.ts';

void test('account CLI adds, lists, disables, enables and resets an interviewer account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-accounts-test-'));
  const database = join(directory, 'queue.sqlite');
  const root = resolve(import.meta.dirname, '..');
  const run = (args: string[], input = '') =>
    spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'server/accounts.ts', ...args],
      {
        cwd: root,
        env: { ...process.env, INTERVIEW_DATA_DIR: directory },
        input,
        encoding: 'utf8',
      },
    );
  try {
    const seed = new QueueStore(database);
    seed.createUser('owner', 'owner-password-123');
    seed.close();

    const password = 'interviewer-password-123';
    const added = run(['add', 'interviewer'], `${password}\n${password}\n`);
    assert.equal(added.status, 0, added.stderr);
    assert.match(added.stdout, /账号已创建：interviewer/);
    assert.doesNotMatch(added.stdout + added.stderr, new RegExp(password));

    const listed = run(['list']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /interviewer\s+启用/);
    assert.match(listed.stdout, /owner\s+启用/);

    assert.equal(run(['disable', 'interviewer']).status, 0);
    let store = new QueueStore(database);
    assert.throws(() => store.login('interviewer', password));
    store.close();

    assert.equal(run(['enable', 'interviewer']).status, 0);
    const replacement = 'replacement-password-123';
    const reset = run(
      ['reset-password', 'interviewer'],
      `${replacement}\n${replacement}\n`,
    );
    assert.equal(reset.status, 0, reset.stderr);
    assert.doesNotMatch(reset.stdout + reset.stderr, new RegExp(replacement));
    store = new QueueStore(database);
    assert.ok(store.login('interviewer', replacement));
    assert.throws(() => store.login('interviewer', password));
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('account CLI refuses a missing database and incomplete password confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-accounts-test-'));
  const root = resolve(import.meta.dirname, '..');
  const run = (args: string[], input = '') =>
    spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'server/accounts.ts', ...args],
      {
        cwd: root,
        env: { ...process.env, INTERVIEW_DATA_DIR: directory },
        input,
        encoding: 'utf8',
      },
    );
  try {
    const missing = run(['list']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /数据库不存在/);

    const store = new QueueStore(join(directory, 'queue.sqlite'));
    store.createUser('owner', 'owner-password-123');
    store.close();
    const mismatch = run(
      ['add', 'interviewer'],
      'interviewer-password-123\ndifferent-password-123\n',
    );
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /两次输入的密码不一致/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
