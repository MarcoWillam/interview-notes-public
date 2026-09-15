import type {
  FollowUpOutlineGroup,
  FollowUpOutlineInput,
  FollowUpOutlineResult,
} from '../../lib/follow-up-outline.ts';

const resumeText = '姓名：张三。我主动发起用户访谈，并访谈了五位用户。';

const resumeReading = {
  candidateName: '张三',
  candidateNameEvidence: '姓名：张三',
  summary: '有用户访谈相关自述。',
  sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
    name,
    items: [],
  })),
  followUps: [],
  interviewQuestions: Array.from({ length: 6 }, (_, index) => ({
    question: `请讲讲第${index + 1}次主动推进问题的经历？`,
    questionSource: index === 0 ? ('resume' as const) : ('role' as const),
    dimensions: ['自驱力'],
    reason: '核实个人行动与结果。',
    resumeEvidence: index === 0 ? '我主动发起用户访谈' : null,
    listenFor: ['具体行动', '结果验证'],
    probes: ['你本人具体做了什么？'],
  })),
};

export const followUpInputFixture = (): FollowUpOutlineInput => ({
  role: 'AI 产品经理（校招）',
  requirements: '能够主动发现用户问题并推动验证。',
  dimensionText: '产品能力、自驱力、学习力、挑战力、团队精神',
  focus: '关注候选人的具体行动。',
  scoringGuidance: '只依据可核实事实。',
  reportRequirements: '标明证据边界。',
  resumeText,
  resumeReading,
  outlineVersion: 1 as const,
  requestedFocus: '自驱力',
  existingSupplements: [],
});

export const followUpResultFixture = (): FollowUpOutlineResult => ({
  version: 1 as const,
  requestedFocus: '自驱力',
  questions: [
    {
      id: 'follow-up-question-1',
      question: '请讲讲你主动发现并推动问题解决的经历？',
      goal: '核实是否能在缺少明确安排时主动识别问题并闭环。',
      resumeEvidence: '我主动发起用户访谈',
      listenFor: ['问题如何被发现', '个人采取的行动'],
      riskSignals: ['只描述团队成果'],
      probes: [
        {
          condition: '缺少个人行动',
          question: '其中哪一步是你主动提出并完成的？',
        },
      ],
    },
    {
      id: 'follow-up-question-2',
      question: '目标还不清楚时，你通常怎样主动推进事情？',
      goal: '核实面对模糊目标时的行动方式。',
      resumeEvidence: null,
      listenFor: ['拆解目标的方法', '主动协调资源'],
      riskSignals: ['等待他人给出完整步骤'],
      probes: [
        {
          condition: '回答停留在方法',
          question: '能结合一次真实经历说明吗？',
        },
      ],
    },
  ],
});

export const followUpGroupFixture = (): FollowUpOutlineGroup => ({
  ...followUpResultFixture(),
  id: 'follow-up-group-12345678',
  jobId: 'follow-up-job-12345678',
  createdAt: 1_000_000,
});
