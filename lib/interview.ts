export type InterviewInput = {
  role: string;
  requirements: string;
  transcript: string;
  dimensions: string[];
};
export type Assessment = {
  name: string;
  score: number | null;
  assessment: string;
  evidence: string[];
};
export type Report = {
  summary: string;
  dimensions: Assessment[];
  followUps: string[];
};
function boundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`${label}不能为空且长度须在限制内`);
  return value.trim();
}
export function validateInput(value: unknown): InterviewInput {
  if (!value || typeof value !== 'object')
    throw new Error('面试资料格式不正确');
  const v = value as Record<string, unknown>;
  const role = boundedString(v.role, 200, '岗位');
  const requirements = boundedString(v.requirements, 10000, '岗位要求');
  const transcript = boundedString(v.transcript, 80000, '对话记录');
  if (
    !Array.isArray(v.dimensions) ||
    v.dimensions.length < 1 ||
    v.dimensions.length > 8
  )
    throw new Error('请填写 1–8 个评估维度');
  const dimensions = v.dimensions.map((d) => boundedString(d, 60, '评估维度'));
  if (new Set(dimensions).size !== dimensions.length)
    throw new Error('评估维度不能重复');
  return { role, requirements, transcript, dimensions };
}
export function validateReport(value: unknown, input: InterviewInput): Report {
  if (!value || typeof value !== 'object') throw new Error('评估返回格式错误');
  const v = value as Record<string, unknown>;
  const summary = boundedString(v.summary, 4000, '评估摘要');
  if (
    !Array.isArray(v.dimensions) ||
    v.dimensions.length !== input.dimensions.length
  )
    throw new Error('评估维度不完整');
  const dimensions = input.dimensions.map((name) => {
    const found = v.dimensions as Record<string, unknown>[];
    const matches = found.filter((d) => d && d.name === name);
    if (matches.length !== 1) throw new Error('评估维度不匹配');
    const d = matches[0];
    const assessment = boundedString(d.assessment, 3000, '维度说明');
    if (!Array.isArray(d.evidence) || d.evidence.length > 8)
      throw new Error('引用格式错误');
    const evidence = d.evidence.map((q) => boundedString(q, 2000, '引用原文'));
    if (evidence.some((q) => !input.transcript.includes(q)))
      throw new Error('评估引用无法在对话中找到，请重试');
    if (
      d.score !== null &&
      (typeof d.score !== 'number' ||
        !Number.isInteger(d.score) ||
        d.score < 1 ||
        d.score > 5)
    )
      throw new Error('评分须为 1–5 的整数或 null');
    if (evidence.length === 0 && d.score !== null)
      throw new Error('没有对话证据的维度不能评分');
    return { name, assessment, evidence, score: d.score as number | null };
  });
  if (!Array.isArray(v.followUps) || v.followUps.length > 12)
    throw new Error('待核实事项格式错误');
  return {
    summary,
    dimensions,
    followUps: v.followUps.map((q) => boundedString(q, 1000, '待核实事项')),
  };
}

export function exportMarkdown(
  candidate: string,
  input: InterviewInput,
  report: Report | null,
  conclusion: string,
  confirmed: boolean,
): string {
  const lines = [
    '# 面试评估记录',
    '',
    `候选人：${candidate || '未填写'}`,
    `岗位：${input.role || '未填写'}`,
    `状态：${confirmed ? '面试官已确认' : '草稿 · 未确认'}`,
    '',
    '## 岗位要求',
    input.requirements,
    '',
    '## 评估维度',
    input.dimensions.join('、'),
  ];
  if (report) {
    lines.push('', '## AI 辅助评估（需人工核实）', report.summary);
    for (const d of report.dimensions)
      lines.push(
        '',
        `### ${d.name} · ${d.score === null ? '证据不足' : d.score + '/5'}`,
        d.assessment,
        ...d.evidence.map((q) => '> ' + q.replaceAll('\n', '\n> ')),
      );
    lines.push('', '## 待核实事项', ...report.followUps.map((q) => '- ' + q));
  } else lines.push('', 'AI 评估：未生成。');
  lines.push(
    '',
    '## 面试官结论',
    conclusion || '尚未填写',
    '',
    '## 对话记录（人工校对文本）',
    input.transcript || '尚未录入',
  );
  return lines.join('\n');
}
