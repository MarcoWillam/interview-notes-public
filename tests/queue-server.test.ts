import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
void test('production entry requires login, starts without Codex, and restores queued work after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interview-server-test-'));
  await mkdir(join(directory, 'dist/web'), { recursive: true });
  await writeFile(join(directory, 'dist/web/index.html'), '<h1>test</h1>');
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const origin = 'http://127.0.0.1:' + port;
  let child: ChildProcess | undefined;
  const stop = async () => {
    if (!child) return;
    const current = child;
    child = undefined;
    if (current.exitCode !== null || current.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      current.once('close', () => resolve());
      current.kill('SIGTERM');
    });
  };
  const start = async (password?: string) => {
    child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        fileURLToPath(new URL('../server/start.ts', import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          INTERVIEW_CODEX_BIN: '/does-not-exist',
          INTERVIEW_PUBLIC_ORIGIN: origin,
          INTERVIEW_PORT: String(port),
          INTERVIEW_DATA_DIR: join(directory, 'data'),
          INTERVIEW_ADMIN_USER: 'owner',
          ...(password ? { INTERVIEW_ADMIN_PASSWORD: password } : {}),
        },
        stdio: 'ignore',
      },
    );
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      if (child?.exitCode !== null) throw new Error('server exited');
      try {
        if ((await fetch(origin + '/api/session')).ok) return;
      } catch {
        /* startup */
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('startup timeout');
  };
  try {
    await start('test-password-123');
    assert.deepEqual(await (await fetch(origin + '/api/session')).json(), {
      user: null,
      preview: false,
    });
    const login = await fetch(origin + '/api/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner',
        password: 'test-password-123',
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const identity = (await (
      await fetch(origin + '/api/session', { headers: { Cookie: cookie } })
    ).json()) as { user: { id: string } };
    const headers = {
      Origin: origin,
      Cookie: cookie,
      'X-Interview-Account': identity.user.id,
      'Content-Type': 'application/json',
    };
    const status = (await (
      await fetch(origin + '/api/status', { headers })
    ).json()) as { connected: boolean; devices: unknown[] };
    assert.equal(status.connected, false);
    assert.deepEqual(status.devices, []);
    const input = {
      role: '工程师',
      requirements: '沟通',
      dimensions: ['沟通'],
      transcript: '候选人：我每天同步进展。',
    };
    const submitted = await fetch(origin + '/api/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ client: 'restart-123', label: '虚构面试', input }),
    });
    assert.equal(submitted.status, 202);
    const job = (await submitted.json()) as { id: string };
    await stop();
    await start();
    const restored = (await (
      await fetch(origin + '/api/jobs/' + job.id, { headers })
    ).json()) as { state: string };
    assert.equal(restored.state, 'queued');
    assert.equal(
      (
        await fetch(origin + '/api/logout', {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      200,
    );
    assert.equal((await fetch(origin + '/api/jobs', { headers })).status, 401);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
