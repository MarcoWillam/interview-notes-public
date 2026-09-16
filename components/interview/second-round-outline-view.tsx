import type {
  SecondRoundDepthAngle,
  SecondRoundOutline,
  SecondRoundQuestion,
  SecondRoundQuestionV2,
} from '../../lib/second-round';
import { spokenSecondRoundQuestion } from '../../lib/second-round';

const depthAngleLabels: Record<SecondRoundDepthAngle, string> = {
  decision: '决策依据',
  tradeoff: '范围取舍',
  failure: '失败复盘',
  counterfactual: '反事实推演',
  transfer: '迁移能力',
  collaboration: '协作冲突',
  evidence: '证据闭环',
};

function isV2Question(
  value: SecondRoundQuestion,
): value is SecondRoundQuestionV2 {
  return 'contextSummary' in value;
}

function resumeSourceLabel(value: SecondRoundQuestionV2) {
  if (!value.resumeContext) return '';
  if (value.resumeContext.type === 'unspecified') return '简历中未明确具体项目';
  const prefix = value.resumeContext.type === 'project' ? '项目' : '实习';
  return `${prefix} · ${value.resumeContext.label}`;
}

function Question({
  value,
  index,
}: {
  value: SecondRoundQuestion;
  index: number;
}) {
  const isV2 = isV2Question(value);
  const resumeSource = isV2 ? resumeSourceLabel(value) : '';
  return (
    <article className="interview-question-card outline-v2-question second-round-question">
      <div className="outline-v2-question-heading">
        <div className="second-round-question-tags">
          <span className="question-source-badge source-role">复试追问</span>
          {isV2 && (
            <span className="second-round-depth-badge">
              {depthAngleLabels[value.depthAngle]}
            </span>
          )}
        </div>
        <span>预计 5–8 分钟</span>
      </div>
      <h5>{`${index}. ${spokenSecondRoundQuestion(value)}`}</h5>
      <div className="interview-question-dimensions" aria-label="考察维度">
        <span className="dimension-badge">主维度 · {value.dimensions[0]}</span>
        {value.dimensions.slice(1).map((dimension) => (
          <span className="dimension-badge secondary" key={dimension}>
            辅助 · {dimension}
          </span>
        ))}
      </div>
      {isV2 && (
        <div className="second-round-question-overview">
          <p className="second-round-context">
            <strong>提问背景</strong>
            <span>{value.contextSummary}</span>
          </p>
          <p className="second-round-goal-highlight">
            <strong>重点验证</strong>
            <span title={value.goal}>{value.goal}</span>
          </p>
          {resumeSource && (
            <p className="second-round-resume-source">
              <strong>简历来源</strong>
              <span>{resumeSource}</span>
            </p>
          )}
        </div>
      )}
      <details>
        <summary>
          {isV2 ? '初复试差异、依据与追问' : '验证目标、初复试差异、依据与追问'}
        </summary>
        <div className="second-round-question-details">
          {!isV2 && (
            <p>
              <strong>验证目标：</strong>
              {value.goal}
            </p>
          )}
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
  const isV2 = value.version === 2;
  return (
    <section
      className="interview-guide outline-v2 second-round-outline"
      data-outline-version={isV2 ? '2' : '1'}
    >
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
