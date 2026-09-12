import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MIN_STEP_INTERVAL_MS } from '@atheriam/shared';
import { TouchStep } from './touch-step.js';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

it('preserves a second quick tap until the next allowed step', () => {
  const send = vi.fn();
  const steps = new TouchStep(send);
  steps.request('n');
  vi.advanceTimersByTime(60);
  steps.request('n');
  expect(send).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(MIN_STEP_INTERVAL_MS + 20 - 60);
  expect(send.mock.calls).toEqual([['n'], ['n']]);
  vi.advanceTimersByTime(1000);
  expect(send).toHaveBeenCalledTimes(2);
});

it('keeps only the latest direction rather than an accumulating walk queue', () => {
  const send = vi.fn();
  const steps = new TouchStep(send);
  steps.request('n');
  for (let i = 0; i < 30; i++) steps.request('w');
  steps.request('e');
  vi.advanceTimersByTime(1000);
  expect(send.mock.calls).toEqual([['n'], ['e']]);
});

it('drops pending movement when controls are cancelled or removed', () => {
  const send = vi.fn();
  const steps = new TouchStep(send);
  steps.request('n');
  steps.request('s');
  steps.cancel();
  vi.advanceTimersByTime(1000);
  expect(send.mock.calls).toEqual([['n']]);
  steps.request('w');
  expect(send.mock.calls).toEqual([['n'], ['w']]);
});
