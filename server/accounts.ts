import { access } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { QueueStore } from './queue/store.ts';

if (process.env.INTERVIEW_ENV_FILE)
  process.loadEnvFile(process.env.INTERVIEW_ENV_FILE);

const [command, username, ...extra] = process.argv.slice(2);
const usage =
  '用法：npm run accounts -- list | add <账号> | reset-password <账号> | disable <账号> | enable <账号>';

let pipedSecrets: string[] | undefined;
async function readSecret(label: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (!pipedSecrets) {
      let value = '';
      for await (const chunk of process.stdin) value += String(chunk);
      pipedSecrets = value.split(/\r?\n/);
    }
    return pipedSecrets.shift() || '';
  }
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  process.stdout.write(label);
  muted = true;
  try {
    return await prompt.question('');
  } finally {
    muted = false;
    prompt.close();
    process.stdout.write('\n');
  }
}

async function confirmedPassword() {
  const password = await readSecret('输入密码（12–200 字）：');
  const confirmation = await readSecret('再次输入密码：');
  if (password !== confirmation) throw new Error('两次输入的密码不一致。');
  return password;
}

async function main() {
  if (
    !command ||
    extra.length ||
    (command === 'list' ? username !== undefined : !username) ||
    !['list', 'add', 'reset-password', 'disable', 'enable'].includes(command)
  )
    throw new Error(usage);
  const dataDir = resolve(process.env.INTERVIEW_DATA_DIR || '.local/server');
  const database = join(dataDir, 'queue.sqlite');
  try {
    await access(database);
  } catch {
    throw new Error(`数据库不存在：${database}。请先启动正式服务。`);
  }
  const store = new QueueStore(database);
  try {
    if (command === 'list') {
      const users = store.listUsers();
      if (!users.length) console.log('暂无账号。');
      else
        users.forEach((user) =>
          console.log(`${user.username}\t${user.active ? '启用' : '停用'}`),
        );
      return;
    }
    if (command === 'add') {
      store.createUser(username, await confirmedPassword());
      console.log(`账号已创建：${username}`);
      return;
    }
    if (command === 'reset-password') {
      store.resetUserPassword(username, await confirmedPassword());
      console.log(`密码已更新：${username}。请重新登录并配对电脑。`);
      return;
    }
    const active = command === 'enable';
    store.setUserActive(username, active);
    console.log(
      active
        ? `账号已启用：${username}。请重新登录并配对电脑。`
        : `账号已停用：${username}。网页登录和电脑连接已失效。`,
    );
  } finally {
    store.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : '账号管理失败。');
  process.exitCode = 1;
}
