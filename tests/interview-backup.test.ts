import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { QueueStore } from '../server/queue/store.ts';
import { createInterviewBackup } from '../server/interviews/backup.ts';

void test('WAL database backup is verified and retention stays inside its directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'interview-backup-'));
  const databasePath = join(root, 'queue.sqlite');
  const backupDirectory = join(root, 'backups');
  const store = new QueueStore(databasePath);
  try {
    const user = store.createUser('alice', 'password-alice-123').id;
    store.interviews.put(user, 'record-backup-123', 0, 'mutation-backup-create', {
      id: 'record-backup-123',
      createdAt: 1,
      updatedAt: 2,
      candidate: '备份候选人',
      role: 'AI 产品经理',
      requirements: '岗位要求',
      dimensionText: '自驱力',
      focus: '自驱力',
      resumeText: '简历正文',
      resumeName: 'resume.txt',
      resumeReading: null,
      transcript: '面试记录',
      reviewed: true,
      report: null,
      conclusion: '',
      confirmed: false,
    });
    for (let index = 0; index < 18; index++) {
      await createInterviewBackup({
        database: databasePath,
        directory: backupDirectory,
        now: new Date(Date.UTC(2026, 0, 1 + index * 7)),
      });
    }
    const names = await readdir(backupDirectory);
    assert.equal(
      names.filter((name) => /^interview-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).length,
      14,
    );
    assert.equal(
      names.filter((name) => name.startsWith('interview-week-')).length,
      8,
    );
    const latest = names.filter((name) => /^interview-\d{4}-/.test(name)).sort().at(-1)!;
    const restored = new DatabaseSync(join(backupDirectory, latest), { readOnly: true });
    try {
      const check = restored.prepare('PRAGMA quick_check').get() as Record<string, unknown>;
      assert.ok(Object.values(check).includes('ok'));
      const row = restored
        .prepare('SELECT content FROM interviews WHERE user=? AND id=?')
        .get(user, 'record-backup-123') as { content: string };
      assert.equal(JSON.parse(row.content).candidate, '备份候选人');
      assert.equal(
        Number(
          (
            restored
              .prepare('SELECT COUNT(*) AS count FROM interview_versions')
              .get() as { count: number }
          ).count,
        ),
        1,
      );
    } finally {
      restored.close();
    }
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
