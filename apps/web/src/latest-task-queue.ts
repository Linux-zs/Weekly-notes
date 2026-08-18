export function createLatestTaskQueue<T>(
  worker: (task: T) => Promise<void>,
  onError?: (error: unknown) => void,
  onIdle?: () => void
) {
  let running = false;
  let queued: T | undefined;

  const drain = async (initial: T) => {
    running = true;
    let current: T | undefined = initial;
    while (current !== undefined) {
      try {
        await worker(current);
      } catch (error) {
        queued = undefined;
        onError?.(error);
        break;
      }
      current = queued;
      queued = undefined;
    }
    running = false;
    onIdle?.();
  };

  return {
    enqueue(task: T) {
      if (running) {
        queued = task;
        return;
      }
      void drain(task);
    },
    clearPending() {
      queued = undefined;
    },
    isBusy() {
      return running || queued !== undefined;
    }
  };
}
