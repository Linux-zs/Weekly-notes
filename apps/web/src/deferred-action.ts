export function createDeferredAction() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | undefined;

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    schedule(action: () => void, delay: number) {
      cancelTimer();
      pending = action;
      timer = setTimeout(() => {
        timer = undefined;
        const next = pending;
        pending = undefined;
        next?.();
      }, delay);
    },
    flush() {
      cancelTimer();
      const next = pending;
      pending = undefined;
      next?.();
    },
    cancel() {
      cancelTimer();
      pending = undefined;
    },
    hasPending() {
      return pending !== undefined;
    }
  };
}
