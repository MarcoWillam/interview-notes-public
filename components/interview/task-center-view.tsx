export type TaskCenterJob = {
  id: string;
  kind?: 'interview' | 'resume' | 'written-test' | 'work-sample';
  label: string;
  state:
    | 'queued'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';
  created: number;
  updated: number;
  queuedAt?: number;
  startedAt?: number | null;
  position?: number | null;
  error?: string | null;
  targetDeviceName?: string | null;
  waitingForDevice?: boolean;
};

export type TaskAction = 'pause' | 'resume' | 'stop';

const labels: Record<TaskCenterJob['state'], string> = {
  queued: '等待中',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
};

const activeStates = new Set<TaskCenterJob['state']>([
  'queued',
  'running',
  'paused',
]);

export function taskActionPrompt(
  action: TaskAction,
  state: TaskCenterJob['state'],
) {
  if (action === 'pause' && state === 'running')
    return '暂停正在运行的任务？恢复后将从头重新执行，已消耗的 Codex 用量不会退回。';
  if (action === 'pause') return '暂停这个等待中的任务？稍后可以从任务中心恢复。';
  if (action === 'resume')
    return '恢复这个任务？任务会重新进入队列，并从头执行。简历阅读会优先领取。';
  return '停止这个任务？服务器上的简历、岗位要求和面试记录将立即删除，且无法恢复。';
}

function duration(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function timing(job: TaskCenterJob, now: number) {
  if (job.state === 'queued') {
    if (job.waitingForDevice)
      return `等待作品所在电脑${job.targetDeviceName ? ` · ${job.targetDeviceName}` : ''}`;
    const prefix = job.position ? `排队第 ${job.position} 位 · ` : '';
    return `${prefix}已等待 ${duration(now - (job.queuedAt || job.created))}`;
  }
  if (job.state === 'running' && job.startedAt)
    return `已运行 ${duration(now - job.startedAt)}`;
  if (job.state === 'paused') return '保留材料，等待恢复';
  return `更新于 ${new Date(job.updated).toLocaleString('zh-CN')}`;
}

function ordered(jobs: readonly TaskCenterJob[]) {
  return [...jobs].sort((a, b) => {
    const active = Number(activeStates.has(b.state)) - Number(activeStates.has(a.state));
    return active || b.updated - a.updated;
  });
}

export function TaskCenterView({
  jobs,
  now,
  pendingId,
  onAction,
  onResult,
}: {
  jobs: readonly TaskCenterJob[];
  now: number;
  pendingId: string | null;
  onAction: (job: TaskCenterJob, action: TaskAction) => void;
  onResult: (job: TaskCenterJob) => void;
}) {
  const running = jobs.filter((job) => job.state === 'running').length;
  const queued = jobs.filter((job) => job.state === 'queued').length;
  const paused = jobs.filter((job) => job.state === 'paused').length;

  return (
    <>
      <div className="task-summary" aria-label="任务状态汇总">
        <span className="running">运行中 {running}</span>
        <span>等待中 {queued}</span>
        <span>已暂停 {paused}</span>
      </div>
      {!jobs.length ? (
        <div className="remote-empty">
          <p>暂无分析任务</p>
          <span>阅读简历或生成结论评估后，任务会显示在这里。</span>
        </div>
      ) : (
        <div className="task-list">
          {ordered(jobs).map((job) => {
            const pending = pendingId === job.id;
            return (
              <article className={`task-card ${job.state}`} data-job-id={job.id} key={job.id}>
                <div className="task-card-heading">
                  <div>
                    <strong>{job.label}</strong>
                    <span>
                      {job.kind === 'resume'
                        ? '简历阅读'
                        : job.kind === 'written-test'
                          ? '笔试复盘补充'
                          : job.kind === 'work-sample'
                            ? '笔试作品评估'
                          : '结论评估'}
                    </span>
                  </div>
                  <span className={`task-state ${job.state}`}>{labels[job.state]}</span>
                </div>
                <div className="task-meta">
                  <span>{timing(job, now)}</span>
                  {(job.kind === 'resume' ||
                    job.kind === 'written-test' ||
                    job.kind === 'work-sample') &&
                    job.state === 'queued' && (
                    <em>准备优先</em>
                    )}
                </div>
                {job.error && <p className="task-error">{job.error}</p>}
                <div className="task-actions">
                  {(job.state === 'queued' || job.state === 'running') && (
                    <button disabled={pending} onClick={() => onAction(job, 'pause')}>
                      暂停
                    </button>
                  )}
                  {job.state === 'paused' && (
                    <button disabled={pending} onClick={() => onAction(job, 'resume')}>
                      恢复
                    </button>
                  )}
                  {activeStates.has(job.state) && (
                    <button className="danger" disabled={pending} onClick={() => onAction(job, 'stop')}>
                      停止
                    </button>
                  )}
                  {job.state === 'completed' && (
                    <button className="result" disabled={pending} onClick={() => onResult(job)}>
                      查看结果
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
