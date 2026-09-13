import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import {
  analyzeWorkSampleWithCodex,
  readResumeAndWorkSampleWithCodex,
} from '../server/work-samples/analyze.ts';
import {
  AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
  aiPmWorkSampleRubric,
} from '../lib/work-sample-rubric.ts';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import {
  calculateOutlineCoverage,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';

const standards = {
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题并设计可验证的 AI 产品方案',
  dimensionText: '问题定义、方案取舍、数据验证、自驱力',
  focus: '重点核实自驱力和方案判断',
  scoringGuidance: '仅依据可核实证据评分',
  reportRequirements: '区分作品观察与候选人能力',
};
const resumeText = '姓名：张三。我主动访谈了五位用户。';
const artifactBase = {
  id: 'artifact-12345678',
  deviceId: 'device-12345678',
  name: 'candidate.zip',
  bytes: 1,
  modifiedAt: 123,
};
const question = (
  index: number,
  source: 'resume' | 'role' | 'work-sample',
) => ({
  question: `第 ${index + 1} 题：这项判断的核心依据是什么？`,
  questionSource: source,
  dimensions: [index === 1 ? '方案取舍' : '问题定义'],
  reason:
    index === 0 ? '核实主动发现问题和推动行动的自驱力。' : '核实方案判断。',
  resumeEvidence: source === 'resume' ? '我主动访谈了五位用户。' : null,
  ...(source === 'work-sample'
    ? {
        workSampleEvidence: {
          path: 'docs/brief.md',
          excerpt: '目标用户是新手卖家',
        },
      }
    : {}),
  listenFor: ['判断依据'],
  probes: ['如果假设不成立会如何调整？'],
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'interview-work-runner-test-'));
  const zip = join(root, 'candidate.zip');
  const bytes = zipSync({
    'docs/brief.md': strToU8('目标用户是新手卖家\n先验证首次使用成功率。'),
    'src/demo.ts': strToU8('export const fallback = true;'),
  });
  await writeFile(zip, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    root,
    zip,
    reference: { ...artifactBase, sha256, bytes: bytes.length },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function assessment(
  reference: Awaited<ReturnType<typeof fixture>>['reference'],
) {
  const questions = [1, 2, 3].map((index) => ({
    ...question(index, 'work-sample'),
    question: `作品复盘第 ${index} 题：哪项依据最关键？`,
  }));
  return {
    rubricVersion: AI_PM_WORK_SAMPLE_RUBRIC_VERSION,
    artifact: {
      id: reference.id,
      name: reference.name,
      sha256: reference.sha256,
      bytes: reference.bytes,
      modifiedAt: reference.modifiedAt,
    },
    coverage: { analyzed: [], excluded: [], unsupported: [], truncated: false },
    summary: '作品定义了目标用户和验证方案，作者身份与完成过程待面试核实。',
    dimensions: aiPmWorkSampleRubric.map(({ name }) => ({
      name,
      score: name === 'Demo 与表达' ? null : 4,
      assessment:
        name === 'Demo 与表达'
          ? '材料没有覆盖可验证的演示。'
          : '按统一笔试目的形成作品判断。',
      evidence:
        name === 'Demo 与表达'
          ? []
          : [{ path: 'docs/brief.md', excerpt: '目标用户是新手卖家' }],
    })),
    strengths: ['问题定义具体'],
    risks: ['验证样本仍待核实'],
    questions,
  };
}

void test('initial analysis combines resume reading with three file-backed questions and cleans extraction', async () => {
  const f = await fixture();
  const extraction = join(f.root, 'interview-work-sample-fixed');
  try {
    const work = assessment(f.reference);
    const report = {
      candidateName: '张三',
      candidateNameEvidence: '姓名：张三。',
      summary: '候选人简历自述与作品均待面试核实。',
      sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
        name,
        items: [],
      })),
      interviewQuestions: [
        question(0, 'resume'),
        ...work.questions,
        question(4, 'role'),
        question(5, 'role'),
      ],
      followUps: [],
      workSample: work,
    };
    const result = await readResumeAndWorkSampleWithCodex(
      {
        ...standards,
        resumeText,
        hasWrittenTest: true,
        workSample: f.reference,
      },
      f.zip,
      new AbortController().signal,
      {
        createDirectory: async () => extraction,
        runStructured: async (input, _signal, instructions, _schema, mcp) => {
          assert.equal(JSON.stringify(input).includes(f.root), false);
          assert.equal(
            JSON.stringify(input).includes(AI_PM_WORK_SAMPLE_RUBRIC_VERSION),
            true,
          );
          assert.match(instructions, /统一出题目的/);
          assert.match(instructions, /用户问题与场景理解/);
          assert.match(instructions, /AI 理解与产品判断/);
          assert.match(instructions, /不计算或输出 100 分总分/);
          assert.match(instructions, /材料没有覆盖或无法读取.*score=null/);
          assert.equal(mcp.root, extraction);
          return report;
        },
      },
    );
    assert.deepEqual(
      result.interviewQuestions?.slice(1, 4).map((item) => item.questionSource),
      ['work-sample', 'work-sample', 'work-sample'],
    );
    assert.equal(
      result.workSample?.coverage.analyzed.includes('docs/brief.md'),
      true,
    );
    await assert.rejects(() => readdir(extraction));
  } finally {
    await f.cleanup();
  }
});

