export const CONNECTOR_VERSION = '2026.9.11-4';
export const CONNECTOR_PROTOCOL = 2;
export const MINIMUM_CONNECTOR_PROTOCOL = 2;
export const OUTLINE_CONNECTOR_PROTOCOL = 2;
export const CONNECTOR_RELEASE_NOTES = '支持短问题提纲重新生成与版本提醒';

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
  if (!protocol || protocol < MINIMUM_CONNECTOR_PROTOCOL)
    return 'update-required';
  if (!version || version !== CONNECTOR_VERSION) return 'update-available';
  return 'current';
}

export function connectorSupportsOutline(protocol?: number | null) {
  return Number(protocol || 0) >= OUTLINE_CONNECTOR_PROTOCOL;
}

export const connectorReleaseInfo = {
  latestVersion: CONNECTOR_VERSION,
  latestProtocol: CONNECTOR_PROTOCOL,
  minimumProtocol: MINIMUM_CONNECTOR_PROTOCOL,
  outlineProtocol: OUTLINE_CONNECTOR_PROTOCOL,
  notes: CONNECTOR_RELEASE_NOTES,
  downloadUrl: '/downloads/interview-connector.zip',
} as const;
