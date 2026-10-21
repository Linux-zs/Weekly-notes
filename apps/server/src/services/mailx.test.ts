import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
import { sendVerificationEmail } from './mailx.js';
afterEach(() => {
  vi.useRealTimers();
  spawn.mockReset();
});
function processMock() {
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    kill: vi.fn()
  });
  spawn.mockReturnValue(child);
  return child;
}
it('passes fixed arguments without a shell and sends the code only through stdin', async () => {
  const child = processMock();
  const sent = sendVerificationEmail('safe@example.test', '123456');
  expect(spawn.mock.calls[0]?.[1]).toEqual([
    '-S',
    'sendwait',
    '-s',
    'Weekly Notes - Email verification',
    'safe@example.test'
  ]);
  expect(spawn.mock.calls[0]?.[2].shell).toBe(false);
  expect(child.stdin.end).toHaveBeenCalledWith(expect.stringContaining('123456'));
  child.emit('close', 0);
  await sent;
});
it('rejects failed processes, timeouts, and mail option injection', async () => {
  const child = processMock();
  const sent = sendVerificationEmail('safe@example.test', '123456');
  child.emit('close', 1);
  await expect(sent).rejects.toThrow('failed');
  await expect(sendVerificationEmail('-r@example.test', '123456')).rejects.toThrow('Invalid');
  await expect(sendVerificationEmail('a@example.test\nBcc:other@example.test', '123456')).rejects.toThrow(
    'Invalid'
  );
  vi.useFakeTimers();
  const pending = sendVerificationEmail('safe@example.test', '123456');
  const assertion = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
});