void test('initial V2 analysis returns one outline contract and binds work evidence to questions two through four', async () => {
  const f = await fixture();
  try {
    const template = builtInRoleTemplates[0];
    const dimensions = template.dimensionText.split('、');
    const work = assessment(f.reference);
    work.questions = work.questions.map((item, index) => ({
      ...item,
      dimensions: [dimensions[index]],
    }));
    const primaryOrder = [4, 0, 1, 2, 3, 5, 6, 7];
    const all: InterviewQuestionV2[] = primaryOrder.map(
      (dimensionIndex, index) => ({
        id: `outline-${index + 1}`,
        question:
          index >= 1 && index <= 3
            ? work.questions[index - 1].question
            : `请说明经历${index + 1}的关键判断`,
        required: index < 5,
        estimatedMinutes: index < 5 ? 6 : 4,
        primaryDimension: dimensions[dimensionIndex],
        secondaryDimensions: [],
        source:
          index >= 1 && index <= 3
            ? ('work-sample' as const)
            : ('role' as const),
        goal: '核实具体判断和行动',
        resumeEvidence: null,
        workSampleEvidence:
          index >= 1 && index <= 3
            ? work.questions[index - 1].workSampleEvidence!
            : null,
        listenFor: ['个人判断依据'],
        riskSignals: ['只描述团队结论'],
        probes: [{ condition: '依据不清楚', question: '你怎样验证？' }],
      }),
    );
    const outline: InterviewOutlineV2 = {
      version: 2,
      estimatedMinutes: 30,
      requiredQuestions: all.slice(0, 5),
      reserveQuestions: all.slice(5),
      archivedReserveQuestions: [],
      coverage: calculateOutlineCoverage(all, dimensions),
    };
    const report = {
      candidateName: '张三',
      candidateNameEvidence: '姓名：张三。',
      summary: '候选人简历自述与作品均待面试核实。',
      sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
        name,
        items: [],
      })),
      outline,
      followUps: [],
      workSample: work,
    };
    const result = await readResumeAndWorkSampleWithCodex(
      {
        ...template,
        resumeText,
        hasWrittenTest: true,
        outlineVersion: 2,
        workSample: f.reference,
      },
      f.zip,
      new AbortController().signal,
      {
        runStructured: async (_input, _signal, instructions, schema) => {
          const contract = schema as {
            required: string[];
            properties: Record<string, unknown>;
          };
          assert.ok(contract.required.includes('outline'));
          assert.ok(contract.required.includes('workSample'));
          assert.equal('interviewQuestions' in contract.properties, false);
          assert.match(instructions, /五道必问题/);
          assert.doesNotMatch(instructions, /恰好六道/);
          return report;
        },
      },
    );
    assert.deepEqual(result.outline, outline);
    assert.deepEqual(
      result.outline?.requiredQuestions
        .slice(1, 4)
        .map((item) => item.workSampleEvidence),
      work.questions.map((item) => item.workSampleEvidence),
    );
    await assert.rejects(
      readResumeAndWorkSampleWithCodex(
        {
          ...template,
          resumeText,
          hasWrittenTest: true,
          outlineVersion: 2,
          workSample: f.reference,
        },
        f.zip,
        new AbortController().signal,
        {
          runStructured: async () => ({
            ...report,
            outline: {
              ...outline,
              requiredQuestions: outline.requiredQuestions.map(
                (item, index) =>
                  index === 1
                    ? {
                        ...item,
                        workSampleEvidence: {
                          ...item.workSampleEvidence!,
                          excerpt: '另一段引用',
                        },
                      }
                    : item,
              ),
            },
          }),
        },
      ),
      /文件依据不一致/,
    );
  } finally {
    await f.cleanup();
  }
});

void test('later analysis returns three grounded questions and rejects fabricated citations', async () => {
  const f = await fixture();
  try {
    const input = {
      ...standards,
      resumeText,
      workSample: f.reference,
      existingQuestions: [
        question(0, 'resume'),
        ...[1, 2, 3, 4, 5].map((i) => question(i, 'role')),
      ],
    };
    const valid = assessment(f.reference);
    const result = await analyzeWorkSampleWithCodex(
      input,
      f.zip,
      new AbortController().signal,
      {
        runStructured: async (actual, _signal, instructions) => {
          assert.equal(
            JSON.stringify(actual).includes(AI_PM_WORK_SAMPLE_RUBRIC_VERSION),
            true,
          );
          assert.match(instructions, /第 1 题核实用户问题/);
          assert.match(instructions, /第 2 题核实 AI 核心价值/);
          assert.match(instructions, /第 3 题核实判断依据/);
          return valid;
        },
      },
    );
    assert.equal(result.questions.length, 3);
    await assert.rejects(
      analyzeWorkSampleWithCodex(input, f.zip, new AbortController().signal, {
        runStructured: async () => ({
          ...valid,
          dimensions: valid.dimensions.map((dimension, index) =>
            index === 0
              ? {
                  ...valid.dimensions[0],
                  evidence: [
                    { path: 'docs/brief.md', excerpt: '不存在的原文' },
                  ],
                }
              : dimension,
          ),
        }),
      }),
      /引用无法在本地文件中找到/,
    );
  } finally {
    await f.cleanup();
  }
});

