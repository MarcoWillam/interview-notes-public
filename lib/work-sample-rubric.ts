export const AI_PM_WORK_SAMPLE_RUBRIC_VERSION =
  'ai-pm-written-test-v1' as const;

export const aiPmWorkSampleRubric = [
  {
    name: '用户问题与场景理解',
    priority: 15,
    focus: '识别真实用户、关键时刻和优先问题，不围绕功能反推需求。',
  },
  {
    name: '产品方案与范围取舍',
    priority: 20,
    focus: '形成最小核心闭环，说明关键决策、范围边界和主动放弃的内容。',
  },
  {
    name: 'AI 理解与产品判断',
    priority: 25,
    focus: '判断 AI 的核心价值、人与 AI 的责任、用户控制、失败和不确定性。',
  },
  {
    name: '验证与迭代设计',
    priority: 15,
    focus: '明确关键假设、成功信号、验证方法和下一步验证事项。',
  },
  {
    name: '产品化与商业判断',
    priority: 10,
    focus: '判断产品形态、最小市场切入点、重复使用理由和可能的付费方。',
  },
  {
    name: 'Demo 与表达',
    priority: 15,
    focus: '用材料清楚证明产品逻辑、核心用户闭环和重要限制。',
  },
] as const;

export const aiPmWorkSampleRubricNames = aiPmWorkSampleRubric.map(
  ({ name }) => name,
);

export const aiPmWorkSampleRubricPrompt = [
  `统一出题目的框架版本：${AI_PM_WORK_SAMPLE_RUBRIC_VERSION}。`,
  '必须严格按以下六个作品维度及顺序返回 dimensions：',
  ...aiPmWorkSampleRubric.map(
    ({ name, priority, focus }) => `${name}（优先级 ${priority}%）：${focus}`,
  ),
  '优先级只决定证据覆盖和追问强度，不计算或输出 100 分总分。',
  '材料没有覆盖或无法读取时返回 score=null；只有材料明确表现不足时才评 1 分，不能把缺少材料描述成候选人没有能力。',
  '评分锚点：1 严重偏离；2 表层完成但关键判断浅；3 达到校招基础要求；4 判断清晰且能说明取舍、验证和不确定性；5 主动识别关键矛盾并形成产品化与验证闭环。',
  '不得用代码量、界面精美度、模型数量、提示词复杂度或工程规范替代产品判断。',
].join('\n');
