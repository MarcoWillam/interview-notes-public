'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ListChecks, RefreshCw, X } from 'lucide-react';
import {
  workSampleReviewMarkdownLines,
  workSampleVerificationLabels,
  type Report,
} from '../../lib/interview';
import type { ResumeReading } from '../../lib/resume-reading';
import type { WrittenTestSupplementResult } from '../../lib/written-test-supplement';
import type { WorkSampleAssessment } from '../../lib/work-sample';
import {
  controlRemoteJob,
  remoteRequest,
  type RemoteJob,
} from '../../lib/remote-analysis';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import {
  ResumeReadingView,
  WrittenTestSupplementView,
} from './resume-reading-view';
import {
  TaskCenterView,
  taskActionPrompt,
  type TaskAction,
  type TaskCenterJob,
} from './task-center-view';

type Job = RemoteJob<
  Report | ResumeReading | WrittenTestSupplementResult | WorkSampleAssessment
>;

function downloadReport(job: Job) {
  if (
    !job.report ||
    (job.kind !== undefined && job.kind !== 'interview') ||
    !('followUps' in job.report)
  )
    return;
  const report = job.report as Report;
  const markdown = [
    `# ${job.label}`,
    '',
    'AI 辅助评估 · 待人工核实',
    '',
    report.summary,
    ...workSampleReviewMarkdownLines(report),
    ...report.dimensions.flatMap((dimension) => [
      '',
      `## ${dimension.name} · ${dimension.score === null ? '证据不足' : dimension.score + '/5'}`,
      dimension.assessment,
      ...dimension.evidence.map(
        (quote) => '> ' + quote.replaceAll('\n', '\n> '),
      ),
    ]),
    '',
    '## 待核实事项',
    ...report.followUps.map((question) => '- ' + question),
  ].join('\n');
  const url = URL.createObjectURL(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download =
    job.label.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60) + '-辅助评估.md';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TaskCenter({ onOpen }: { onOpen?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [detail, setDetail] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const activeCount = useMemo(
    () =>
      jobs.filter((job) => ['queued', 'running', 'paused'].includes(job.state))
        .length,
    [jobs],
  );
  const runningCount = useMemo(
    () => jobs.filter((job) => job.state === 'running').length,
    [jobs],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await remoteRequest<{ jobs: Job[] }>('/api/jobs');
      setJobs(data.jobs);
      setLoaded(true);
      setError('');
    } catch (reason) {
      setLoaded(true);
      setError(reason instanceof Error ? reason.message : '任务刷新失败。');
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (!disposed)
        timer = setTimeout(
          () => void poll(),
          document.hidden ? 15_000 : open || activeCount > 0 ? 3_000 : 15_000,
        );
    };
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    void poll();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [activeCount, open, refresh]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setClock(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [open]);

  async function act(job: TaskCenterJob, action: TaskAction) {
    if (!window.confirm(taskActionPrompt(action, job.state))) return;
    setPendingId(job.id);
    setError('');
    try {
      const updated = await controlRemoteJob(job.id, action);
      setJobs((current) =>
        current.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        ),
      );
      if (detail?.id === updated.id) setDetail(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务操作失败。');
    } finally {
      setPendingId(null);
    }
  }

  async function showResult(job: TaskCenterJob) {
    setPendingId(job.id);
    setError('');
    try {
      setDetail(
        await remoteRequest<Job>('/api/jobs/' + encodeURIComponent(job.id)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取结果失败。');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <button
        className="task-center-trigger"
        onClick={(event) => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          onOpen?.();
          setOpen(true);
        }}
      >
        <ListChecks size={16} />
        <span className="workspace-action-copy">任务中心</span>
        {activeCount > 0 && <b>{activeCount}</b>}
        {runningCount > 0 && <i aria-label={`${runningCount} 个任务运行中`} />}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDetail(null);
        }}
      >
        <DialogContent
          className="task-center-drawer translate-x-0 translate-y-0"
          showCloseButton={false}
        >
          <div className="remote-dialog-heading task-center-heading">
            <div>
              <DialogTitle>{detail ? detail.label : '任务中心'}</DialogTitle>
              <DialogDescription>
                {detail
                  ? 'AI 辅助结果需要面试官结合原始材料核实。'
                  : '当前账号提交的简历阅读和结论评估任务。'}
              </DialogDescription>
            </div>
            <button
              className="icon-button"
              aria-label="关闭任务中心"
              onClick={() => {
                setOpen(false);
                setDetail(null);
              }}
            >
              <X size={18} />
            </button>
          </div>
          {error && (
            <p className="remote-error" role="alert">
              {error}
            </p>
          )}
          {detail ? (
            <TaskResult job={detail} back={() => setDetail(null)} />
          ) : (
            <>
              <div className="task-center-toolbar">
                <span>任务完成后结果保留 7 天</span>
                <button disabled={!!pendingId} onClick={() => void refresh()}>
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
              {!loaded && (
                <output className="task-loading">正在读取任务…</output>
              )}
              {loaded && (
                <TaskCenterView
                  jobs={jobs}
                  now={clock}
                  pendingId={pendingId}
                  onAction={(job, action) => void act(job, action)}
                  onResult={(job) => void showResult(job)}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TaskResult({ job, back }: { job: Job; back: () => void }) {
  return (
    <div className="remote-result task-center-result">
      <button className="text-button" onClick={back}>
        ← 返回任务列表
      </button>
      <span className="badge">AI 辅助结果 · 待人工核实</span>
      {job.report && 'sections' in job.report && (
        <ResumeReadingView value={job.report} />
      )}
      {job.report && job.kind === 'written-test' && 'questions' in job.report && (
        <WrittenTestSupplementView questions={job.report.questions} />
      )}
      {job.report && job.kind === 'work-sample' && 'dimensions' in job.report && (
        <WorkSampleTaskResult value={job.report as WorkSampleAssessment} />
      )}
      {job.report &&
        job.kind !== 'work-sample' &&
        'dimensions' in job.report &&
        'followUps' in job.report && (
        <>
          <p>{job.report.summary}</p>
          {job.report.workSampleReview?.length ? (
            <section>
              <h4>作品表现（归属与过程待核实）</h4>
              {job.report.workSampleReview.map((item, index) => (
                <div key={`${item.status}-${index}`}>
                  <strong>{workSampleVerificationLabels[item.status]}</strong>
                  <p>{item.observation}</p>
                  {item.transcriptEvidence.map((quote, quoteIndex) => (
                    <blockquote key={quoteIndex}>{quote}</blockquote>
                  ))}
                </div>
              ))}
            </section>
          ) : null}
          {job.report.dimensions.map((dimension) => (
            <section key={dimension.name}>
              <h4>
                {dimension.name}
                <span>
                  {dimension.score === null
                    ? '证据不足'
                    : `${dimension.score}/5`}
                </span>
              </h4>
              <p>{dimension.assessment}</p>
              {dimension.evidence.map((quote, index) => (
                <blockquote key={index}>{quote}</blockquote>
              ))}
            </section>
          ))}
          {job.report.followUps.length > 0 && (
            <section>
              <h4>待核实事项</h4>
              <ul>
                {job.report.followUps.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </section>
          )}
          <button
            className="primary-button"
            onClick={() => downloadReport(job)}
          >
            <Download size={16} />
            下载评估 Markdown
          </button>
        </>
      )}
    </div>
  );
}

function WorkSampleTaskResult({ value }: { value: WorkSampleAssessment }) {
  return (
    <>
      <p>{value.summary}</p>
      <section>
        <h4>作品观察</h4>
        <ul>
          {value.strengths.map((item) => (
            <li key={item}>{item}</li>
          ))}
          {value.risks.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <WrittenTestSupplementView questions={value.questions} />
      <details>
        <summary>查看维度依据与读取范围</summary>
        {value.dimensions.map((dimension) => (
          <section key={dimension.name}>
            <h4>
              {dimension.name}
              <span>
                {dimension.score === null ? '待面试核实' : `${dimension.score}/5`}
              </span>
            </h4>
            <p>{dimension.assessment}</p>
            {dimension.evidence.map((evidence, index) => (
              <blockquote key={`${evidence.path}-${index}`}>
                {evidence.path}：{evidence.excerpt}
              </blockquote>
            ))}
          </section>
        ))}
        <p>已读取 {value.coverage.analyzed.length} 个文件。</p>
      </details>
    </>
  );
}
