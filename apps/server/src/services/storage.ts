let storageTail = Promise.resolve();

export async function withStorageLock<T>(action: () => T | Promise<T>): Promise<T> {
  const previous = storageTail;
  let release: () => void = () => {};
  storageTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}
