import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTOR_PROTOCOL,
  CONNECTOR_VERSION,
  compareConnectorVersions,
  connectorSupportsOutline,
  connectorSupportsOutlineV2,
  connectorSupportsOutlineV3,
  connectorUpdateState,
  OUTLINE_V2_CONNECTOR_PROTOCOL,
  OUTLINE_V3_CONNECTOR_PROTOCOL,
  validateConnectorReport,
} from '../lib/connector-release.ts';

void test('connector release accepts current reports and identifies update states', () => {
  assert.deepEqual(
    validateConnectorReport({
      version: CONNECTOR_VERSION,
      protocol: CONNECTOR_PROTOCOL,
    }),
    { version: CONNECTOR_VERSION, protocol: CONNECTOR_PROTOCOL },
  );
  assert.equal(
    connectorUpdateState(CONNECTOR_VERSION, CONNECTOR_PROTOCOL),
    'current',
  );
  assert.equal(connectorUpdateState(null, null), 'update-available');
  assert.equal(connectorUpdateState('0.1.0', 1), 'update-available');
  assert.equal(
    connectorUpdateState('0.1.0', CONNECTOR_PROTOCOL),
    'update-available',
  );
  assert.equal(connectorUpdateState('0.1.0', 0), 'update-required');
  assert.equal(connectorUpdateState('2026.9.11-5', 2), 'update-available');
  assert.equal(compareConnectorVersions('2026.9.11-3', CONNECTOR_VERSION), -1);
  assert.equal(compareConnectorVersions('2026.9.15-1', CONNECTOR_VERSION), 1);
  assert.equal(connectorSupportsOutline(CONNECTOR_PROTOCOL), true);
  assert.equal(connectorSupportsOutline(1), false);
  assert.equal(OUTLINE_V2_CONNECTOR_PROTOCOL, 3);
  assert.equal(connectorSupportsOutlineV2(CONNECTOR_PROTOCOL), true);
  assert.equal(connectorSupportsOutlineV2(2), false);
  assert.equal(OUTLINE_V3_CONNECTOR_PROTOCOL, 4);
  assert.equal(connectorSupportsOutlineV3(CONNECTOR_PROTOCOL), true);
  assert.equal(connectorSupportsOutlineV3(3), false);
});

void test('connector release rejects malformed reports', () => {
  assert.throws(
    () => validateConnectorReport({ version: 'today', protocol: 2 }),
    /版本格式/,
  );
  assert.throws(
    () =>
      validateConnectorReport({ version: CONNECTOR_VERSION, protocol: 1.5 }),
    /版本格式/,
  );
});
