export const CONNECTOR_VERSION = '2026.9.13-1';
export const CONNECTOR_PROTOCOL = 3;
export const MINIMUM_CONNECTOR_PROTOCOL = 1;
export const OUTLINE_CONNECTOR_PROTOCOL = 2;
export const OUTLINE_V2_CONNECTOR_PROTOCOL = 3;
export const CONNECTOR_RELEASE_NOTES = '支持五道必问、候选题和能力覆盖矩阵';

export const connectorRelease = {
  version: CONNECTOR_VERSION,
  protocol: CONNECTOR_PROTOCOL,
} as const;

export type ConnectorReport = {
  version: string;
  protocol: number;
};

export type ConnectorUpdateState =
  | 'current'
  | 'update-available'
  | 'update-required';

export function validateConnectorReport(
  value: unknown,
): ConnectorReport | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object')
    throw new Error('连接器版本格式不正确。');
  const report = value as Record<string, unknown>;
  if (
    typeof report.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(report.version) ||
    !Number.isSafeInteger(report.protocol) ||
    Number(report.protocol) < 1 ||
    Number(report.protocol) > 1000
  )
    throw new Error('连接器版本格式不正确。');
  return { version: report.version, protocol: Number(report.protocol) };
}

export function connectorUpdateState(
  version?: string | null,
  protocol?: number | null,
): ConnectorUpdateState {
  if (protocol === null || protocol === undefined) return 'update-available';
  if (protocol < MINIMUM_CONNECTOR_PROTOCOL) return 'update-required';
  if (!version || compareConnectorVersions(version, CONNECTOR_VERSION) < 0)
    return 'update-available';
  return 'current';
}

export function compareConnectorVersions(left: string, right: string) {
  const parts = (version: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?/.exec(version);
    return match
      ? match.slice(1, 5).map((part) => Number(part || 0))
      : [0, 0, 0, 0];
  };
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < 4; index += 1) {
    if (leftParts[index] !== rightParts[index])
      return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

export function connectorSupportsOutline(protocol?: number | null) {
  return Number(protocol || 0) >= OUTLINE_CONNECTOR_PROTOCOL;
}

export function connectorSupportsOutlineV2(protocol?: number | null) {
  return Number(protocol || 0) >= OUTLINE_V2_CONNECTOR_PROTOCOL;
}

export const connectorReleaseInfo = {
  latestVersion: CONNECTOR_VERSION,
  latestProtocol: CONNECTOR_PROTOCOL,
  minimumProtocol: MINIMUM_CONNECTOR_PROTOCOL,
  outlineProtocol: OUTLINE_CONNECTOR_PROTOCOL,
  outlineV2Protocol: OUTLINE_V2_CONNECTOR_PROTOCOL,
  notes: CONNECTOR_RELEASE_NOTES,
  downloadUrl: '/downloads/interview-connector.zip',
} as const;
