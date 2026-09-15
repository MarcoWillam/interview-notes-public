import type { SavedInterview } from './local/store.ts';

const comparedSections: Array<[keyof SavedInterview, string]> = [
  ['candidate', '候选人信息'],
  ['role', '岗位与标准'],
  ['resumeText', '简历正文'],
  ['resumeReading', '简历阅读与提纲'],
  ['outlineSupplements', '简历阅读与提纲'],
  ['transcript', '面试记录'],
  ['workSample', '作品观察'],
  ['report', '结论评估'],
  ['conclusion', '人工结论'],
];

function valueSignature(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

export function changedInterviewSections(
  left: SavedInterview,
  right: SavedInterview,
) {
  return [
    ...new Set(
      comparedSections
        .filter(
          ([key]) => valueSignature(left[key]) !== valueSignature(right[key]),
        )
        .map(([, label]) => label),
    ),
  ];
}
