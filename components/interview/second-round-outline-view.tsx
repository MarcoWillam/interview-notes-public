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
    <article className="second-round-question">
      <div className="second-round-question-heading">
        <span>{index}</span>
        <div>
          <h4>{value.question}</h4>
          <p>{value.dimensions.join(' · ')}</p>
        </div>
      </div>
      <p className="second-round-goal">{value.goal}</p>
      <details>
        <summary>查看初复试差异、依据和追问</summary>
        <div className="second-round-question-details">
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
              <span>初试依据</span>
              {value.priorEvidence}
            </blockquote>
          )}
          {value.resumeEvidence && (
            <blockquote>
              <span>简历依据</span>
              {value.resumeEvidence}
            </blockquote>
          )}
          <strong>观察点</strong>
          <ul>
            {value.listenFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <strong>风险信号</strong>
          <ul>
            {value.riskSignals.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <strong>条件追问</strong>
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
    <section className="second-round-outline">
      <div className="second-round-outline-heading">
        <div>
          <span className="eyebrow">Codex 复试准备</span>
          <h3>复试提纲 · 45–60 分钟</h3>
        </div>
        <span className="badge">6 道必问</span>
      </div>
      <p>{value.summary}</p>
      <div className="second-round-required">
        {value.requiredQuestions.map((question, index) => (
          <Question value={question} index={index + 1} key={question.id} />
        ))}
      </div>
      {!!value.reserveQuestions.length && (
        <details className="second-round-reserve">
          <summary>候选题 · {value.reserveQuestions.length} 道</summary>
          {value.reserveQuestions.map((question, index) => (
            <Question
              value={question}
              index={value.requiredQuestions.length + index + 1}
              key={question.id}
            />
          ))}
        </details>
      )}
    </section>
  );
}
