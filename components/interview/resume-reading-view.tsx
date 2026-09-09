import { Download } from 'lucide-react';
import {
  exportResumeReading,
  type ResumeReading,
} from '../../lib/resume-reading';
export function ResumeReadingView({ value }: { value: ResumeReading }) {
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
  return (
    <div className="remote-result resume-reading">
      <div className="remote-section-label">
        <h3>Codex 简历阅读</h3>
        <button type="button" className="text-button" onClick={download}>
          <Download size={15} />
          下载要点
        </button>
      </div>
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
      {!!value.interviewQuestions?.length && (
        <section className="interview-guide">
          <h4>面试提纲 · 30–40 分钟</h4>
          <div className="interview-question-list">
            {value.interviewQuestions.map((question, index) => (
              <article
                className="interview-question-card"
                key={question.question}
              >
                <h5>{`${index + 1}. ${question.question}`}</h5>
                <div
                  className="interview-question-dimensions"
                  aria-label="考察维度"
                >
                  {question.dimensions.map((dimension) => (
                    <span className="dimension-badge" key={dimension}>
                      {dimension}
                    </span>
                  ))}
                </div>
                {question.resumeEvidence === null ? (
                  <p className="small-note">岗位通用问题</p>
                ) : (
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
            ))}
          </div>
        </section>
      )}
      {value.followUps.length > 0 && (
        <section>
          <h4>其他建议追问</h4>
          <ul>
            {value.followUps.map((q, index) => (
              <li key={index}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
