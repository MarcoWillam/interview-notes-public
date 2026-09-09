import { QueueStore, QueueError } from './store.ts';
export type QueueConfig = {
  origin: string;
  previewUser?: string;
  trustProxy?: boolean;
};
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
export function queueApi(store: QueueStore, config: QueueConfig) {
  const attempts = new Map<string, { count: number; expires: number }>();
  function limit(key: string) {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.expires < now) attempts.delete(key);
    const item = attempts.get(key) || { count: 0, expires: now + 60000 };
    item.count++;
    attempts.set(key, item);
    if (item.count > 12 || attempts.size > 5000)
      throw new QueueError('尝试过于频繁，请一分钟后再试。', 429);
  }
  const cookie = (value: string, age = 604800) =>
    `interview_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.origin.startsWith('https:') ? '; Secure' : ''}`;
  return async (
    request: Request,
    clientAddress = 'local',
  ): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname,
        method = request.method;
      const origin = request.headers.get('origin');
      if (
        (origin && origin !== config.origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        throw new QueueError('请求来源不受支持。', 403);
      const worker =
        path.startsWith('/api/worker/') || path === '/api/pair/redeem';
      if (!worker && method !== 'GET' && origin !== config.origin)
        throw new QueueError('请从工作台提交请求。', 403);
      let body: Record<string, unknown> = {};
      if (method === 'POST') {
        if (
          !request.headers.get('content-type')?.startsWith('application/json')
        )
          throw new QueueError('请使用 JSON 请求。', 415);
        const text = await request.text();
        if (new TextEncoder().encode(text).length > 550000)
          throw new QueueError('资料超过大小限制。', 413);
        try {
          const value: unknown = JSON.parse(text);
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error();
          body = value as Record<string, unknown>;
        } catch {
          throw new QueueError('请求格式无效。');
        }
      }
      const str = (key: string, max = 200) => {
        const v = body[key];
        if (typeof v !== 'string' || v.length > max)
          throw new QueueError('请求字段无效。');
        return v;
      };
      const sessionToken =
        request.headers
          .get('cookie')
          ?.split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith('interview_session='))
          ?.slice(18) || '';
      const user = store.session(sessionToken);
      const requireAccount = () => {
        if (!user) throw new QueueError('请先登录工作台。', 401);
        if (request.headers.get('x-interview-account') !== user.id)
          throw new QueueError(
            '账号已切换或页面已过期，请刷新网页后继续。本次操作未执行。',
            409,
          );
      };
      const requireOwner = () => {
        requireAccount();
        if (user?.username !== 'owner')
          throw new QueueError('仅 owner 可以配置面试官账号。', 403);
      };
      if (path === '/api/session' && method === 'GET') {
        if (!user && config.previewUser) {
          const value = store.newSession(config.previewUser);
          return json({ user: store.session(value), preview: true }, 200, {
            'Set-Cookie': cookie(value),
          });
        }
        return json({ user: user || null, preview: !!config.previewUser });
      }
      if (path === '/api/login' && method === 'POST') {
        limit('login:' + clientAddress);
        const value = store.login(str('username', 80), str('password'));
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(value) });
      }
      if (path === '/api/logout' && method === 'POST') {
        requireAccount();
        store.logout(sessionToken);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (path === '/api/accounts' && method === 'POST') {
        requireOwner();
        limit('account:' + user!.id);
        const created = store.createUser(str('username', 80), str('password'));
        return json({ user: { username: created.username } }, 201);
      }
      if (path === '/api/pair/redeem' && method === 'POST') {
        limit('pair:' + clientAddress);
        return json(store.redeem(str('code', 32), str('name', 80)));
      }
      if (path.startsWith('/api/worker/') && method === 'POST') {
        const auth = request.headers.get('authorization');
        if (!auth?.startsWith('Bearer '))
          throw new QueueError('缺少连接器凭据。', 401);
        const secret = auth.slice(7);
        store.device(secret);
        if (path === '/api/worker/claim')
          return json({
            job: store.claim(
              secret,
              body.ready === true,
              Array.isArray(body.kinds) && body.kinds.includes('resume')
                ? ['interview', 'resume']
                : ['interview'],
            ),
          });
        if (path === '/api/worker/heartbeat')
          return json(
            store.heartbeat(secret, str('id', 100), str('lease', 100)),
          );
        if (path === '/api/worker/finish')
          return json(
            store.finish(
              secret,
              str('id', 100),
              str('lease', 100),
              body.report,
              body.failed === true,
            ),
          );
        throw new QueueError('接口不存在。', 404);
      }
      if (!user) throw new QueueError('请先登录工作台。', 401);
      requireAccount();
      if (path === '/api/status' && method === 'GET') {
        const devices = store.devices(user.id);
        const online = devices.some((d) => d.online && d.ready);
        return json({
          provider: 'codex-queue',
          analysis: true,
          connected: online,
          message: online
            ? '电脑已连接，可以执行评估'
            : '电脑离线或 Codex 未就绪，提交后将排队等待',
          devices,
        });
      }
      if (path === '/api/pair' && method === 'POST')
        return json(store.pairing(user.id));
      if (path === '/api/devices' && method === 'GET')
        return json({ devices: store.devices(user.id) });
      if (path.startsWith('/api/devices/') && method === 'DELETE') {
        store.revoke(user.id, path.slice('/api/devices/'.length));
        return json({ ok: true });
      }
      if (path === '/api/jobs' && method === 'GET')
        return json({ jobs: store.list(user.id) });
      if (path === '/api/jobs' && method === 'POST') {
        try {
          return json(
            store.submit(
              user.id,
              str('client', 100),
              str('label', 100),
              body.input,
              body.kind === 'resume' ? 'resume' : 'interview',
            ),
            202,
          );
        } catch (e) {
          if (e instanceof QueueError) throw e;
          throw new QueueError('请补全岗位、要求和面试资料，并检查长度限制。');
        }
      }
      if (path.startsWith('/api/jobs/')) {
        const actionPath = path.endsWith('/action'),
          id = path.slice(
            '/api/jobs/'.length,
            actionPath ? -'/action'.length : undefined,
          );
        if (actionPath && method === 'POST') {
          const action = str('action', 10);
          if (!['pause', 'resume', 'stop'].includes(action))
            throw new QueueError('任务操作无效。');
          return json(
            store.action(
              user.id,
              id,
              action as 'pause' | 'resume' | 'stop',
            ),
          );
        }
        if (method === 'GET') return json(store.get(user.id, id));
        if (method === 'DELETE') return json(store.action(user.id, id, 'stop'));
      }
      throw new QueueError('接口不存在。', 404);
    } catch (e) {
      return json(
        {
          error:
            e instanceof QueueError ? e.message : '服务暂不可用，请稍后重试。',
        },
        e instanceof QueueError ? e.status : 500,
      );
    }
  };
}
