// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { DepartedReports } from './DepartedReports';

vi.mock('../api', () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.mocked(api).mockReset();
});

it('requires confirmation, retains errors for retry, and refreshes after deleting', async () => {
  let deleted = false;
  let attempts = 0;
  vi.mocked(api).mockImplementation(async (_path, init) => {
    if (init?.method === 'DELETE') {
      if (++attempts === 1) throw new Error('删除失败，请重试');
      deleted = true;
      return undefined as never;
    }
    return {
      reports: deleted
        ? []
        : [
            {
              id: 'report',
              authorName: '原成员',
              weekYear: 2026,
              weekNumber: 42,
              items: [{ id: 'item', contentMd: '需要清理的历史条目', note: '', projectName: '共享项目' }]
            }
          ],
      hasMore: false
    } as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DepartedReports />
    </QueryClientProvider>
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText(/原成员 · 2026/));
  expect(screen.getByText('需要清理的历史条目')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '删除此历史周报' }));
  expect(attempts).toBe(0);
  await user.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(attempts).toBe(0);
  await user.click(screen.getByRole('button', { name: '删除此历史周报' }));
  await user.click(screen.getByRole('button', { name: '确认永久删除' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '删除失败，请重试');
  expect(screen.getByRole('dialog')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '确认永久删除' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('暂无已移除成员的历史周报。')).toBeTruthy();
});
