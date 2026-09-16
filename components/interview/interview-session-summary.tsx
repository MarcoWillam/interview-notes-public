'use client';

import { Settings2 } from 'lucide-react';
import {
  interviewStatusLabel,
  type InterviewStatus,
} from '@/lib/interview-status';
import type { InterviewStage, PriorRoundSource } from '@/lib/second-round';

export type InterviewSessionSummaryProps = {
  candidate: string;
  role: string;
  status: InterviewStatus;
  writtenTestSupported: boolean;
  writtenTestConfirmed: boolean;
  hasWrittenTest: boolean;
  writtenTestSupplemented: boolean;
  workSampleAnalyzed?: boolean;
  outlineLocked: boolean;
  disabled: boolean;
  open: boolean;
  onOpen: () => void;
  interviewStage?: InterviewStage;
  priorRoundSource?: PriorRoundSource;
};

export function InterviewSessionSummary({
  candidate,
  role,
  status,
  writtenTestSupported,
  writtenTestConfirmed,
  hasWrittenTest,
  writtenTestSupplemented,
  workSampleAnalyzed = false,
  outlineLocked,
  disabled,
  open,
  onOpen,
  interviewStage = 'initial',
  priorRoundSource,
}: InterviewSessionSummaryProps) {
  const writtenTestStatus = !writtenTestConfirmed
    ? '待确认'
    : hasWrittenTest
      ? workSampleAnalyzed
        ? '有笔试 · 作品已分析'
        : writtenTestSupplemented
          ? '有笔试 · 已补充'
          : '有笔试'
      : '无笔试';

  return (
    <section className="interview-session-summary" aria-label="本场面试状态">
      <dl>
        <div>
          <dt>阶段</dt>
          <dd>{interviewStage === 'second' ? '复试' : '初试'}</dd>
        </div>
        <div>
          <dt>候选人</dt>
          <dd>{candidate || '待补充'}</dd>
        </div>
        <div>
          <dt>岗位</dt>
          <dd>{role || '待选择'}</dd>
        </div>
        {interviewStage === 'second' && (
          <div>
            <dt>初试来源</dt>
            <dd>
              {priorRoundSource === 'bole-markdown' ? '伯乐 AI' : '外部记录'}
            </dd>
          </div>
        )}
        {interviewStage === 'initial' && writtenTestSupported && (
          <div>
            <dt>笔试</dt>
            <dd>{writtenTestStatus}</dd>
          </div>
        )}
        <div>
          <dt>提纲</dt>
          <dd>{outlineLocked ? '已生成' : '待生成'}</dd>
        </div>
        <div>
          <dt>进度</dt>
          <dd>
            <span className="interview-status-badge" data-status={status}>
              {interviewStatusLabel(status)}
            </span>
          </dd>
        </div>
      </dl>
      <button
        className="secondary-button"
        disabled={disabled}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Settings2 size={16} /> 面试设置
      </button>
    </section>
  );
}
