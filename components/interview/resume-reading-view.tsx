import { Download } from 'lucide-react';
import {
  exportResumeReading,
  type InterviewQuestion,
  type QuestionSource,
  type ResumeReading,
} from '../../lib/resume-reading';
import type { FollowUpOutlineGroup } from '../../lib/follow-up-outline';
import { FollowUpOutlineView } from './follow-up-outline-view';
import { InterviewOutlineV2View } from './interview-outline-v2-view';
import { WorkSampleView } from './work-sample-view';
import {
  resumeExperienceCountSummary,
  resumeExperienceTypeLabels,
  type ResumeExperienceMap,
} from '../../lib/resume-experience-map';

const sourceLabels: Record<QuestionSource, string> = {
  resume: '简历经历',
  'written-test': '笔试复盘',
  'work-sample': '笔试作品',
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

function ExperienceMapView({ value }: { value: ResumeExperienceMap }) {
  return (
    <section className="resume-experience-map">
      <div className="resume-experience-map-heading">
        <h4>经历地图</h4>
        <span>{resumeExperienceCountSummary(value)}</span>
      </div>
      <p className="small-note">{value.summary}</p>
      <div className="resume-experience-list">
        {[...value.experiences]
          .sort((left, right) => left.sourceOrder - right.sourceOrder)
          .map((experience) => {
            const meta = [
              experience.organization?.text,
              experience.role?.text,
              experience.period?.text,
            ].filter(Boolean);
            const keyActions = [
              ...experience.actions,
              ...experience.decisions,
              ...experience.outcomes,
            ].slice(0, 4);
            return (
              <article className="resume-experience-card" key={experience.id}>
                <header>
                  <span>{resumeExperienceTypeLabels[experience.type]}</span>
                  <h5>{experience.name}</h5>
                </header>
                {!!meta.length && (
                  <p className="resume-experience-meta">{meta.join(' · ')}</p>
                )}
                {!!keyActions.length && (
                  <ul>
                    {keyActions.map((fact, index) => (
                      <li key={`${fact.evidence}-${index}`}>{fact.text}</li>
                    ))}
                  </ul>
                )}
                {!!experience.missingInformation.length && (
                  <p className="resume-experience-missing">
                    待核实：{experience.missingInformation.join('、')}
                  </p>
                )}
                <details>
                  <summary>查看简历原文依据</summary>
                  {experience.evidence.map((evidence, index) => (
                    <blockquote key={`${evidence}-${index}`}>
                      {evidence}
                    </blockquote>
                  ))}
                </details>
              </article>
            );
          })}
      </div>
      {!!value.unresolvedItems.length && (
        <p className="resume-experience-missing">
          未归属信息：{value.unresolvedItems.join('、')}
        </p>
      )}
    </section>
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
  canSubmitWork = false,
  workBusy = false,
  onSubmitWork,
  canRegenerate = false,
  regenerationUsed = false,
  regenerationBusy = false,
  onRegenerate,
  groups,
  busy = false,
  draft,
  onGenerate,
  onDelete,
}: {
  value: ResumeReading;
  canSubmitWork?: boolean;
  workBusy?: boolean;
  onSubmitWork?: () => void;
  canRegenerate?: boolean;
  regenerationUsed?: boolean;
  regenerationBusy?: boolean;
  onRegenerate?: () => void;
  groups?: readonly FollowUpOutlineGroup[];
  busy?: boolean;
  draft?: string;
  onGenerate?: (requestedFocus: string) => boolean | Promise<boolean>;
  onDelete?: (groupId: string) => boolean | Promise<boolean>;
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
  const outlineQuestions = value.outline
    ? [...value.outline.requiredQuestions, ...value.outline.reserveQuestions]
    : [];
  const hasWrittenTest =
    questions.some(
      (question) =>
        question.questionSource === 'written-test' ||
        question.questionSource === 'work-sample',
    ) ||
    outlineQuestions.some(
      (question) =>
        question.source === 'written-test' || question.source === 'work-sample',
    ) ||
    !!value.workSample;
  const itemCount = value.sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  return (
    <div className="remote-result resume-reading">
      <div className="remote-section-label">
        <h3>Codex 面试准备</h3>
        <div className="resume-reading-heading-actions">
          {canRegenerate && (
            <button
              type="button"
              className="secondary-button"
              disabled={regenerationBusy}
              onClick={onRegenerate}
            >
              {regenerationBusy ? '正在重新生成…' : '重新生成提纲'}
            </button>
          )}
          {regenerationUsed && (
            <span className="outline-regenerated-state">已重新生成</span>
          )}
          <button type="button" className="text-button" onClick={download}>
            <Download size={15} />
            下载完整要点
          </button>
        </div>
      </div>
      {value.outline && <InterviewOutlineV2View outline={value.outline} />}
      {!value.outline && !!questions.length && (
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
      {(value.outline || !!questions.length) && (
        <FollowUpOutlineView
          groups={groups}
          busy={busy}
          draft={draft}
          onGenerate={onGenerate}
          onDelete={onDelete}
        />
      )}
      {!!value.writtenTestSupplement?.length && (
        <WrittenTestSupplementView questions={value.writtenTestSupplement} />
      )}
      {value.workSample ? (
        <WorkSampleView
          value={value.workSample}
          showQuestions={
            !value.workSample.questions.every((workQuestion) =>
              [...questions, ...outlineQuestions].some(
                (question) => question.question === workQuestion.question,
              ),
            )
          }
        />
      ) : (
        canSubmitWork && (
          <section className="written-test-supplement-action work-sample-action">
            <div>
              <strong>候选人补交了笔试作品？</strong>
              <p>
                {value.outline
                  ? `保留 ${value.outline.requiredQuestions.length} 道必问题，Codex 读取本地 ZIP 后更新候选题并归档当前候选题。`
                  : '保留现有提纲，Codex 读取本地 ZIP 后追加 3 道作品复盘题。'}
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={workBusy}
              onClick={onSubmitWork}
            >
              {workBusy ? '正在分析…' : '补交笔试作品'}
            </button>
          </section>
        )
      )}
      <details className="resume-reading-details">
        <summary>
          <span>简历阅读结果</span>
          <span>
            {value.experienceMap
              ? `${resumeExperienceCountSummary(value.experienceMap)} · `
              : ''}
            {itemCount} 条要点
          </span>
        </summary>
        <div className="resume-reading-content">
          <span className="badge">简历自述 · 待面试核实</span>
          <p>{value.summary}</p>
          {value.experienceMap && <ExperienceMapView value={value.experienceMap} />}
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
