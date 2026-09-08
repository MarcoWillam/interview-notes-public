export type InterviewStandards = {
  role: string;
  requirements: string;
  dimensionText: string;
  focus: string;
  scoringGuidance: string;
  reportRequirements: string;
};
export type GlobalSettings = {
  id: 'global';
  defaultTemplateId: string | null;
  defaults: InterviewStandards;
};
export const defaultStandards: InterviewStandards = {
  role: '',
  requirements: '',
  dimensionText: '专业能力、问题解决、沟通协作、岗位匹配',
  focus: '',
  scoringGuidance: '',
  reportRequirements: '',
};
// Pick fields explicitly so a template never copies candidate data or its ID.
export function normalizeStandards(
  value: Partial<InterviewStandards>,
): InterviewStandards {
  return Object.fromEntries(
    Object.entries(defaultStandards).map(([key, fallback]) => [
      key,
      value[key as keyof InterviewStandards] ?? fallback,
    ]),
  ) as InterviewStandards;
}
export function validateStandards(
  value: InterviewStandards,
  requireRole: boolean,
) {
  const limits: Record<keyof InterviewStandards, number> = {
    role: 200,
    requirements: 10000,
    dimensionText: 480,
    focus: 8000,
    scoringGuidance: 4000,
    reportRequirements: 4000,
  };
  for (const key of Object.keys(limits) as (keyof InterviewStandards)[]) {
    if (typeof value[key] !== 'string' || value[key].length > limits[key])
      throw new Error('面试标准超过长度限制');
  }
  if (requireRole && (!value.role.trim() || !value.requirements.trim()))
    throw new Error('请填写岗位及岗位要求');
  const dimensions = value.dimensionText
    .split(/[、,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !dimensions.length ||
    dimensions.length > 8 ||
    dimensions.some((s) => s.length > 60) ||
    new Set(dimensions).size !== dimensions.length
  )
    throw new Error('请填写 1–8 个不重复的评估维度，每项最多 60 字');
}
