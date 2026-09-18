'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ListChecks, RefreshCw, X } from 'lucide-react';
import {
  candidateReportFromAssessmentResult,
  workSampleReviewMarkdownLines,
  workSampleVerificationLabels,
  type Report,
} from '../../lib/interview';
import type { ResumeReading } from '../../lib/resume-reading';
import type { WrittenTestSupplementResult } from '../../lib/written-test-supplement';
import {
  workSampleRubricLabel,
  type WorkSampleAnalysisV2,
  type WorkSampleAnalysisV3,
  type WorkSampleAssessment,
} from '../../lib/work-sample';
import type { OutlineV2SupplementResult } from '../../lib/outline-v2-supplement';
import type { OutlineV3SupplementResult } from '../../lib/outline-v3-supplement';
import { groupAssessmentDimensions } from '../../lib/assessment-groups';
import type { OutlineRegenerationResult } from '../../lib/outline-regeneration';
import type { FollowUpOutlineResult } from '../../lib/follow-up-outline';
import type {
  SecondRoundAssessmentResult,
  SecondRoundOutlineResult,
} from '../../lib/second-round';
import { exportInterviewOutlineV2 } from '../../lib/interview-outline-v2';
import { exportInterviewOutlineV3 } from '../../lib/interview-outline-v3';
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
import { InterviewOutlineV2View } from './interview-outline-v2-view';
import { SecondRoundOutlineView } from './second-round-outline-view';
import { SecondRoundComparisonView } from './second-round-comparison-view';
import {
  TaskCenterView,
  taskActionPrompt,
  type TaskAction,
  type TaskCenterJob,
} from './task-center-view';

type Job = RemoteJob<
  | Report
  | ResumeReading
  | WrittenTestSupplementResult
  | WorkSampleAssessment
  | WorkSampleAnalysisV2
  | WorkSampleAnalysisV3
  | OutlineRegenerationResult
  | FollowUpOutlineResult
  | SecondRoundOutlineResult
  | SecondRoundAssessmentResult
>;

