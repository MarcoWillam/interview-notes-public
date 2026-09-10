import type { RemoteArtifact } from '@/lib/remote-analysis';

function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function WorkSamplePicker({
  artifacts,
  selected,
  loading,
  error,
  onSelect,
  onRefresh,
}: {
  artifacts: RemoteArtifact[];
  selected: string | null;
  loading: boolean;
  error: string;
  onSelect: (artifact: RemoteArtifact | null) => void;
  onRefresh: () => void;
}) {
  return (
    <fieldset className="work-sample-picker" disabled={loading}>
      <div className="work-sample-picker-heading">
        <strong>笔试作品（可选）</strong>
        <button type="button" className="text-button" onClick={onRefresh}>
          {loading ? '正在刷新…' : '刷新作品清单'}
        </button>
      </div>
      <label className="work-sample-option" aria-label="暂不提供作品">
        <input
          type="radio"
          name="work-sample"
          checked={selected === null}
          onChange={() => onSelect(null)}
        />
        <span>
          <strong>暂不提供作品</strong>
          <small>按既有笔试考量维度生成复盘问题</small>
        </span>
      </label>
      {artifacts.map((artifact) => (
        <label
          className={`work-sample-option ${artifact.available ? '' : 'unavailable'}`}
          aria-label={`选择作品 ${artifact.name}`}
          key={artifact.id}
        >
          <input
            type="radio"
            name="work-sample"
            disabled={!artifact.available}
            checked={selected === artifact.id}
            onChange={() => onSelect(artifact)}
          />
          <span>
            <strong>{artifact.name}</strong>
            <small>
              {artifact.deviceName} · {size(artifact.bytes)} ·{' '}
              {new Date(artifact.modifiedAt).toLocaleString('zh-CN')}
            </small>
          </span>
          <em>{artifact.available ? '可选择' : '电脑离线'}</em>
        </label>
      ))}
      {!loading && !artifacts.length && (
        <p className="small-note">
          暂未发现作品。请将 ZIP 放入连接器的 works/ 目录，并保持连接器运行。
        </p>
      )}
      {error && <p className="remote-error">{error}</p>}
    </fieldset>
  );
}
