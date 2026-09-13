import type {
  InterviewOutlineV2,
  InterviewQuestionV2,
} from '../../lib/interview-outline-v2';

const sourceLabels: Record<InterviewQuestionV2['source'], string> = {
  role: '岗位通用',
  resume: '简历经历',
  'written-test': '笔试复盘',
  'work-sample': '笔试作品',
};

const coverageLabels = {
  covered: '已覆盖',
  weak: '覆盖偏弱',
  uncovered: '未覆盖',
} as const;

function InterviewQuestionV2Card({
  question,
  number,
}: {
  question: InterviewQuestionV2;
  number: number;
}) {
  return (
    <article className="interview-question-card outline-v2-question">
      <div className="outline-v2-question-heading">
        <span className={`question-source-badge source-${question.source}`}>
          {sourceLabels[question.source]}
        </span>
        <span>预计 {question.estimatedMinutes} 分钟</span>
      </div>
      <h5>{`${number}. ${question.question}`}</h5>
      <div className="interview-question-dimensions" aria-label="考察维度">
        <span className="dimension-badge">
          主维度 · {question.primaryDimension}
        </span>
        {question.secondaryDimensions.map((dimension) => (
          <span className="dimension-badge secondary" key={dimension}>
            辅助 · {dimension}
          </span>
        ))}
      </div>
      <details>
        <summary>验证目标、观察信号与追问</summary>
        <p>
          <strong>验证目标：</strong>
          {question.goal}
        </p>
        {question.resumeEvidence && (
          <blockquote>
            <strong>简历依据</strong>
            {question.resumeEvidence}
          </blockquote>
        )}
        {question.workSampleEvidence && (
          <blockquote>
            <strong>作品依据 · {question.workSampleEvidence.path}</strong>
            {question.workSampleEvidence.excerpt}
          </blockquote>
        )}
        <p className="question-detail-label">重点观察</p>
        <ul>
          {question.listenFor.map((point, pointIndex) => (
            <li key={pointIndex}>{point}</li>
          ))}
        </ul>
        <p className="question-detail-label">风险信号</p>
        <ul>
          {question.riskSignals.map((signal, signalIndex) => (
            <li key={signalIndex}>{signal}</li>
          ))}
        </ul>
        <p className="question-detail-label">条件追问</p>
        <ul>
          {question.probes.map((probe, probeIndex) => (
            <li key={probeIndex}>
              当{probe.condition}时：{probe.question}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function InterviewOutlineV2View({
  outline,
}: {
  outline: InterviewOutlineV2;
}) {
  return (
    <section className="interview-guide outline-v2">
      <header className="outline-v2-heading">
        <h4>必问题 · 5 道</h4>
        <span>预计 {outline.estimatedMinutes} 分钟</span>
      </header>
      <div className="interview-question-list">
        {outline.requiredQuestions.map((question, index) => (
          <InterviewQuestionV2Card
            question={question}
            number={index + 1}
            key={question.id}
          />
        ))}
      </div>

      <details className="outline-v2-section outline-v2-reserve">
        <summary>候选题 · {outline.reserveQuestions.length} 道</summary>
        <p className="outline-v2-section-note">
          按面试进展选用，无需全部提问。
        </p>
        <div className="interview-question-list">
          {outline.reserveQuestions.map((question, index) => (
            <InterviewQuestionV2Card
              question={question}
              number={outline.requiredQuestions.length + index + 1}
              key={question.id}
            />
          ))}
        </div>
      </details>

      <details className="outline-v2-section outline-v2-coverage">
        <summary>能力覆盖</summary>
        <dl className="outline-v2-coverage-list">
          {outline.coverage.map((item) => (
            <div className={`coverage-${item.status}`} key={item.dimension}>
              <dt>{item.dimension}</dt>
              <dd>{coverageLabels[item.status]}</dd>
            </div>
          ))}
        </dl>
      </details>

      {!!outline.archivedReserveQuestions.length && (
        <details className="outline-v2-section outline-v2-archived">
          <summary>
            此前候选题 · {outline.archivedReserveQuestions.length} 道
          </summary>
          <p className="outline-v2-section-note">
            重新生成或补充材料前的候选题，仅供回看。
          </p>
          <div className="interview-question-list">
            {outline.archivedReserveQuestions.map((question, index) => (
              <InterviewQuestionV2Card
                question={question}
                number={index + 1}
                key={question.id}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
