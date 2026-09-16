import {
  priorRoundComparisonLabels,
  type PriorRoundComparison,
} from '../../lib/second-round';

export function SecondRoundComparisonView({
  value,
}: {
  value: readonly PriorRoundComparison[];
}) {
  if (!value.length) return null;
  return (
    <section className="second-round-comparison">
      <div className="assessment-group-heading">
        <span>独立复试结论</span>
        <h3>初试信息对照</h3>
      </div>
      <p className="small-note">
        对照状态不继承初试评分；引用仅来自本轮复试对话。
      </p>
      {value.map((item, index) => (
        <article key={`${item.status}-${index}`}>
          <span className={`second-round-comparison-status ${item.status}`}>
            {priorRoundComparisonLabels[item.status]}
          </span>
          <p>{item.statement}</p>
          {item.transcriptEvidence.map((quote) => (
            <blockquote key={quote}>
              <span>复试对话依据</span>
              {quote}
            </blockquote>
          ))}
        </article>
      ))}
    </section>
  );
}
