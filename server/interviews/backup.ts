import { chmod, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type InterviewBackupOptions = {
  database: string;
  directory: string;
  now?: Date;
  dailyKeep?: number;
  weeklyKeep?: number;
};

function isoWeek(date: Date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function verify(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare('PRAGMA quick_check').get() as Record<string, unknown>;
    if (!row || !Object.values(row).includes('ok'))
      throw new Error('SQLite quick_check 未通过。');
  } finally {
    database.close();
  }
}

async function rotate(directory: string, pattern: RegExp, keep: number) {
  const names = (await readdir(directory))
    .filter((name) => pattern.test(name))
    .sort()
    .reverse();
  for (const name of names.slice(keep)) await unlink(join(directory, name));
}

export async function createInterviewBackup(options: InterviewBackupOptions) {
  const databasePath = resolve(options.database);
  const directory = resolve(options.directory);
  const now = options.now || new Date();
  const dailyKeep = options.dailyKeep ?? 14;
  const weeklyKeep = options.weeklyKeep ?? 8;
  if (dailyKeep < 1 || weeklyKeep < 1)
    throw new Error('备份保留数量必须大于零。');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const date = now.toISOString().slice(0, 10);
  const dailyName = `interview-${date}.sqlite`;
  const dailyPath = join(directory, dailyName);
  const temporaryPath = join(
    directory,
    `.interview-${date}-${randomUUID()}.tmp`,
  );
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    await backup(source, temporaryPath);
  } finally {
    source.close();
  }
  try {
    await chmod(temporaryPath, 0o600);
    await verify(temporaryPath);
    await rename(temporaryPath, dailyPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  const weeklyName = `interview-week-${isoWeek(now)}.sqlite`;
  const weeklyPath = join(directory, weeklyName);
  const weeklySource = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const weeklyTemporary = join(directory, `.${basename(weeklyName)}-${randomUUID()}.tmp`);
    try {
      await backup(weeklySource, weeklyTemporary);
      await chmod(weeklyTemporary, 0o600);
      await verify(weeklyTemporary);
      await rename(weeklyTemporary, weeklyPath);
    } catch (error) {
      await unlink(weeklyTemporary).catch(() => {});
      throw error;
    }
  } finally {
    weeklySource.close();
  }

  await rotate(directory, /^interview-\d{4}-\d{2}-\d{2}\.sqlite$/, dailyKeep);
  await rotate(directory, /^interview-week-\d{4}-W\d{2}\.sqlite$/, weeklyKeep);
  return { dailyPath, weeklyPath };
}

