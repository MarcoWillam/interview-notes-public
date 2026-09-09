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
      {value.followUps.length > 0 && (
        <section>
          <h4>建议面试追问</h4>
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
