// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailAuthForm } from './EmailAuthForm';
import { api } from './api';
vi.mock('./api', () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.mocked(api).mockReset();
});
it('submits email and password and preserves input on login errors', async () => {
  vi.mocked(api).mockRejectedValue(new Error('邮箱或密码不正确'));
  render(<EmailAuthForm />);
  await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.test');
  await userEvent.type(screen.getByLabelText('密码'), 'test password');
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '邮箱或密码不正确');
  expect(api).toHaveBeenCalledWith(
    '/api/auth/email/login',
    expect.objectContaining({
      body: JSON.stringify({ email: 'user@example.test', password: 'test password' })
    })
  );
});
it('sends a registration code, starts cooldown, and displays send errors', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('发送失败'))
    .mockResolvedValueOnce({ retryAfter: 60, message: '验证码已发送' });
  render(<EmailAuthForm />);
  await userEvent.click(screen.getByRole('button', { name: '没有账号，注册邮箱账号' }));
  await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.test');
  await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '发送失败');
  await userEvent.click(screen.getByRole('button', { name: '发送验证码' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', '验证码已发送，10 分钟内有效。');
  expect((screen.getByRole('button', { name: '60 秒后重发' }) as HTMLButtonElement).disabled).toBe(true);
});
