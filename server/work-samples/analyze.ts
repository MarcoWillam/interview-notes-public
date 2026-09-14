import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import {
  resumeInstructionsFor,
  resumeOutputSchema,
  validateResumeInput,
  validateResumeReading,
  type ResumeInput,
  type ResumeReading,
} from '../../lib/resume-reading.ts';
import {
  validateWorkSampleAnalysisResult,
  validateWorkSampleEvidenceFiles,
  validateWorkSampleInput,
  workSampleInstructionsFor,
  workSampleEmbeddedInstructionsFor,
  workSampleOutputSchema,
  workSampleSchema,
  workSampleAssessmentV3Schema,
  type WorkSampleAnalysisResult,
  type WorkSampleAnalysisV2,
  type WorkSampleAnalysisV3,
  type WorkSampleAssessment,
  type WorkSampleInput,
  type WorkSampleInputV1,
  type WorkSampleInputV2,
  type WorkSampleInputV3,
} from '../../lib/work-sample.ts';
import { safeWorkSamplePath } from '../../lib/interview-questions.ts';
import { AnalysisError } from '../analysis.ts';
import { runStructuredCodexWithWorkSample } from '../codex.ts';
import { extractWorkSample, type WorkSampleManifest } from './archive.ts';
import { aiPmWorkSampleRubricContext } from '../../lib/work-sample-rubric.ts';

type RunStructured = (
  input: unknown,
  signal: AbortSignal,
  instructions: string,
  schema: object,
  mcp: { root: string; readable: string[] },
) => Promise<unknown>;

type Dependencies = {
  runStructured?: RunStructured;
  createDirectory?: () => Promise<string>;
};

async function sha256(path: string) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function verifyArchive(
  path: string,
  reference: ResumeInput['workSample'],
) {
  if (!reference) throw new AnalysisError('作品引用不存在，请重新选择。', 409);
  try {
    const info = await stat(path);
    if (
      !info.isFile() ||
      info.size !== reference.bytes ||
      (await sha256(path)) !== reference.sha256
    )
      throw new Error();
  } catch {
    throw new AnalysisError(
      '本地笔试作品已移除或发生变化，请刷新后重新选择。',
      409,
    );
  }
}

function actualCoverage(manifest: WorkSampleManifest) {
  return {
    analyzed: manifest.readable,
    excluded: manifest.excluded,
    unsupported: manifest.unsupported,
    truncated: false,
  };
}

function replaceCoverage(
  value: unknown,
  manifest: WorkSampleManifest,
  nested: boolean,
) {
  if (!value || typeof value !== 'object') return value;
  const result = value as Record<string, unknown>;
  if (nested) {
    if (!result.workSample || typeof result.workSample !== 'object')
      return value;
    return {
      ...result,
      workSample: {
        ...(result.workSample as Record<string, unknown>),
        coverage: actualCoverage(manifest),
      },
    };
  }
  return { ...result, coverage: actualCoverage(manifest) };
}

function evidenceReader(root: string, readable: string[]) {
  const allowed = new Set(readable);
  return async (relative: string) => {
    const path = safeWorkSamplePath(relative);
    if (!allowed.has(path)) return undefined;
    const extension = extname(path).toLowerCase();
    if (
      ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp'].includes(
        extension,
      )
    )
      return undefined;
    try {
      const target = resolve(root, ...path.split('/'));
      const bytes = await readFile(target);
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return source.includes(String.fromCharCode(0)) ? undefined : source;
    } catch {
      return undefined;
    }
  };
}

