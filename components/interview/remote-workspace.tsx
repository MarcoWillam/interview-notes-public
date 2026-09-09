import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  Monitor,
  LogOut,
  X,
  RefreshCw,
  Link2,
  Download,
  UserPlus,
} from 'lucide-react';
import Home from '../../app/page';
import { configureLocalStore } from '../../lib/local/store';
import { remoteRequest, configureRemoteAccount } from '../../lib/remote-analysis';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { TaskCenter } from './task-center';

type Session = {
  user: { id: string; username: string } | null;
  preview: boolean;
};
type Device = {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
  lastSeen: number;
};
export function RemoteWorkspace() {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const [panel, setPanel] = useState<'devices' | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  async function loadSession() {
    try {
      const value = await remoteRequest<Session>('/api/session');
      if (value.user) {
        configureRemoteAccount(value.user.id);
        configureLocalStore(value.preview ? '' : value.user.id);
      }
      setSession(value);
      setError('');
    } catch {
      setError('暂时无法连接工作台，请检查服务后重试。');
    }
  }
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- State is updated after the session HTTP request resolves.
    void loadSession();
  }, []);
  async function login(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await remoteRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: form.get('username'),
          password: form.get('password'),
        }),
      });
      await loadSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败。');
    } finally {
      setPending(false);
    }
  }
  async function logout() {
    setPending(true);
    setError('');
    try {
      await remoteRequest('/api/logout', { method: 'POST', body: '{}' });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '退出失败。');
      setPending(false);
    }
  }
  if (!session?.user)
    return (
      <main className="remote-login">
        <div className="remote-login-card">
          <span className="eyebrow">面谈 · INTERVIEW NOTES</span>
          <h1>{session ? '登录面试工作台' : '正在连接工作台'}</h1>
          <p>整理面试证据，让判断有据可依。</p>
          {session ? (
            <form onSubmit={(e) => void login(e)}>
              <label htmlFor="account">账号</label>
              <input
                id="account"
                name="username"
                autoComplete="username"
                required
                maxLength={80}
              />
              <label htmlFor="password">密码</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={200}
              />
              <button className="primary-button" disabled={pending}>
                {pending ? '正在登录…' : '登录工作台'}
              </button>
            </form>
          ) : error ? (
            <button
              className="secondary-button"
              onClick={() => void loadSession()}
            >
              重新连接
            </button>
          ) : (
            <output>请稍候…</output>
          )}
          {error && (
            <p className="remote-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  return (
    <>
      <div className="remote-bar">
        <span>
          {session.preview ? '本机预览' : session.user.username}
          <span className="remote-bar-note"> · 网页提交，电脑分析</span>
        </span>
        <div>
          <button onClick={() => setPanel('devices')}>
            <Monitor size={16} />
            电脑连接
          </button>
          <TaskCenter />
          {!session.preview && session.user.username === 'owner' && (
            <button onClick={() => setAccountOpen(true)}>
              <UserPlus size={16} />
              账号配置
            </button>
          )}
          {!session.preview && (
            <button disabled={pending} onClick={() => void logout()}>
              <LogOut size={15} />
              退出
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="remote-error" role="alert">
          {error}
        </p>
      )}
      <Home />
      <RemotePanel
        panel={panel}
        close={() => setPanel(null)}
        preview={session.preview}
      />
      <AccountSetupDialog
        open={accountOpen}
        close={() => setAccountOpen(false)}
      />
    </>
  );
}

function AccountSetupDialog({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  async function createAccount(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const rawUsername = form.get('username');
    const rawPassword = form.get('password');
    const username =
      typeof rawUsername === 'string' ? rawUsername.trim() : '';
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    setPending(true);
    setError('');
    setSuccess('');
    try {
      const result = await remoteRequest<{ user: { username: string } }>(
        '/api/accounts',
        {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
          }),
        },
      );
      formElement.reset();
      setSuccess(`账号“${result.user.username}”已创建，可以直接登录。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '账号创建失败。');
    } finally {
      setPending(false);
    }
  }
  function dismiss() {
    if (pending) return;
    setError('');
    setSuccess('');
    close();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent
        className="remote-dialog remote-account-dialog"
        showCloseButton={false}
      >
        <div className="remote-dialog-heading">
          <DialogTitle>配置面试官账号</DialogTitle>
          <button
            className="icon-button"
            aria-label="关闭账号配置"
            disabled={pending}
            onClick={dismiss}
          >
            <X size={18} />
          </button>
        </div>
        <DialogDescription>
          设置账号名和初始密码。创建后，将这两项单独交给对应面试官即可。
        </DialogDescription>
        <form className="remote-account-form" onSubmit={createAccount}>
          <label htmlFor="new-account-username">账号名</label>
          <input
            id="new-account-username"
            name="username"
            autoComplete="off"
            required
            minLength={2}
            maxLength={80}
            pattern="[\p{L}\p{N}_@.\-]+"
            title="支持中英文、数字及 _ @ . -"
            disabled={pending}
          />
          <span>2–80 字，支持中英文、数字及 _ @ . -</span>
          <label htmlFor="new-account-password">初始密码</label>
          <input
            id="new-account-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={200}
            disabled={pending}
          />
          <span>至少 12 字；密码只会以安全哈希保存在服务器。</span>
          {error && (
            <p className="remote-error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <output className="remote-success">
              {success}
            </output>
          )}
          <button className="primary-button" disabled={pending}>
            <UserPlus size={16} />
            {pending ? '正在创建…' : '创建账号'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemotePanel({
  panel,
  close,
  preview,
}: {
  panel: 'devices' | null;
  close: () => void;
  preview: boolean;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(
      null,
    ),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [loaded, setLoaded] = useState(false);
  async function refresh(target = panel) {
    try {
      if (target === 'devices') {
        const data = await remoteRequest<{ devices: Device[] }>('/api/devices');
        setDevices(data.devices);
      }
      setLoaded(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '刷新失败。');
    }
  }
  useEffect(() => {
    if (!panel) return;
    let disposed = false;
    // Responses from a closed panel never affect another account (logout reloads the page).
    const tick = async () => {
      if (!disposed) await refresh(panel);
    };
    void tick();
    const timer = setInterval(() => void tick(), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [panel]);
  async function action(work: () => Promise<void>) {
    setPending(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败。');
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={!!panel}
      onOpenChange={(open) => {
        if (!open) {
          close();
          setLoaded(false);
          setPair(null);
        }
      }}
    >
      <DialogContent className="remote-dialog" showCloseButton={false}>
        <div className="remote-dialog-heading">
          <DialogTitle>连接你的电脑</DialogTitle>
          <button
            className="icon-button"
            aria-label="关闭"
            onClick={() => {
              close();
              setLoaded(false);
              setPair(null);
            }}
          >
            <X size={18} />
          </button>
        </div>
        <DialogDescription>
          连接器在电脑上领取当前账号的任务，使用该电脑登录的 Codex 完成分析。
        </DialogDescription>
        {error && (
          <p className="remote-error" role="alert">
            {error}
          </p>
        )}
        <>
            <div className="remote-section-label">
              <h3>已配对电脑</h3>
              <button className="text-button" onClick={() => void refresh()}>
                <RefreshCw size={14} />
                刷新
              </button>
            </div>
            {!loaded && !error && <output>正在读取电脑状态…</output>}
            {loaded && !devices.length && (
              <div className="remote-empty">
                <Monitor size={28} />
                <p>还没有连接电脑</p>
                <span>可以先提交评估，连接电脑后会自动开始。</span>
              </div>
            )}
            {devices.map((device) => (
              <div className="remote-device" key={device.id}>
                <Monitor size={20} />
                <div>
                  <strong>{device.name}</strong>
                  <span>
                    <i
                      className={`service-dot ${device.online && device.ready ? 'ready' : ''}`}
                    />
                    {device.online
                      ? device.ready
                        ? '在线 · 可以分析'
                        : '在线 · Codex 需登录'
                      : '离线 · 等待连接'}
                  </span>
                </div>
                <button
                  disabled={pending}
                  className="text-button"
                  onClick={() =>
                    void action(async () => {
                      await remoteRequest(
                        '/api/devices/' + encodeURIComponent(device.id),
                        { method: 'DELETE' },
                      );
                    })
                  }
                >
                  解除配对
                </button>
              </div>
            ))}
            <div className="remote-pair">
              <h3>
                <Link2 size={18} />
                连接一台电脑
              </h3>
              <p>
                新电脑先下载并解压专用连接器包，再使用自己的 ChatGPT 账号登录
                Codex。连接器需要保持运行。
              </p>
              <a
                className="secondary-button remote-connector-download"
                href="/downloads/interview-connector.zip"
                download
              >
                <Download size={16} />
                下载连接器包
              </a>
              <p className="small-note">
                终端提示符如果仍是 <code>~ %</code>，或提示找不到{' '}
                <code>/Users/用户名/package.json</code>
                ，说明当前不在连接器目录。请先进入解压后的{' '}
                <code>interview-connector</code> 文件夹。
              </p>
              {preview && (
                <p className="small-note">
                  本机预览已自动启动一个连接器；部署后可用此处配对自己的电脑。
                </p>
              )}
              <button
                className="secondary-button"
                disabled={pending}
                onClick={() =>
                  void action(async () => {
                    setPair(
                      await remoteRequest('/api/pair', {
                        method: 'POST',
                        body: '{}',
                      }),
                    );
                  })
                }
              >
                {pair ? '重新生成配对码' : '生成配对码'}
              </button>
              {pair && (
                <div className="remote-pair-code">
                  <strong>配对码：{pair.code}</strong>
                  <span>
                    仅可使用一次，有效至{' '}
                    {new Date(pair.expiresAt).toLocaleTimeString('zh-CN')}。
                  </span>
                  <p>进入解压后的连接器目录：</p>
                  <pre>cd ~/Downloads/interview-connector</pre>
                  <p>确认当前目录中能看到 package.json 后运行：</p>
                  <pre>{`npm run connector -- --server ${window.location.origin} --pair ${pair.code}`}</pre>
                  <p className="small-note">
                    首次成功后，后续只需运行 npm run
                    connector。请仅将配对码用于自己的电脑。
                  </p>
                </div>
              )}
            </div>
        </>
      </DialogContent>
    </Dialog>
  );
}
