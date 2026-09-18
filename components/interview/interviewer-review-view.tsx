import type { InterviewerReview } from '@/lib/interviewer-review';

const levelLabels = {
  表现较好: '表现较好',
  可以改进: '可以改进',
  优先改进: '优先改进',
} as const;

const dimensionLabels = ['岗位覆盖', '经历深挖', '问题表达', '证据核实'];

export function InterviewerReviewView({
  value,
}: {
  value: InterviewerReview;
}) {
  if (value.status === 'unavailable')
    return (
      <section className="interviewer-review interviewer-review-unavailable">
        <div className="interviewer-review-heading">
          <div>
            <span className="eyebrow">仅本人可见</span>
            <h3>我的面试复盘</h3>
          </div>
        </div>
        <p>面试记录缺少清晰的面试官／候选人标记。</p>
        <p className="small-note">
          请按“面试官：……”和“候选人：……”补充后重新生成结论。
        </p>
      </section>
    );

  return (
    <section className="interviewer-review">
      <div className="interviewer-review-heading">
        <div>
          <span className="eyebrow">仅本人可见 · 不进入候选人报告</span>
          <h3>我的面试复盘</h3>
        </div>
      </div>
      <p className="interviewer-review-summary">{value.summary}</p>
      <div
        aria-label={dimensionLabels.join('、')}
        className="interviewer-review-dimensions"
      >
        {value.dimensions.map((dimension) => (
          <article
            className={`interviewer-review-dimension level-${dimension.level}`}
            key={dimension.name}
          >
            <div>
              <strong>{dimension.name}</strong>
              <span>{levelLabels[dimension.level]}</span>
            </div>
            <p>{dimension.assessment}</p>
            {dimension.evidence.length > 0 && (
              <details>
                <summary>查看提问依据</summary>
                {dimension.evidence.map((quote, index) => (
                  <blockquote key={index}>{quote}</blockquote>
                ))}
              </details>
            )}
          </article>
        ))}
      </div>
      <div className="interviewer-review-priorities">
        <h4>优先改进建议</h4>
        <ol>
          {value.priorities.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      </div>
      <details className="interviewer-review-details">
        <summary>做得较好的地方</summary>
        <ul>
          {value.strengths.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </details>
      <details className="interviewer-review-details">
        <summary>原问题与改写</summary>
        <div className="interviewer-review-rewrites">
          {value.rewrites.map((item, index) => (
            <article key={index}>
              <span>原问题</span>
              <p>{item.originalQuestion}</p>
              <span>可以这样问</span>
              <strong>{item.improvedQuestion}</strong>
              <p className="small-note">
                {item.issue} · {item.purpose}
              </p>
            </article>
          ))}
        </div>
      </details>
      {value.missedFollowUps.length > 0 && (
        <details className="interviewer-review-details">
          <summary>遗漏的追问机会</summary>
          <div className="interviewer-review-rewrites">
            {value.missedFollowUps.map((item, index) => (
              <article key={index}>
                <span>候选人信号</span>
                <p>{item.candidateSignal}</p>
                <span>建议补问</span>
                <strong>{item.suggestedQuestion}</strong>
                <p className="small-note">{item.purpose}</p>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
