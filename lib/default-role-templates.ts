export type RoleTemplate = Readonly<{
  id: string;
  name: string;
  role: string;
  requirements: string;
  dimensionText: string;
  focus: string;
  scoringGuidance: string;
  reportRequirements: string;
}>;

export const BUILTIN_TEMPLATE_IDS = {
  aiProductManager: 'builtin-campus-ai-product-manager',
  productOperations: 'builtin-campus-product-operations',
} as const;

export const builtInRoleTemplates = [
  {
    id: BUILTIN_TEMPLATE_IDS.aiProductManager,
    name: 'AI 产品经理（校招）',
    role: 'AI 产品经理（校招）',
    requirements:
      '面向应届毕业生，考察候选人能否从真实用户问题出发，完成产品方案、范围取舍、AI 能力产品化与数据验证。候选人有产品、研究、原型或 AI 实践作品时作为参考，但作品不是必备条件。笔试只固化考察框架：问题定义、用户理解、范围取舍、AI 核心价值、人与 AI 责任、用户控制、失败降级、验证假设、产品化判断；模板不保存具体题目。',
    dimensionText:
      '用户洞察与问题定义、产品方案与范围取舍、AI 理解与产品化判断、数据验证与迭代意识、自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作',
    focus:
      '围绕八个维度追问候选人的具体行动、判断依据、协作过程和结果证据。自驱力单列并重点评估，关注是否主动发现问题、推动落地、复盘结果并完成闭环；同时兼顾学习力、挑战力与韧性、团队精神与沟通协作。',
    scoringGuidance:
      '每个维度独立评分，以可核验的经历、作品过程或情境回答为证据；不因有无作品直接加减分。明确区分已验证事实、候选人自述与待追问假设。',
    reportRequirements:
      '报告须按八个维度列出证据、判断与待核实点，并单列自驱力与结果闭环的关键证据。模板不自动给出录用或淘汰结论，最终决定由面试官基于完整信息确认。',
  },
  {
    id: BUILTIN_TEMPLATE_IDS.productOperations,
    name: '产品运营（校招）',
    role: '产品运营（校招）',
    requirements:
      '面向应届毕业生，按用户运营 60% 与数据增长 40% 的能力比重考察。候选人需能理解并分层用户，围绕用户生命周期设计关系运营策略并推动落地，同时能运用数据分析定位问题、设计增长实验并根据结果迭代。',
    dimensionText:
      '用户理解与用户分层、用户生命周期与关系运营、运营策略与落地执行、数据分析与增长实验、自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作',
    focus:
      '用户运营部分重点追问用户分层、触达、活跃、留存与关系维护的真实实践；数据增长部分重点追问指标选择、实验假设、执行与复盘。自驱力单列并重点评估，关注是否主动承担、推动跨团队协作并为结果负责；同时兼顾学习力、挑战力与韧性、团队精神与沟通协作。',
    scoringGuidance:
      '每个维度独立评分，整体证据权重保持用户运营 60% 、数据增长 40%。以候选人的具体行动、数据或可核实结果为主，明确标记缺少证据的判断。',
    reportRequirements:
      '报告须按八个维度列出证据、判断与待核实点，体现用户运营 60% 与数据增长 40% 的比重，并单列自驱力与结果闭环的关键证据。模板不自动给出录用或淘汰结论，最终决定由面试官基于完整信息确认。',
  },
] as const satisfies readonly RoleTemplate[];
