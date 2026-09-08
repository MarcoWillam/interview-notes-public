'use client';
import type { InterviewStandards } from '@/lib/standards';
export function StandardsFields({
  value,
  onChange,
  includeRole = true,
}: {
  value: InterviewStandards;
  onChange: (value: InterviewStandards) => void;
  includeRole?: boolean;
}) {
  const change = (key: keyof InterviewStandards, text: string) =>
    onChange({ ...value, [key]: text });
  return (
    <div className="standards-fields">
      {includeRole && (
        <>
          <label>
            应聘岗位 <span className="required">*</span>
            <input
              maxLength={200}
              value={value.role}
              onChange={(e) => change('role', e.target.value)}
              placeholder="例如：产品经理"
            />
          </label>
          <label>
            岗位要求 <span className="required">*</span>
            <textarea
              rows={4}
              maxLength={10000}
              value={value.requirements}
              onChange={(e) => change('requirements', e.target.value)}
              placeholder="核心职责、能力和经验要求"
            />
          </label>
        </>
      )}
      <label>
        评估维度 <span className="required">*</span>
        <textarea
          rows={2}
          maxLength={480}
          value={value.dimensionText}
          onChange={(e) => change('dimensionText', e.target.value)}
        />
      </label>
      <p className="small-note">
        用顿号或换行分隔，支持 1–8 项，每项最多 60 字。
      </p>
      <label>
        重点考察事项
        <textarea
          rows={3}
          maxLength={8000}
          value={value.focus}
          onChange={(e) => change('focus', e.target.value)}
          placeholder="例如：项目结果、本人贡献及决策依据"
        />
      </label>
      <label>
        补充评分标准
        <textarea
          rows={3}
          maxLength={4000}
          value={value.scoringGuidance}
          onChange={(e) => change('scoringGuidance', e.target.value)}
          placeholder="例如：3 分需有独立负责项目的明确证据"
        />
      </label>
      <p className="small-note">
        采用 1–5 分；没有对话证据不评分。此处补充具体判断标准。
      </p>
      <label>
        报告要求
        <textarea
          rows={3}
          maxLength={4000}
          value={value.reportRequirements}
          onChange={(e) => change('reportRequirements', e.target.value)}
          placeholder="例如：摘要简洁，明确列出待核实事项"
        />
      </label>
      <p className="small-note">调整报告的内容重点，保留原文引用与人工确认。</p>
    </div>
  );
}
