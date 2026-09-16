import type {
  SecondRoundOutline,
  SecondRoundQuestion,
} from '../../lib/second-round';

function Question({
  value,
  index,
}: {
  value: SecondRoundQuestion;
  index: number;
}) {
  return (
    <article className="interview-question-card outline-v2-question second-round-question">
      <div className="outline-v2-question-heading">
        <span className="question-source-badge source-role">复试追问</span>
        <span>预计 5–8 分钟</span>
      </div>
      <h5>{`${index}. ${value.question}`}</h5>
      <div className="interview-question-dimensions" aria-label="考察维度">
        <span className="dimension-badge">
          主维度 · {value.dimensions[0]}
        </span>
        {value.dimensions.slice(1).map((dimension) => (
          <span className="dimension-badge secondary" key={dimension}>
            辅助 · {dimension}
          </span>
        ))}
      </div>
      <details>
        <summary>验证目标、初复试差异、依据与追问</summary>
        <div className="second-round-question-details">
          <p>
            <strong>验证目标：</strong>
            {value.goal}
          </p>
          <p>
            <strong>为何复试再问：</strong>
            {value.difference}
          </p>
          {value.relatedInitialQuestion && (
            <p>
              <strong>相关初试问题：</strong>
              {value.relatedInitialQuestion}
            </p>
          )}
          {value.priorEvidence && (
            <blockquote>
              <strong>初试依据</strong>
              {value.priorEvidence}
            </blockquote>
          )}
          {value.resumeEvidence && (
            <blockquote>
              <strong>简历依据</strong>
              {value.resumeEvidence}
            </blockquote>
          )}
          <p className="question-detail-label">重点观察</p>
          <ul>
            {value.listenFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="question-detail-label">风险信号</p>
          <ul>
            {value.riskSignals.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="question-detail-label">条件追问</p>
          <ul>
            {value.probes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </details>
    </article>
  );
}

export function SecondRoundOutlineView({
  value,
}: {
  value: SecondRoundOutline;
}) {
  return (
    <section className="interview-guide outline-v2 second-round-outline">
      <header className="outline-v2-heading">
        <h4>必问题 · {value.requiredQuestions.length} 道</h4>
        <span>预计 45–60 分钟</span>
      </header>
      <p className="outline-v2-section-note second-round-summary">
        {value.summary}
      </p>
      <div className="interview-question-list">
        {value.requiredQuestions.map((question, index) => (
          <Question value={question} index={index + 1} key={question.id} />
        ))}
      </div>
      {!!value.reserveQuestions.length && (
        <details className="outline-v2-section second-round-reserve">
          <summary>候选题 · {value.reserveQuestions.length} 道</summary>
          <p className="outline-v2-section-note">
            按面试进展选用，无需全部提问。
          </p>
          <div className="interview-question-list">
            {value.reserveQuestions.map((question, index) => (
              <Question
                value={question}
                index={value.requiredQuestions.length + index + 1}
                key={question.id}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
