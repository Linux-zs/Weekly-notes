import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeferredAction } from './deferred-action';

afterEach(() => vi.useRealTimers());

describe('deferred action', () => {
  it('runs only the latest scheduled action', () => {
    vi.useFakeTimers();
    const action = createDeferredAction();
    const calls: string[] = [];

    action.schedule(() => calls.push('old'), 800);
    action.schedule(() => calls.push('latest'), 800);
    vi.advanceTimersByTime(800);

    expect(calls).toEqual(['latest']);
    expect(action.hasPending()).toBe(false);
  });

  it('flushes a pending action immediately and only once', () => {
    vi.useFakeTimers();
    const action = createDeferredAction();
    const callback = vi.fn();

    action.schedule(callback, 800);
    action.flush();
    vi.advanceTimersByTime(800);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(action.hasPending()).toBe(false);
  });
});
