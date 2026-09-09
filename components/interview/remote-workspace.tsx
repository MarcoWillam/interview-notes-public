import { ResumeReadingView } from './resume-reading-view';
import type { ResumeReading } from '../../lib/resume-reading';
import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  Monitor,
  ListChecks,
  LogOut,
  X,
  RefreshCw,
  Link2,
  Download,
} from 'lucide-react';
import Home from '../../app/page';
import { configureLocalStore } from '../../lib/local/store';
import {
  remoteRequest,
  configureRemoteAccount,
  type RemoteJob,
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
};
const states = {
  queued: '等待电脑领取',
  running: '电脑正在分析',
  completed: '评估已完成',
  failed: '任务失败',
  cancelled: '已取消',
};
function saveReport(
  job: RemoteJob<import('../../lib/interview').Report | ResumeReading>,
) {
  if (!job.report || !('dimensions' in job.report)) return;
  const report = job.report;
  const markdown = [
    `# ${job.label}`,
    '',
    'AI 辅助评估 · 待人工核实',
    '',
    report.summary,
    ...report.dimensions.flatMap((d) => [
      '',
      `## ${d.name} · ${d.score === null ? '证据不足' : d.score + '/5'}`,
      d.assessment,
      ...d.evidence.map((q) => '> ' + q.replaceAll('\n', '\n> ')),
    ]),
    '',
    '## 待核实事项',
    ...report.followUps.map((q) => '- ' + q),
  ].join('\n');
  const url = URL.createObjectURL(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download =
    job.label.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60) + '-辅助评估.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RemoteWorkspace() {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const [panel, setPanel] = useState<'devices' | 'jobs' | null>(null);
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
          <button onClick={() => setPanel('jobs')}>
            <ListChecks size={16} />
            评估任务
          </button>
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
    </>
  );
}

function RemotePanel({
  panel,
  close,
  preview,
}: {
  panel: 'devices' | 'jobs' | null;
  close: () => void;
  preview: boolean;
}) {
  const [devices, setDevices] = useState<Device[]>([]),
    [jobs, setJobs] = useState<
      RemoteJob<import('../../lib/interview').Report | ResumeReading>[]
    >([]),
    [detail, setDetail] = useState<RemoteJob<
      import('../../lib/interview').Report | ResumeReading
    > | null>(null);
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
      } else if (target === 'jobs') {
        const data = await remoteRequest<{
          jobs: RemoteJob<
            import('../../lib/interview').Report | ResumeReading
          >[];
        }>('/api/jobs');
        setJobs(data.jobs);
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
          setDetail(null);
          setLoaded(false);
          setPair(null);
        }
      }}
    >
      <DialogContent className="remote-dialog">
        <div className="remote-dialog-heading">
          <DialogTitle>
            {panel === 'devices' ? '连接你的电脑' : '评估任务'}
          </DialogTitle>
          <button
            className="icon-button"
            aria-label="关闭"
            onClick={() => {
              close();
              setDetail(null);
              setLoaded(false);
              setPair(null);
            }}
          >
            <X size={18} />
          </button>
        </div>
        <DialogDescription>
          {panel === 'devices'
            ? '连接器在电脑上领取当前账号的任务，使用该电脑登录的 Codex 完成分析。'
            : '关闭网页不会取消已提交的任务。结果保留 7 天，请及时下载；工作台草稿与偏好仍保存在当前浏览器。'}
        </DialogDescription>
        {error && (
          <p className="remote-error" role="alert">
            {error}
          </p>
        )}
        {panel === 'devices' ? (
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
                在电脑上准备好本项目和已登录的
                Codex，生成配对码后运行下面的命令。连接器需要保持运行。
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
                  <p>在项目目录的终端运行：</p>
                  <pre>{`npm run connector -- --server ${window.location.origin} --pair ${pair.code}`}</pre>
                  <p className="small-note">
                    首次成功后，后续只需运行 npm run
                    connector。请仅将配对码用于自己的电脑。
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {detail ? (
              <div className="remote-result">
                <button className="text-button" onClick={() => setDetail(null)}>
                  ← 返回任务列表
                </button>
                <h3>{detail.label}</h3>
                <span className="badge">AI 辅助评估 · 待人工核实</span>
                {detail.report && 'sections' in detail.report && (
                  <ResumeReadingView value={detail.report} />
                )}
                {detail.report && 'dimensions' in detail.report && (
                  <>
                    <p>{detail.report.summary}</p>
                    {detail.report.dimensions.map((d) => (
                      <section key={d.name}>
                        <h4>
                          {d.name}
                          <span>
                            {d.score === null ? '证据不足' : `${d.score}/5`}
                          </span>
                        </h4>
                        <p>{d.assessment}</p>
                        {d.evidence.map((quote, index) => (
                          <blockquote key={index}>{quote}</blockquote>
                        ))}
                      </section>
                    ))}
                    {detail.report.followUps.length > 0 && (
                      <section>
                        <h4>待核实事项</h4>
                        <ul>
                          {detail.report.followUps.map((q, index) => (
                            <li key={index}>{q}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                    <button
                      className="primary-button"
                      onClick={() => saveReport(detail)}
                    >
                      <Download size={16} />
                      下载评估 Markdown
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="remote-section-label">
                  <h3>最近的任务</h3>
                  <button
                    className="text-button"
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={14} />
                    刷新
                  </button>
                </div>
                {!loaded && !error && <output>正在读取任务…</output>}
                {loaded && !jobs.length && (
                  <div className="remote-empty">
                    <ListChecks size={28} />
                    <p>暂无评估任务</p>
                    <span>
                      粘贴简历、导入 .md 面试记录后，点击生成辅助评估。
                    </span>
                  </div>
                )}
                {jobs.map((job) => (
                  <div className="remote-job" key={job.id}>
                    <div>
                      <strong>
                        {job.kind === 'resume' ? '简历阅读 · ' : ''}
                        {job.label}
                      </strong>
                      <span>
                        {new Date(job.created).toLocaleString('zh-CN')} ·{' '}
                        {states[job.state]}
                      </span>
                      {job.error && <p>{job.error}</p>}
                    </div>
                    {job.state === 'completed' ? (
                      <button
                        disabled={pending}
                        className="secondary-button"
                        onClick={() =>
                          void action(async () => {
                            setDetail(
                              await remoteRequest(
                                '/api/jobs/' + encodeURIComponent(job.id),
                              ),
                            );
                          })
                        }
                      >
                        查看结果
                      </button>
                    ) : ['queued', 'running'].includes(job.state) ? (
                      <button
                        disabled={pending}
                        className="text-button"
                        onClick={() =>
                          void action(async () => {
                            await remoteRequest(
                              '/api/jobs/' + encodeURIComponent(job.id),
                              { method: 'DELETE' },
                            );
                          })
                        }
                      >
                        取消任务
                      </button>
                    ) : null}
                  </div>
                ))}
                <p className="small-note">
                  离线任务最多等待 24
                  小时。执行中断的任务会标记失败；核实原因后，从原面试记录重新提交即可。
                </p>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
