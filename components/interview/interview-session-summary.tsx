'use client';

import { Settings2 } from 'lucide-react';

export type InterviewSessionSummaryProps = {
  candidate: string;
  role: string;
  writtenTestSupported: boolean;
  writtenTestConfirmed: boolean;
  hasWrittenTest: boolean;
  writtenTestSupplemented: boolean;
  outlineLocked: boolean;
  disabled: boolean;
  open: boolean;
  onOpen: () => void;
};

export function InterviewSessionSummary({
  candidate,
  role,
  writtenTestSupported,
  writtenTestConfirmed,
  hasWrittenTest,
  writtenTestSupplemented,
  outlineLocked,
  disabled,
  open,
  onOpen,
}: InterviewSessionSummaryProps) {
  const writtenTestStatus = !writtenTestConfirmed
    ? '待确认'
    : hasWrittenTest
      ? writtenTestSupplemented
        ? '有笔试 · 已补充'
        : '有笔试'
      : '无笔试';

  return (
    <section className="interview-session-summary" aria-label="本场面试状态">
      <dl>
        <div>
          <dt>候选人</dt>
          <dd>{candidate || '待补充'}</dd>
        </div>
        <div>
          <dt>岗位</dt>
          <dd>{role || '待选择'}</dd>
        </div>
        {writtenTestSupported && (
          <div>
            <dt>笔试</dt>
            <dd>{writtenTestStatus}</dd>
          </div>
        )}
        <div>
          <dt>提纲</dt>
          <dd>{outlineLocked ? '已生成' : '待生成'}</dd>
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
