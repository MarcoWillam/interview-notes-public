import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  experienceContextLabel,
  validateResumeExperienceMap,
} from '../lib/resume-experience-map.ts';

const resumeText = [
  '实习经历',
  '星云科技｜产品实习生｜2025.03-2025.06',
  '客服 AI 项目',
  '负责访谈一线客服并搭建监测看板，推动团队调整问题分类。',
  '个人实践',
  '独立制作校园活动报名工具，上线后服务 300 名同学。',
].join('\n');

const dimensions = ['用户洞察', '自驱力与结果闭环'];

function validMap() {
  return {
    version: 1,
    summary: '识别到一段实习项目和一段个人实践，内容来自简历自述。',
    experiences: [
      {
        id: 'experience-1',
        sourceOrder: 1,
        type: 'internship',
        name: '客服 AI 项目',
        nameEvidence: '客服 AI 项目',
        organization: { text: '星云科技', evidence: '星云科技' },
        period: { text: '2025.03-2025.06', evidence: '2025.03-2025.06' },
        role: { text: '产品实习生', evidence: '产品实习生' },
        context: null,
        actions: [
          {
            text: '访谈一线客服并搭建监测看板',
            evidence: '负责访谈一线客服并搭建监测看板',
          },
        ],
        decisions: [],
        collaboration: [
          {
            text: '推动团队调整问题分类',
            evidence: '推动团队调整问题分类',
          },
        ],
        outcomes: [],
        reflection: [],
        evidence: ['客服 AI 项目', '负责访谈一线客服并搭建监测看板'],
        dimensionSignals: ['用户洞察'],
        missingInformation: ['项目结果未明确'],
      },
      {
        id: 'experience-2',
        sourceOrder: 2,
        type: 'personal-project',
        name: '简历中未明确具体项目',
        nameEvidence: null,
        organization: null,
        period: null,
        role: null,
        context: null,
        actions: [
          {
            text: '独立制作校园活动报名工具',
            evidence: '独立制作校园活动报名工具',
          },
        ],
        decisions: [],
        collaboration: [],
        outcomes: [
          {
            text: '服务 300 名同学',
            evidence: '服务 300 名同学',
          },
        ],
        reflection: [],
        evidence: ['独立制作校园活动报名工具'],
        dimensionSignals: ['自驱力与结果闭环'],
        missingInformation: ['项目名称未明确'],
      },
    ],
    coverage: [
      {
        source: '客服 AI 项目',
        experienceId: 'experience-1',
        status: 'mapped',
      },
      {
        source: '个人实践',
        experienceId: 'experience-2',
        status: 'mapped',
      },
    ],
    unresolvedItems: [],
  };
}

void test('validates an ordered full experience map with literal evidence', () => {
  const result = validateResumeExperienceMap(validMap(), {
    resumeText,
    dimensions,
  });
  assert.equal(result.experiences.length, 2);
  assert.equal(
    result.experiences[0].actions[0].evidence,
    '负责访谈一线客服并搭建监测看板',
  );
  assert.equal(result.experiences[1].name, '简历中未明确具体项目');
  assert.equal(experienceContextLabel(result.experiences[0]), '客服 AI 项目');
  assert.equal(
    experienceContextLabel(result.experiences[1]),
    '校园活动报名工具经历',
  );
});

void test('rejects fabricated facts and unknown dimensions', () => {
  const fabricated = validMap();
  fabricated.experiences[0].actions[0].evidence = '负责制定完整商业化战略';
  assert.throws(
    () => validateResumeExperienceMap(fabricated, { resumeText, dimensions }),
    /简历原文/,
  );

  const unknownDimension = validMap();
  unknownDimension.experiences[0].dimensionSignals = ['领导力'];
  assert.throws(
    () =>
      validateResumeExperienceMap(unknownDimension, {
        resumeText,
        dimensions,
      }),
    /未知考核维度/,
  );
});

void test('rejects duplicate order and coverage pointing to a missing experience', () => {
  const duplicateOrder = validMap();
  duplicateOrder.experiences[1].sourceOrder = 1;
  assert.throws(
    () =>
      validateResumeExperienceMap(duplicateOrder, { resumeText, dimensions }),
    /顺序/,
  );

  const missing = validMap();
  missing.coverage[1].experienceId = 'experience-404';
  assert.throws(
    () => validateResumeExperienceMap(missing, { resumeText, dimensions }),
    /经历编号/,
  );
});

void test('requires the unified fallback name when a project name lacks evidence', () => {
  const map = validMap();
  map.experiences[1].name = '校园报名工具';
  assert.throws(
    () => validateResumeExperienceMap(map, { resumeText, dimensions }),
    /项目名称/,
  );
});
