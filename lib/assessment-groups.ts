export const GENERAL_COMPETENCY_NAMES = [
  '自驱力与结果闭环',
  '学习力',
  '挑战力与韧性',
  '团队精神与沟通协作',
] as const;

export const AI_PM_PRODUCT_COMPETENCY_NAMES = [
  '用户洞察与问题定义',
  '产品方案与范围取舍',
  'AI 理解与产品化判断',
  '数据验证与迭代意识',
] as const;

export const PRODUCT_OPERATIONS_COMPETENCY_NAMES = [
  '用户理解与用户分层',
  '用户生命周期与关系运营',
  '运营策略与落地执行',
  '数据分析与增长实验',
] as const;

export type AssessmentGroup<T> = {
  title: '通用素质能力' | '产品能力' | '运营能力' | null;
  dimensions: T[];
};

const roleGroups = [
  {
    role: 'AI 产品经理（校招）',
    title: '产品能力' as const,
    names: AI_PM_PRODUCT_COMPETENCY_NAMES,
  },
  {
    role: '产品运营（校招）',
    title: '运营能力' as const,
    names: PRODUCT_OPERATIONS_COMPETENCY_NAMES,
  },
] as const;

export function groupAssessmentDimensions<T extends { name: string }>(
  roleOrLabel: string,
  dimensions: readonly T[],
): AssessmentGroup<T>[] {
  const role = roleGroups.find(({ role }) => roleOrLabel.includes(role));
  if (!role) return [{ title: null, dimensions: Array.from(dimensions) }];
  const expected = [...role.names, ...GENERAL_COMPETENCY_NAMES];
  const byName = new Map(
    dimensions.map((dimension) => [dimension.name, dimension]),
  );
  if (
    dimensions.length !== expected.length ||
    byName.size !== dimensions.length ||
    expected.some((name) => !byName.has(name))
  )
    return [{ title: null, dimensions: Array.from(dimensions) }];
  return [
    {
      title: '通用素质能力',
      dimensions: GENERAL_COMPETENCY_NAMES.map((name) => byName.get(name)!),
    },
    {
      title: role.title,
      dimensions: role.names.map((name) => byName.get(name)!),
    },
  ];
}
