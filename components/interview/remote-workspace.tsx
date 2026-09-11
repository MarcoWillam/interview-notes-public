import { useEffect, useState, type SyntheticEvent } from 'react';
import { Monitor, X, RefreshCw, Link2, Download, UserPlus } from 'lucide-react';
import Home from '../../app/page';
import { configureLocalStore } from '../../lib/local/store';
import {
  remoteRequest,
  configureRemoteAccount,
  listRemoteArtifacts,
  type RemoteArtifact,
} from '../../lib/remote-analysis';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';

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
  version: string | null;
  protocol: number | null;
  versionSeen: number | null;
  updateState: 'current' | 'update-available' | 'update-required';
  supportsOutline: boolean;
};
type ConnectorReleaseInfo = {
  latestVersion: string;
  latestProtocol: number;
  minimumProtocol: number;
  outlineProtocol: number;
  notes: string;
  downloadUrl: string;
};
type DeviceResponse = {
  devices: Device[];
  connectorRelease: ConnectorReleaseInfo;
};
export function RemoteWorkspace() {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const [panel, setPanel] = useState<'devices' | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceResponse | null>(null);
  const [dismissedRelease, setDismissedRelease] = useState('');
  async function loadSession() {
    try {
      const value = await remoteRequest<Session>('/api/session');
      if (value.user) {
        configureRemoteAccount(value.user.id);
        configureLocalStore(value.preview ? '' : value.user.id);
        try {
          setDismissedRelease(
            sessionStorage.getItem(
              `interview-connector-update-dismissed:${value.user.id}`,
            ) || '',
          );
        } catch {
          setDismissedRelease('');
        }
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
  useEffect(() => {
    if (!session?.user || session.preview) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const value = await remoteRequest<DeviceResponse>('/api/devices');
        if (!disposed) setDeviceStatus(value);
      } catch {
        // The device dialog reports actionable connection errors when opened.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [session]);
  function dismissConnectorRelease(version: string) {
    setDismissedRelease(version);
    if (!session?.user) return;
    try {
      sessionStorage.setItem(
        `interview-connector-update-dismissed:${session.user.id}`,
        version,
      );
    } catch {
      // The in-memory dismissal still lasts for this rendered workspace.
    }
  }
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
          <span className="eyebrow">伯乐 AI · INTERVIEW COPILOT</span>
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
      <Home
        workspaceAccount={{
          id: session.preview ? 'preview' : session.user.id,
          username: session.preview ? '本机预览' : session.user.username,
          preview: session.preview,
          owner: !session.preview && session.user.username === 'owner',
          pending,
          error,
          onOpenDevices: () => setPanel('devices'),
          onOpenAccount: () => setAccountOpen(true),
          onLogout: () => void logout(),
        }}
        connectorUpdate={(() => {
          if (!deviceStatus?.devices.length) return undefined;
          const required = deviceStatus.devices.some(
            (device) => device.updateState === 'update-required',
          );
          const available = deviceStatus.devices.some(
            (device) => device.updateState === 'update-available',
          );
          if (
            !required &&
            (!available ||
              dismissedRelease === deviceStatus.connectorRelease.latestVersion)
          )
            return undefined;
          return {
            required,
            latestVersion: deviceStatus.connectorRelease.latestVersion,
            notes: deviceStatus.connectorRelease.notes,
            downloadUrl: deviceStatus.connectorRelease.downloadUrl,
            onOpenDevices: () => setPanel('devices'),
            onDismiss: required
              ? undefined
              : () =>
                  dismissConnectorRelease(
                    deviceStatus.connectorRelease.latestVersion,
                  ),
          };
        })()}
      />
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
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
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
          {success && <output className="remote-success">{success}</output>}
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
  const [release, setRelease] = useState<ConnectorReleaseInfo | null>(null);
  const [artifacts, setArtifacts] = useState<RemoteArtifact[]>([]);
  const [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(
      null,
    ),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [loaded, setLoaded] = useState(false);
  async function refresh(target = panel) {
    try {
      if (target === 'devices') {
        const [data, workSamples] = await Promise.all([
          remoteRequest<DeviceResponse>('/api/devices'),
          listRemoteArtifacts(),
        ]);
        setDevices(data.devices);
        setRelease(data.connectorRelease);
        setArtifacts(workSamples);
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
                <span className="remote-device-version">
                  连接器 {device.version || '旧版（未报告版本）'}
                  {device.protocol
                    ? ` · 协议 ${device.protocol}`
                    : ' · 协议未知'}
                  {device.updateState !== 'current' && (
                    <em className={device.updateState}>
                      {device.updateState === 'update-required'
                        ? '必须更新'
                        : '有新版本'}
                    </em>
                  )}
                </span>
                {!device.supportsOutline && (
                  <span className="remote-device-capability">
                    暂不支持提纲重新生成，请升级至{' '}
                    {release?.latestVersion || '最新版'}。
                  </span>
                )}
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
          {release &&
            devices.some((device) => device.updateState !== 'current') && (
              <div className="remote-update-guide">
                <strong>最新版 {release.latestVersion}</strong>
                <span>{release.notes}</span>
                <p>
                  下载新版 ZIP，解压后运行 <code>npm run connector</code>
                  。如果覆盖原目录，请保留 <code>
                    .local/connector.json
                  </code> 与{' '}
                  <code>works/</code>，无需重新配对。
                </p>
                <a
                  className="secondary-button remote-connector-download"
                  href={release.downloadUrl}
                  download
                >
                  <Download size={16} /> 下载新版连接器
                </a>
              </div>
            )}
          <div className="remote-section-label remote-artifact-heading">
            <div>
              <h3>本地笔试作品</h3>
              <span>
                将不超过 50 MB 的 ZIP 放入连接器目录下的 <code>works/</code>
              </span>
            </div>
            {artifacts.length > 0 && (
              <small>
                最近扫描：
                {new Date(
                  Math.max(...artifacts.map((item) => item.syncedAt)),
                ).toLocaleTimeString('zh-CN')}
              </small>
            )}
          </div>
          {!artifacts.length ? (
            <div className="remote-empty remote-artifact-empty">
              <p>暂未发现 ZIP 作品</p>
              <span>连接器保持运行后，网页会自动刷新文件清单。</span>
            </div>
          ) : (
            <div className="remote-artifact-list">
              {artifacts.map((artifact) => (
                <div className="remote-artifact" key={artifact.id}>
                  <div>
                    <strong>{artifact.name}</strong>
                    <span>
                      {artifact.deviceName} ·{' '}
                      {(artifact.bytes / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                  <em className={artifact.available ? 'available' : ''}>
                    {artifact.available ? '可选择' : '等待作品所在电脑'}
                  </em>
                </div>
              ))}
            </div>
          )}
          <p className="small-note">
            ZIP 和源码只保存在这台电脑。仅 AI 产品经理模板可选择作品；Codex
            只读分析，不运行代码或安装依赖。旧版连接器看不到作品时，请重新下载当前连接器包。
          </p>
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
            <div className="remote-connector-guide" aria-label="连接器使用流程">
              <section className="remote-connector-step">
                <strong className="remote-connector-step-title">
                  <span className="remote-connector-step-index">1</span>
                  首次配对
                </strong>
                <p>
                  进入解压后的 <code>interview-connector</code>{' '}
                  目录，生成配对码并运行首次配对命令。
                  {'配对码仅可使用一次，10 分钟内有效。'}
                </p>
              </section>
              <section className="remote-connector-step">
                <strong className="remote-connector-step-title">
                  <span className="remote-connector-step-index">2</span>
                  保持连接
                </strong>
                <p>
                  连接器运行期间才能领取任务。关闭终端会停止领取任务，但不会使已保存的配对失效；未领取任务会继续排队。
                </p>
              </section>
              <section className="remote-connector-step">
                <strong className="remote-connector-step-title">
                  <span className="remote-connector-step-index">3</span>
                  以后启动
                </strong>
                <p>
                  回到首次配对使用的同一目录，只需运行下面的命令，无需重新生成配对码。
                </p>
                <code className="remote-connector-command">
                  npm run connector
                </code>
              </section>
            </div>
            <p className="small-note">
              终端提示符如果仍是 <code>~ %</code>，或提示找不到{' '}
              <code>/Users/用户名/package.json</code>
              ，说明当前不在连接器目录。请先进入解压后的{' '}
              <code>interview-connector</code> 文件夹。连接凭据保存在该目录的{' '}
              <code>.local/connector.json</code>
              ；重新下载、移动或删除目录，或凭据文件丢失时，才需要重新配对。
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
                <p>首次配对命令：</p>
                <pre>{`npm run connector -- --server ${window.location.origin} --pair ${pair.code}`}</pre>
                <p className="small-note">
                  此命令只在首次配对时使用。配对成功后，请按上方“以后启动”运行连接器。请仅将配对码用于自己的电脑。
                </p>
              </div>
            )}
          </div>
        </>
      </DialogContent>
    </Dialog>
  );
}
