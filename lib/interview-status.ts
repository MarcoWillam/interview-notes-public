import type { CloudInterview as SavedInterview } from './cloud-interview';

export type InterviewStatus =
  | 'preparing'
  | 'needs-review'
  | 'needs-assessment'
  | 'needs-confirmation'
  | 'completed';

export const interviewStatusOptions: ReadonlyArray<{
  value: InterviewStatus;
  label: string;
}> = [
  { value: 'preparing', label: '准备中' },
  { value: 'needs-review', label: '待校对' },
  { value: 'needs-assessment', label: '待评估' },
  { value: 'needs-confirmation', label: '待确认' },
  { value: 'completed', label: '已完成' },
];

const labels = new Map(
  interviewStatusOptions.map(({ value, label }) => [value, label]),
);

type StatusSource = Pick<
  SavedInterview,
  'transcript' | 'reviewed' | 'report' | 'conclusion' | 'confirmed'
>;

export function interviewStatus(record: StatusSource): InterviewStatus {
  if (record.confirmed) return 'completed';
  if (record.report || record.conclusion.trim()) return 'needs-confirmation';
  if (record.transcript.trim() && record.reviewed) return 'needs-assessment';
  if (record.transcript.trim()) return 'needs-review';
  return 'preparing';
}

export function interviewStatusLabel(status: InterviewStatus) {
  return labels.get(status)!;
}
