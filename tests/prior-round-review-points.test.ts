import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPriorRoundReviewPoints } from '../lib/prior-round-review-points.ts';
import type { SecondRoundDigest } from '../lib/second-round.ts';

const digest: SecondRoundDigest = {
  initialQuestions: [],
  verified: [],
  gaps: ['个人贡献尚无具体事例。'],
  risks: ['项目结果缺少量化证据。'],
  conflicts: ['两次陈述的数据口径不一致。'],
};

void test('shows explicit Bole pending and focus points without rewriting them', () => {
  const text = `# 面试评估记录

## 重点考察事项
1. 进一步核实实际负责的范围。
2、观察失败后的复盘与学习。

## 待核实事项
- 个人贡献尚无具体事例。
- 个人贡献尚无具体事例。
* 数据口径需要面试官再核对。

## 面试官结论
尚未确认。`;
  assert.deepEqual(extractPriorRoundReviewPoints(text, digest), {
    source: 'document',
    pending: ['个人贡献尚无具体事例。', '数据口径需要面试官再核对。'],
    focus: ['进一步核实实际负责的范围。', '观察失败后的复盘与学习。'],
  });
});

void test('accepts a standalone heading in external notes without swallowing later notes', () => {
  const text = `初试纪要\n待考核点：\n• 用户需求辨别能力\n- 主动推进的证据\n\n面试交流：候选人描述了校园项目。`;
  assert.deepEqual(extractPriorRoundReviewPoints(text, null), {
    source: 'document',
    pending: ['用户需求辨别能力', '主动推进的证据'],
    focus: [],
  });
});

void test('falls back to generated gaps, risks and conflicts only without explicit points', () => {
  const text = '初试纪要\n候选人提到待核实事项，但未列出具体内容。';
  assert.deepEqual(extractPriorRoundReviewPoints(text, digest), {
    source: 'digest',
    pending: [
      '个人贡献尚无具体事例。',
      '项目结果缺少量化证据。',
      '两次陈述的数据口径不一致。',
    ],
    focus: [],
  });
  assert.deepEqual(extractPriorRoundReviewPoints(text, null), {
    source: 'none',
    pending: [],
    focus: [],
  });
});