function downloadReport(job: Job) {
  const report = candidateReportFromAssessmentResult(job.report);
  if (
    !report ||
    (job.kind !== undefined &&
      job.kind !== 'interview' &&
      job.kind !== 'second-round-assessment')
  )
    return;
  const groups = groupAssessmentDimensions(job.label, report.dimensions);
  const markdown = [
    `# ${job.label}`,
    '',
    'AI 辅助评估 · 待人工核实',
    '',
    report.summary,
    ...workSampleReviewMarkdownLines(report),
    ...groups.flatMap((group) => [
      ...(group.title ? ['', `## ${group.title}`] : []),
      ...group.dimensions.flatMap((dimension) => [
        '',
        `${group.title ? '###' : '##'} ${dimension.name} · ${dimension.score === null ? '证据不足' : dimension.score + '/5'}`,
        dimension.assessment,
        ...dimension.evidence.map(
          (quote) => '> ' + quote.replaceAll('\n', '\n> '),
        ),
      ]),
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

function downloadOutline(value: OutlineRegenerationResult) {
  if ('outline' in value) {
    const markdown = `# 重新生成的面试提纲\n\n${value.outline.version === 3 ? exportInterviewOutlineV3(value.outline) : exportInterviewOutlineV2(value.outline)}`;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '重新生成的面试提纲.md';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const questions = [
    ...value.interviewQuestions,
    ...(value.writtenTestSupplement || []),
    ...(value.workSampleQuestions || []).filter(
      (item) =>
        !value.interviewQuestions.some(
          (question) => question.question === item.question,
        ),
    ),
  ];
  const markdown = [
    '# 重新生成的面试提纲',
    '',
    ...questions.flatMap((question, index) => [
      `## ${index + 1}. ${question.question}`,
      '',
      `来源：${question.questionSource}`,
      '',
      `考察维度：${question.dimensions.join('、')}`,
      '',
      `提问理由：${question.reason}`,
      '',
      ...(question.resumeEvidence
        ? [`简历依据：${question.resumeEvidence}`, '']
        : []),
      ...(question.workSampleEvidence
        ? [
            `作品依据：${question.workSampleEvidence.path} · ${question.workSampleEvidence.excerpt}`,
            '',
          ]
        : []),
      '观察点：',
      ...question.listenFor.map((item) => `- ${item}`),
      '',
      '追问：',
      ...question.probes.map((item) => `- ${item}`),
      '',
    ]),
  ].join('\n');
  const url = URL.createObjectURL(
    new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '重新生成的面试提纲.md';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TaskCenter({
  onOpen,
  onOpenInterview,
}: {
  onOpen?: () => void;
  onOpenInterview?: (id: string) => void;
} = {}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [detail, setDetail] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [maximumOnlineProtocol, setMaximumOnlineProtocol] = useState<
    number | null
  >(null);

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
      const [data, devices] = await Promise.all([
        remoteRequest<{ jobs: Job[] }>('/api/jobs'),
        remoteRequest<{
          devices: {
            online: boolean;
            ready: boolean;
            protocol: number | null;
          }[];
        }>('/api/devices').catch(() => null),
      ]);
      setJobs(data.jobs);
      const onlineProtocols =
        devices?.devices
          .filter((device) => device.online && device.ready)
          .map((device) => Number(device.protocol || 0)) || [];
      setMaximumOnlineProtocol(
        onlineProtocols.length ? Math.max(...onlineProtocols) : null,
      );
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

  function openInterview(job: Job) {
    if (!job.interviewId) return;
    setDetail(null);
    setOpen(false);
    onOpenInterview?.(job.interviewId);
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
            <TaskResult
              job={detail}
              back={() => setDetail(null)}
              openInterview={() => openInterview(detail)}
            />
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
                  maximumOnlineProtocol={maximumOnlineProtocol}
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

function TaskResult({
  job,
  back,
  openInterview,
}: {
  job: Job;
  back: () => void;
  openInterview: () => void;
}) {
  const report = candidateReportFromAssessmentResult(job.report);
  const priorRoundComparison =
    job.report &&
    typeof job.report === 'object' &&
    'priorRoundComparison' in job.report &&
    Array.isArray(job.report.priorRoundComparison)
      ? job.report.priorRoundComparison
      : [];
  return (
    <div className="remote-result task-center-result">
      <button className="text-button" onClick={back}>
        ← 返回任务列表
      </button>
      <span className="badge">AI 辅助结果 · 待人工核实</span>
      {job.interviewId && (
        <button className="text-button" onClick={openInterview}>
          打开面试记录
        </button>
      )}
      {!job.interviewId &&
        (job.kind === 'second-round-outline' ||
          job.kind === 'second-round-assessment') && (
          <p className="small-note">
            独立复试任务会由提交任务的浏览器自动写回原复试记录；如果资料已经变化，结果会保留在任务中心供核对。
          </p>
        )}
      {job.report && 'sections' in job.report && (
        <ResumeReadingView value={job.report} />
      )}
      {job.report &&
        job.kind === 'written-test' &&
        'questions' in job.report &&
        !('version' in job.report) && (
          <WrittenTestSupplementView questions={job.report.questions} />
        )}
      {job.report &&
        job.kind === 'written-test' &&
        'questions' in job.report &&
        'version' in job.report && (
          <OutlineV2SupplementTaskResult
            value={
              job.report as
                | OutlineV2SupplementResult
                | OutlineV3SupplementResult
            }
          />
        )}
      {job.report &&
        job.kind === 'work-sample' &&
        'dimensions' in job.report && (
          <WorkSampleTaskResult value={job.report as WorkSampleAssessment} />
        )}
      {job.report &&
        job.kind === 'work-sample' &&
        'workSample' in job.report &&
        'outlineSupplement' in job.report && (
          <>
            <WorkSampleTaskResult value={job.report.workSample} />
            <OutlineV2SupplementTaskResult
              value={job.report.outlineSupplement}
            />
          </>
        )}
      {job.report &&
        job.kind === 'outline' &&
        ('interviewQuestions' in job.report || 'outline' in job.report) && (
          <OutlineTaskResult value={job.report as OutlineRegenerationResult} />
        )}
      {job.report &&
        job.kind === 'follow-up-outline' &&
        'requestedFocus' in job.report &&
        'questions' in job.report && (
          <FollowUpOutlineTaskResult
            value={job.report as FollowUpOutlineResult}
          />
        )}
      {job.report &&
        job.kind === 'second-round-outline' &&
        'outline' in job.report && (
          <SecondRoundOutlineView
            value={(job.report as SecondRoundOutlineResult).outline}
          />
        )}
      {report && job.kind !== 'work-sample' && (
          <>
            <p>{report.summary}</p>
            {report.workSampleReview?.length ? (
              <section>
                <h4>作品表现（归属与过程待核实）</h4>
                {report.workSampleReview.map((item, index) => (
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
            {groupAssessmentDimensions(job.label, report.dimensions).map(
              (group, groupIndex) => (
                <section
                  className="assessment-group"
                  key={group.title || `dimensions-${groupIndex}`}
                >
                  {group.title && (
                    <div className="assessment-group-heading">
                      <span>能力分组</span>
                      <h3>{group.title}</h3>
                    </div>
                  )}
                  {group.dimensions.map((dimension) => (
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
                </section>
              ),
            )}
            {job.kind === 'second-round-assessment' &&
              priorRoundComparison.length > 0 && (
                <SecondRoundComparisonView
                  value={priorRoundComparison}
                />
              )}
            {report.followUps.length > 0 && (
              <section>
                <h4>待核实事项</h4>
                <ul>
                  {report.followUps.map((question, index) => (
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

function FollowUpOutlineTaskResult({
  value,
}: {
  value: FollowUpOutlineResult;
}) {
  return (
    <section>
      <h4>关注点：{value.requestedFocus}</h4>
      <ol>
        {value.questions.map((question) => (
          <li key={question.id}>{question.question}</li>
        ))}
      </ol>
    </section>
  );
}

function OutlineV2SupplementTaskResult({
  value,
}: {
  value: OutlineV2SupplementResult | OutlineV3SupplementResult;
}) {
  return (
    <section>
      <h4>
        {value.kind === 'work-sample' ? '作品复盘候选题' : '笔试复盘候选题'}
      </h4>
      <p className="small-note">已更新对应面试记录的候选区。</p>
      <ol>
        {value.questions.map((question) => (
          <li key={question.id}>
            <strong>{question.question}</strong>
            <span>{question.primaryDimension}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function OutlineTaskResult({ value }: { value: OutlineRegenerationResult }) {
  if ('outline' in value)
    return (
      <section>
        <h4>重新生成的面试提纲</h4>
        <InterviewOutlineV2View outline={value.outline} />
        <p className="small-note">请回到对应面试记录确认已自动应用。</p>
        <button
          className="primary-button"
          onClick={() => downloadOutline(value)}
        >
          <Download size={16} /> 下载提纲 Markdown
        </button>
      </section>
    );
  const questions = [
    ...value.interviewQuestions,
    ...(value.writtenTestSupplement || []),
    ...(value.workSampleQuestions || []).filter(
      (item) =>
        !value.interviewQuestions.some(
          (question) => question.question === item.question,
        ),
    ),
  ];
  return (
    <section>
      <h4>重新生成的面试提纲</h4>
      <ol>
        {questions.map((question, index) => (
          <li key={`${question.questionSource}-${index}`}>
            {question.question}
          </li>
        ))}
      </ol>
      <p className="small-note">请回到对应面试记录确认已自动应用。</p>
      <button className="primary-button" onClick={() => downloadOutline(value)}>
        <Download size={16} /> 下载提纲 Markdown
      </button>
    </section>
  );
}

function WorkSampleTaskResult({ value }: { value: WorkSampleAssessment }) {
  return (
    <>
      <p className="small-note">{workSampleRubricLabel(value)}</p>
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
                {dimension.score === null
                  ? '待面试核实'
                  : `${dimension.score}/5`}
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
