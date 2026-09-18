import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import {
  validateInitialOutlineInput,
  validateInitialOutlineResult,
} from '../lib/initial-outline.ts';
import { validateResumeExperienceMap } from '../lib/resume-experience-map.ts';

const standards = builtInRoleTemplates[0];
const resumeText = '姓名：林小满。参与校园用户访谈项目，主动组织校园用户访谈。';
const dimensions = standards.dimensionText.split('、');
const experienceMap = validateResumeExperienceMap(
  {
    version: 1,
    summary: '识别到一段项目经历。',
    experiences: [
      {
        id: 'experience-1',
        sourceOrder: 1,
        type: 'project',
        name: '校园用户访谈项目',
        nameEvidence: '校园用户访谈项目',
        organization: null,
        period: null,
        role: null,
        context: null,
        actions: [
          { text: '主动组织访谈', evidence: '主动组织校园用户访谈' },
        ],
        decisions: [],
        collaboration: [],
        outcomes: [],
        reflection: [],
        evidence: ['主动组织校园用户访谈'],
        dimensionSignals: ['自驱力与结果闭环'],
        missingInformation: [],
      },
    ],
    coverage: [
      {
        source: '校园用户访谈项目',
        experienceId: 'experience-1',
        status: 'mapped',
      },
    ],
    unresolvedItems: [],
  },
  { resumeText, dimensions },
);

void test('initial outline validation attaches the verified map to the reading', () => {
  const input = validateInitialOutlineInput({
    ...standards,
    resumeText,
    hasWrittenTest: false,
    outlineVersion: 1,
    experienceMap,
  });
  const reading = validateInitialOutlineResult(
    {
      candidateName: '林小满',
      candidateNameEvidence: '姓名：林小满',
      summary: '候选人简历包含校园项目经历，尚待面试核实。',
      sections: [
        { name: '教育背景', items: [] },
        { name: '工作经历', items: [] },
        {
          name: '项目经验',
          items: [
            {
              text: '组织校园用户访谈',
              evidence: '主动组织校园用户访谈',
            },
          ],
        },
        { name: '技能', items: [] },
      ],
      followUps: [],
      interviewQuestions: Array.from({ length: 6 }, (_, index) => ({
        question: `方便聊聊第${index + 1}次关键判断吗？`,
        questionSource: 'role',
        dimensions: [dimensions[index]],
        reason: '了解候选人的实际思考。',
        resumeEvidence: null,
        workSampleEvidence: null,
        listenFor: ['候选人自己的行动'],
        probes: ['当时你先做了什么？'],
      })),
    },
    input,
  );
  assert.deepEqual(reading.experienceMap, experienceMap);
});
