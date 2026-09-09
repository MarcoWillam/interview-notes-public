import { Download } from 'lucide-react';
import {
  exportResumeReading,
  type InterviewQuestion,
  type QuestionSource,
  type ResumeReading,
} from '../../lib/resume-reading';

const sourceLabels: Record<QuestionSource, string> = {
  resume: '简历经历',
  'written-test': '笔试复盘',
  role: '岗位通用',
};

function resolvedSource(question: InterviewQuestion): QuestionSource {
  return (
    question.questionSource ||
    (question.resumeEvidence === null ? 'role' : 'resume')
  );
}

function QuestionCard({
  question,
  number,
}: {
  question: InterviewQuestion;
  number: number;
}) {
  const source = resolvedSource(question);
  return (
    <article className="interview-question-card">
      <span className={`question-source-badge source-${source}`}>
        {sourceLabels[source]}
      </span>
      <h5>{`${number}. ${question.question}`}</h5>
      <div className="interview-question-dimensions" aria-label="考察维度">
        {question.dimensions.map((dimension) => (
          <span className="dimension-badge" key={dimension}>
            {dimension}
          </span>
        ))}
      </div>
      {question.resumeEvidence !== null && (
        <blockquote>{question.resumeEvidence}</blockquote>
      )}
      <details>
        <summary>提问理由、观察点与追问</summary>
        <p>
          <strong>提问理由：</strong>
          {question.reason}
        </p>
        <p className="question-detail-label">观察点</p>
        <ul>
          {question.listenFor.map((point, pointIndex) => (
            <li key={pointIndex}>{point}</li>
          ))}
        </ul>
        <p className="question-detail-label">追问</p>
        <ul>
          {question.probes.map((probe, probeIndex) => (
            <li key={probeIndex}>{probe}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function WrittenTestSupplementView({
  questions,
}: {
  questions: InterviewQuestion[];
}) {
  return (
    <section className="written-test-supplement">
      <h4>笔试复盘补充 · 3 道</h4>
      <p>系统未读取候选人的实际答卷，请在面试中核实其判断与取舍。</p>
      <div className="interview-question-list">
        {questions.map((question, index) => (
          <QuestionCard
            question={question}
            number={index + 7}
            key={question.question}
          />
        ))}
      </div>
    </section>
  );
}

export function ResumeReadingView({
  value,
  canSupplement = false,
  supplementBusy = false,
  onSupplement,
}: {
  value: ResumeReading;
  canSupplement?: boolean;
  supplementBusy?: boolean;
  onSupplement?: () => void;
}) {
  function download() {
    const url = URL.createObjectURL(
      new Blob([exportResumeReading(value)], {
        type: 'text/markdown;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = '简历阅读要点.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const questions = value.interviewQuestions || [];
  const hasWrittenTest = questions.some(
    (question) => question.questionSource === 'written-test',
  );
  const itemCount = value.sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  return (
    <div className="remote-result resume-reading">
      <div className="remote-section-label">
        <h3>Codex 面试准备</h3>
        <button type="button" className="text-button" onClick={download}>
          <Download size={15} />
          下载完整要点
        </button>
      </div>
      {!!questions.length && (
        <section className="interview-guide">
          <h4>
            {`面试提纲 · ${hasWrittenTest ? '含笔试复盘' : '常规'} · 30–40 分钟`}
          </h4>
          <div className="interview-question-list">
            {questions.map((question, index) => {
              return (
                <QuestionCard
                  question={question}
                  number={index + 1}
                  key={question.question}
                />
              );
            })}
          </div>
        </section>
      )}
      {value.writtenTestSupplement?.length ? (
        <WrittenTestSupplementView questions={value.writtenTestSupplement} />
      ) : (
        canSupplement && (
          <section className="written-test-supplement-action">
            <div>
              <strong>需要补充笔试复盘？</strong>
              <p>保留原 6 道提纲，由 Codex 额外生成 3 道复盘题。</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={supplementBusy}
              onClick={onSupplement}
            >
              {supplementBusy ? '正在生成…' : '一键补充笔试复盘题'}
            </button>
          </section>
        )
      )}
      <details className="resume-reading-details">
        <summary>
          <span>简历阅读结果</span>
          <span>{itemCount} 条要点</span>
        </summary>
        <div className="resume-reading-content">
          <span className="badge">简历自述 · 待面试核实</span>
          <p>{value.summary}</p>
          {value.sections.map((section) => (
            <section key={section.name}>
              <h4>{section.name}</h4>
              {section.items.length ? (
                section.items.map((item, index) => (
                  <div key={index}>
                    <p>{item.text}</p>
                    <blockquote>{item.evidence}</blockquote>
                  </div>
                ))
              ) : (
                <p className="small-note">简历未提供明确依据。</p>
              )}
            </section>
          ))}
          {!!value.followUps.length && (
            <section>
              <h4>{questions.length ? '其他建议追问' : '建议追问'}</h4>
              <ul>
                {value.followUps.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </details>
    </div>
  );
}
