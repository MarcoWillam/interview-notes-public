import { createInterviewBackup } from './backup.ts';

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const database = argument('database');
const directory = argument('directory');
if (!database || !directory) {
  console.error('用法：npm run backup:interviews -- --database /path/queue.sqlite --directory /path/backups');
  process.exitCode = 2;
} else {
  const result = await createInterviewBackup({ database, directory });
  console.log(`备份完成：${result.dailyPath}`);
}
