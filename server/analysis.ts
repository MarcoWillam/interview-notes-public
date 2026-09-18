import { Buffer } from 'node:buffer';
import {
  validateAssessmentResult,
  validateInput,
  type InterviewInput,
} from '../lib/interview.ts';
import { AnalysisError } from './analysis-error.ts';
export { AnalysisError };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export function createAnalysisHandler(
  run: (input: InterviewInput, signal: AbortSignal) => Promise<unknown>,
) {
  let running = false;
  return async (request: Request): Promise<Response> => {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return json({ error: '请求来源不受支持，请从本地工作台发起分析。' }, 403);
    if (running)
      return json({ error: '已有面试正在分析，请等待完成后重试。' }, 429);
    let input: InterviewInput;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: '缺少面试资料。' }, 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 550000) {
          await reader.cancel();
          return json({ error: '面试资料超过大小限制。' }, 413);
        }
        chunks.push(value);
      }
      input = validateInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      return json(
        {
          error:
            '请检查岗位、岗位要求、评估维度及面试文字是否完整并在长度限制内。',
        },
        400,
      );
    }
    // Body reads yield; reserve the single run only after validation, and recheck.
    if (running)
      return json({ error: '已有面试正在分析，请等待完成后重试。' }, 429);
    running = true;
    try {
      request.signal.throwIfAborted();
      const result = await run(input, request.signal);
      try {
        return json(validateAssessmentResult(result, input));
      } catch {
        throw new AnalysisError('评估格式或原文证据未通过校验，请重新生成。');
      }
    } catch (error) {
      if (request.signal.aborted)
        return json({ error: '分析已取消，原记录保留。' }, 499);
      if (error instanceof AnalysisError)
        return json({ error: error.message }, error.status);
      return json(
        {
          error:
            '本地 Codex 分析失败，请检查登录、网络或使用额度后重试。原记录保留。',
        },
        502,
      );
    } finally {
      running = false;
    }
  };
}