async function withExtracted<T>(
  zipPath: string,
  reference: NonNullable<ResumeInput['workSample']>,
  signal: AbortSignal,
  dependencies: Dependencies,
  execute: (
    directory: string,
    manifest: WorkSampleManifest,
    run: RunStructured,
  ) => Promise<T>,
) {
  signal.throwIfAborted();
  await verifyArchive(zipPath, reference);
  signal.throwIfAborted();
  const directory = await (
    dependencies.createDirectory ||
    (() => mkdtemp(join(tmpdir(), 'interview-work-sample-')))
  )();
  try {
    const manifest = await extractWorkSample(zipPath, directory);
    signal.throwIfAborted();
    return await execute(
      directory,
      manifest,
      dependencies.runStructured || runStructuredCodexWithWorkSample,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function readResumeAndWorkSampleWithCodex(
  value: ResumeInput,
  zipPath: string,
  signal: AbortSignal,
  dependencies: Dependencies = {},
): Promise<ResumeReading> {
  const input = validateResumeInput(value);
  if (!input.workSample)
    throw new AnalysisError('作品引用不存在，请重新选择。', 409);
  return withExtracted(
    zipPath,
    input.workSample,
    signal,
    dependencies,
    async (directory, manifest, run) => {
      const version = input.outlineVersion ?? 1;
      const resumeContract = resumeOutputSchema(version);
      const raw = await run(
        {
          ...input,
          workSampleCoverage: actualCoverage(manifest),
          workSampleRubric: aiPmWorkSampleRubricContext,
        },
        signal,
        `${resumeInstructionsFor(version)}\n只使用 work_sample 工具读取笔试作品。必须返回 workSample。${version === 3 ? 'outline 的第 5–6 道必问题必须与 workSample.questions 的问题文本、文件路径和逐字引用完全一致，source=work-sample；workSample.questions 恰好两道，主问题自然、亲和且为 12–30 字' : version === 2 ? 'outline 的第 2–4 道必问题必须与 workSample.questions 的问题文本、文件路径和逐字引用完全一致，source=work-sample' : '第 2–4 题必须与 workSample.questions 完全一致，questionSource=work-sample'}；引用只能来自 UTF-8 文本或源码。\n${workSampleEmbeddedInstructionsFor(version)}`,
        {
          ...resumeContract,
          required: [...resumeContract.required, 'workSample'],
          properties: {
            ...resumeContract.properties,
            workSample:
              version === 3 ? workSampleAssessmentV3Schema : workSampleSchema,
          },
        },
        { root: directory, readable: manifest.readable },
      );
      const reading = validateResumeReading(
        replaceCoverage(raw, manifest, true),
        input,
        { conciseQuestions: true },
      );
      if (!reading.workSample) throw new Error('作品评估结果缺失。');
      await validateWorkSampleEvidenceFiles(
        reading.workSample,
        evidenceReader(directory, manifest.readable),
      );
      return reading;
    },
  );
}

export function analyzeWorkSampleWithCodex(
  value: WorkSampleInputV1,
  zipPath: string,
  signal: AbortSignal,
  dependencies?: Dependencies,
): Promise<WorkSampleAssessment>;
export function analyzeWorkSampleWithCodex(
  value: WorkSampleInputV2,
  zipPath: string,
  signal: AbortSignal,
  dependencies?: Dependencies,
): Promise<WorkSampleAnalysisV2>;
export function analyzeWorkSampleWithCodex(
  value: WorkSampleInputV3,
  zipPath: string,
  signal: AbortSignal,
  dependencies?: Dependencies,
): Promise<WorkSampleAnalysisV3>;
export function analyzeWorkSampleWithCodex(
  value: WorkSampleInput,
  zipPath: string,
  signal: AbortSignal,
  dependencies?: Dependencies,
): Promise<WorkSampleAnalysisResult>;
export async function analyzeWorkSampleWithCodex(
  value: WorkSampleInput,
  zipPath: string,
  signal: AbortSignal,
  dependencies: Dependencies = {},
): Promise<WorkSampleAnalysisResult> {
  const input = validateWorkSampleInput(value);
  return withExtracted(
    zipPath,
    input.workSample,
    signal,
    dependencies,
    async (directory, manifest, run) => {
      const version = input.outlineVersion ?? 1;
      const raw = await run(
        {
          ...input,
          workSampleCoverage: actualCoverage(manifest),
          workSampleRubric: aiPmWorkSampleRubricContext,
        },
        signal,
        workSampleInstructionsFor(version),
        workSampleOutputSchema(version),
        { root: directory, readable: manifest.readable },
      );
      const result = validateWorkSampleAnalysisResult(
        replaceCoverage(raw, manifest, version !== 1),
        input,
        { conciseQuestions: true },
      );
      const assessment = 'version' in result ? result.workSample : result;
      await validateWorkSampleEvidenceFiles(
        assessment,
        evidenceReader(directory, manifest.readable),
      );
      return result;
    },
  );
}
