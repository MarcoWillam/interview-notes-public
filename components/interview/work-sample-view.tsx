import type { WorkSampleAssessment } from '@/lib/work-sample';

export function WorkSampleView({
  value,
  showQuestions = true,
}: {
  value: WorkSampleAssessment;
  showQuestions?: boolean;
}) {
  return (
    <section className="work-sample-view">
      <div className="work-sample-view-heading">
        <div>
          <span className="eyebrow">作品表现 · 归属与过程待核实</span>
          <h3>{value.artifact.name}</h3>
        </div>
        <span className="badge">有笔试 · 作品已分析</span>
      </div>
      <p>{value.summary}</p>
      <div className="work-sample-observations">
        <div>
          <strong>作品亮点</strong>
          <ul>
            {value.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <strong>风险与待核实</strong>
          <ul>
            {value.risks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      {showQuestions && (
        <section className="written-test-supplement">
          <h3>作品复盘问题 · 追加 3 题</h3>
          {value.questions.map((question, index) => (
            <article
              className="interview-question-card"
              key={question.question}
            >
              <span className="question-index">{index + 1}</span>
              <div>
                <h4>{question.question}</h4>
                <p>{question.reason}</p>
                {question.workSampleEvidence && (
                  <blockquote>
                    <strong>{question.workSampleEvidence.path}</strong>
                    {question.workSampleEvidence.excerpt}
                  </blockquote>
                )}
                <p className="small-note">
                  观察：{question.listenFor.join('、')} · 追问：
                  {question.probes.join('、')}
                </p>
              </div>
            </article>
          ))}
        </section>
      )}
      <details className="work-sample-details">
        <summary>查看维度依据与读取范围</summary>
        <div className="work-sample-dimensions">
          {value.dimensions.map((dimension) => (
            <section key={dimension.name}>
              <h4>
                {dimension.name}
                <span>
                  {dimension.score === null
                    ? '待面试核实'
                    : `${dimension.score}/5`}
                </span>
              </h4>
              <p>{dimension.assessment}</p>
              {dimension.evidence.map((evidence, index) => (
                <blockquote key={`${evidence.path}-${index}`}>
                  <strong>{evidence.path}</strong>
                  {evidence.excerpt}
                </blockquote>
              ))}
            </section>
          ))}
        </div>
        <p className="small-note">
          已读取 {value.coverage.analyzed.length} 个文件 · 排除{' '}
          {value.coverage.excluded.length} 个 · 未支持{' '}
          {value.coverage.unsupported.length} 个
        </p>
      </details>
    </section>
  );
}
