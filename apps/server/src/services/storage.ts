import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';

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

export function removeStoredFile(filePath: string, logger: FastifyBaseLogger, message: string) {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch (error) {
    logger.warn({ err: error, filePath }, message);
    return false;
  }
}
