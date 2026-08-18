import { describe, expect, it, vi } from 'vitest';
import { createLatestTaskQueue } from './latest-task-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('latest task queue', () => {
  it('serializes work and keeps only the newest queued task', async () => {
    const first = deferred();
    const calls: number[] = [];
    const worker = vi.fn(async (value: number) => {
      calls.push(value);
      if (value === 1) await first.promise;
    });
    const queue = createLatestTaskQueue(worker);

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    expect(calls).toEqual([1]);

    first.resolve();
    await vi.waitFor(() => expect(queue.isBusy()).toBe(false));
    expect(calls).toEqual([1, 3]);
  });

  it('drops queued work after a task fails', async () => {
    const failed = deferred();
    const onError = vi.fn();
    const worker = vi.fn(async (value: number) => {
      if (value === 1) {
        await failed.promise;
        throw new Error('conflict');
      }
    });
    const queue = createLatestTaskQueue(worker, onError);

    queue.enqueue(1);
    queue.enqueue(2);
    failed.resolve();

    await vi.waitFor(() => expect(queue.isBusy()).toBe(false));
    expect(worker).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledOnce();
  });
});