void test('later V2 work analysis returns assessment plus a file-matched reserve supplement', async () => {
  const f = await fixture();
  try {
    const template = builtInRoleTemplates[0];
    const dimensions = template.dimensionText.split('、');
    const work = assessment(f.reference);
    work.questions = work.questions.map((item, index) => ({
      ...item,
      dimensions: [dimensions[index]],
    }));
    const order = [4, 0, 1, 2, 3, 5, 6, 7];
    const all: InterviewQuestionV2[] = order.map((dimensionIndex, index) => ({
      id: `existing-${index + 1}`,
      question: `请说明经历${index + 1}的关键判断`,
      required: index < 5,
      estimatedMinutes: index < 5 ? 6 : 4,
      primaryDimension: dimensions[dimensionIndex],
      secondaryDimensions: [],
      source: 'role',
      goal: '核实具体行动',
      resumeEvidence: null,
      workSampleEvidence: null,
      listenFor: ['判断依据'],
      riskSignals: ['缺少个人行动'],
      probes: [{ condition: '依据不清楚', question: '你怎样验证？' }],
    }));
    const outline: InterviewOutlineV2 = {
      version: 2,
      estimatedMinutes: 30,
      requiredQuestions: all.slice(0, 5),
      reserveQuestions: all.slice(5),
      archivedReserveQuestions: [],
      coverage: calculateOutlineCoverage(all, dimensions),
    };
    const supplementQuestions = work.questions.map((item, index) => ({
      id: `work-late-${index + 1}`,
      question: item.question,
      required: false,
      estimatedMinutes: 4,
      primaryDimension: dimensions[index],
      secondaryDimensions: [],
      source: 'work-sample' as const,
      goal: '核实作品中的判断',
      resumeEvidence: null,
      workSampleEvidence: item.workSampleEvidence!,
      listenFor: ['判断依据'],
      riskSignals: ['无法说明取舍'],
      probes: [{ condition: '依据不清楚', question: '你怎样验证？' }],
    }));
    const raw = {
      version: 2 as const,
      workSample: work,
      outlineSupplement: {
        version: 2 as const,
        kind: 'work-sample' as const,
        questions: supplementQuestions,
      },
    };
    const result = await analyzeWorkSampleWithCodex(
      {
        ...template,
        resumeText,
        workSample: f.reference,
        outlineVersion: 2,
        outline,
      },
      f.zip,
      new AbortController().signal,
      {
        runStructured: async (_input, _signal, instructions, schema) => {
          const contract = schema as {
            required: string[];
            properties: Record<string, unknown>;
          };
          assert.deepEqual(contract.required, [
            'version',
            'workSample',
            'outlineSupplement',
          ]);
          assert.match(instructions, /outlineSupplement/);
          return raw;
        },
      },
    );
    assert.equal(result.version, 2);
    assert.deepEqual(result.outlineSupplement.questions, supplementQuestions);
  } finally {
    await f.cleanup();
  }
});

void test('changed work sample fails before Codex is called', async () => {
  const f = await fixture();
  let called = false;
  try {
    await assert.rejects(
      analyzeWorkSampleWithCodex(
        {
          ...standards,
          resumeText,
          workSample: { ...f.reference, sha256: 'f'.repeat(64) },
          existingQuestions: [
            question(0, 'resume'),
            ...[1, 2, 3, 4, 5].map((i) => question(i, 'role')),
          ],
        },
        f.zip,
        new AbortController().signal,
        {
          runStructured: async () => {
            called = true;
            return {};
          },
        },
      ),
      /发生变化/,
    );
    assert.equal(called, false);
  } finally {
    await f.cleanup();
  }
});

void test('aborting work analysis removes the extracted directory', async () => {
  const f = await fixture();
  const extraction = join(f.root, 'interview-work-sample-aborted');
  const controller = new AbortController();
  try {
    const running = analyzeWorkSampleWithCodex(
      {
        ...standards,
        resumeText,
        workSample: f.reference,
        existingQuestions: [
          question(0, 'resume'),
          ...[1, 2, 3, 4, 5].map((i) => question(i, 'role')),
        ],
      },
      f.zip,
      controller.signal,
      {
        createDirectory: async () => extraction,
        runStructured: async (_input, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      },
    );
    while (!(await readdir(f.root)).includes('interview-work-sample-aborted'))
      await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(new Error('cancelled'));
    await assert.rejects(running, /cancelled/);
    await assert.rejects(() => readdir(extraction));
  } finally {
    await f.cleanup();
  }
});
