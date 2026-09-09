import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PcmFramer } from '../lib/asr/pcm.ts';
void test('PCM emits 200ms mono 16kHz frames across arbitrary source blocks', () => {
  const encoder = new PcmFramer(48000);
  const parts: Int16Array[] = [];
  for (let i = 0; i < 150; i++)
    parts.push(...encoder.push(new Float32Array(128).fill(0.5)));
  assert.equal(parts.length, 2);
  assert.equal(parts[0].length, 3200);
  assert.ok(Math.abs(parts[0][100] - 16383) <= 1);
});
void test('PCM clips input and flushes the remaining samples exactly once', () => {
  const encoder = new PcmFramer(16000);
  encoder.push(new Float32Array([2, -2, 0]));
  assert.deepEqual([...encoder.flush()!], [32767, -32768, 0]);
  assert.equal(encoder.flush(), null);
});
