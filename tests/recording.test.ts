import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordingClock } from '../lib/recording-clock.ts';
void test('paused time never contributes to the recorded duration', () => {
  let now = 0;
  const clock = new RecordingClock(() => now);
  clock.start();
  now = 10000;
  clock.pause();
  now = 25000;
  assert.equal(clock.seconds(), 10);
  clock.start();
  now = 30000;
  clock.pause();
  assert.equal(clock.seconds(), 15);
  clock.reset();
  assert.equal(clock.seconds(), 0);
});
