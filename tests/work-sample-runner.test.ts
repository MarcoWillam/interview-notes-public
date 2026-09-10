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
  question: `第 ${index + 1} 题：请说明你的具体判断、行动和复盘。`,
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
    question: `作品复盘第 ${index} 题：请说明文件中的具体判断和取舍。`,
  }));
  return {
    artifact: {
      id: reference.id,
      name: reference.name,
      sha256: reference.sha256,
      bytes: reference.bytes,
      modifiedAt: reference.modifiedAt,
    },
    coverage: { analyzed: [], excluded: [], unsupported: [], truncated: false },
    summary: '作品定义了目标用户和验证方案，作者身份与完成过程待面试核实。',
    dimensions: [
      {
        name: '问题定义',
        score: 4,
        assessment: '目标用户较明确。',
        evidence: [{ path: 'docs/brief.md', excerpt: '目标用户是新手卖家' }],
      },
      {
        name: '自驱力',
        score: null,
        assessment: '仅凭作品无法判断个人自驱力。',
        evidence: [],
      },
    ],
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
        runStructured: async (input, _signal, _instructions, _schema, mcp) => {
          assert.equal(JSON.stringify(input).includes(f.root), false);
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
      { runStructured: async () => valid },
    );
    assert.equal(result.questions.length, 3);
    await assert.rejects(
      analyzeWorkSampleWithCodex(input, f.zip, new AbortController().signal, {
        runStructured: async () => ({
          ...valid,
          dimensions: [
            {
              ...valid.dimensions[0],
              evidence: [{ path: 'docs/brief.md', excerpt: '不存在的原文' }],
            },
          ],
        }),
      }),
      /引用无法在本地文件中找到/,
    );
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
