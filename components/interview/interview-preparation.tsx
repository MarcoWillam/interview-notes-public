'use client';

import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { StandardsFields } from '@/components/interview/standards-fields';
import type { InterviewStandards } from '@/lib/standards';
import {
  COMMON_TEMPLATE_ID,
  TEMPLATE_STATUS_VALUE,
  type TemplateSelection,
} from '@/lib/interview-template-state';

export function InterviewPreparation({
  candidate,
  standards,
  templates,
  disabled,
  standardsLocked,
  standardsOpen,
  templateSelection,
  hasWrittenTest,
  writtenTestConfirmed,
  writtenTestSupported,
  serviceReady,
  serviceStatus,
  onCandidateChange,
  onStandardsChange,
  onApplyTemplate,
  onStandardsOpenChange,
  onOpenService,
}: {
  candidate: string;
  standards: InterviewStandards;
  templates: { id: string; name: string }[];
  disabled: boolean;
  standardsLocked: boolean;
  standardsOpen: boolean;
  templateSelection: TemplateSelection;
  hasWrittenTest: boolean;
  writtenTestConfirmed: boolean;
  writtenTestSupported: boolean;
  serviceReady: boolean;
  serviceStatus: string;
  onCandidateChange: (value: string) => void;
  onStandardsChange: (value: InterviewStandards) => void;
  onApplyTemplate: (id: string) => void;
  onStandardsOpenChange: (open: boolean) => void;
  onOpenService: () => void;
}) {
  return (
    <div className="interview-preparation">
      <p className="small-note">本场标准独立保存，全局修改不会覆盖这场面试。</p>
      <fieldset disabled={disabled}>
        <label>
          候选人
          <input
            value={candidate}
            maxLength={100}
            onChange={(event) => onCandidateChange(event.target.value)}
            placeholder="输入候选人姓名"
          />
        </label>
      </fieldset>
      <fieldset disabled={disabled || standardsLocked}>
        <label className="session-template-picker">
          选择岗位模板
          <span className="session-template-select">
            <select
              value={templateSelection.selectValue}
              onChange={(event) => onApplyTemplate(event.target.value)}
            >
              {templateSelection.selectValue === TEMPLATE_STATUS_VALUE && (
                <option value={TEMPLATE_STATUS_VALUE} disabled>
                  {templateSelection.label}
                </option>
              )}
              <option value={COMMON_TEMPLATE_ID}>通用默认标准</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        {writtenTestSupported && (
          <div className="written-test-status">
            <span>笔试情况</span>
            <strong className={writtenTestConfirmed ? 'confirmed' : 'pending'}>
              {writtenTestConfirmed
                ? hasWrittenTest
                  ? '有笔试'
                  : '无笔试'
                : '待确认'}
            </strong>
          </div>
        )}
        <p className="small-note">
          {standardsLocked
            ? '提纲已生成，岗位模板和本场标准已锁定。'
            : '模板在页头的“全局设置”中管理。应用模板将替换本场标准并清除旧 AI 评估。'}
        </p>
        <div className="session-standard-summary">
          <strong>{standards.role || '尚未选择岗位'}</strong>
          <p>{standards.dimensionText || '尚未设置评估维度'}</p>
        </div>
        <details
          className="session-standards-details"
          open={standardsOpen}
          onToggle={(event) => onStandardsOpenChange(event.currentTarget.open)}
        >
          <summary>查看 / 调整本场标准</summary>
          <StandardsFields value={standards} onChange={onStandardsChange} />
        </details>
      </fieldset>
      <div className="service-summary">
        <span className={`service-dot ${serviceReady ? 'ready' : ''}`} />
        <span>{serviceStatus}</span>
        <button className="text-button" onClick={onOpenService}>
          查看 <ArrowUpRight size={13} />
        </button>
      </div>
    </div>
  );
}
