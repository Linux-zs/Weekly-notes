import { spawn } from 'node:child_process';
import { config } from '../config.js';

// The recipient is validated before invoking mailx. No shell or user-authored body is used.
export function sendVerificationEmail(email: string, code: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._+%-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) || !/^\d{6}$/.test(code)) {
    return Promise.reject(new Error('Invalid mail input'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.MAILX_PATH,
      ['-S', 'sendwait', '-s', 'Weekly Notes - Email verification', email],
      {
        shell: false,
        stdio: ['pipe', 'ignore', 'ignore'],
        windowsHide: true
      }
    );
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Mail delivery timed out'));
    }, 15_000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Mail delivery unavailable'));
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      if (status === 0) resolve();
      else reject(new Error('Mail delivery failed'));
    });
    child.stdin.on('error', () => {
      /* Process close/error handles delivery failure. */
    });
    child.stdin.end(
      `Your Weekly Notes registration code is: ${code}\n\nThis code expires in 10 minutes. If you did not request it, ignore this email.\n`
    );
  });
}
