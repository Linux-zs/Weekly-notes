// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { api, ApiError } from './api';
import { ReportPage } from './pages/ReportPage';
import { readItemDraft, writeItemDraft } from './item-draft-store';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn()
}));
const mockedApi = vi.mocked(api);
const item = {
  id: 'rich-item',
  reportId: 'report',
  importedFromItemId: null,
  projectId: null,
  categoryId: null,
  type: 'completed' as const,
  contentMd: '已有正文',
  occurredOn: null,
  progress: 'completed' as const,
  note: '',
  position: 0,
  version: 1,
  tags: []
};
const report = {
  id: 'report',
  weekYear: 2026,
  weekNumber: 34,
  weekStart: '2026-08-17',
  weekEnd: '2026-08-23',
  version: 1,
  author: { id: 'user', displayName: '测试' },
  items: [item],
  calendarDays: [],
  holidayDataAvailable: true
};
async function open(patch: (body: Record<string, unknown>) => Promise<unknown>) {
  mockedApi.mockImplementation((path, init) => {
    if (path === '/api/reports/2026/34') return Promise.resolve(report) as never;
    if (path === '/api/report-weeks/2026') return Promise.resolve({ year: 2026, weeks: [] }) as never;
    if (path === '/api/projects') return Promise.resolve({ projects: [] }) as never;
    if (path === '/api/categories') return Promise.resolve({ categories: [] }) as never;
    if (path === '/api/tags') return Promise.resolve({ tags: [] }) as never;
    if (path.endsWith('/attachments')) return Promise.resolve({ attachments: [] }) as never;
    if (init?.method === 'PATCH') return patch(JSON.parse(String(init.body))) as never;
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/week/2026/34?item=rich-item']}>
        <Routes>
          <Route
            path="/week/:year/:week"
            element={
              <ReportPage
                user={{
                  id: 'user',
                  displayName: '测试',
                  email: null,
                  avatarUrl: null,
                  timezone: 'Asia/Shanghai'
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  return (screen.getByRole('textbox', { name: '正文内容' }) as HTMLElement & { editor: Editor }).editor;
}
const saved = (body: Record<string, unknown>, version = 2) => ({
  ...item,
  ...body,
  tags: [],
  version,
  reportVersion: version
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.useRealTimers();
  mockedApi.mockReset();
  localStorage.clear();
});

describe('detail editor autosave integration', () => {
  it('does not save on open, debounces continuous typing, and preserves selection/history on acknowledgement', async () => {
    const patch = vi.fn(async (body) => saved(body));
    const editor = await open(patch);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(patch).not.toHaveBeenCalled();
    act(() => {
      editor.commands.insertContentAt(1, '甲');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    act(() => {
      editor.commands.insertContentAt(2, '乙');
    });
    const selection = editor.state.selection;
    const doc = editor.state.doc;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(799);
    });
    expect(patch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0].contentMd).toBe('甲乙已有正文');
    expect(editor.state.doc).toBe(doc);
    expect(editor.state.selection).toBe(selection);
    expect(editor.can().undo()).toBe(true);
    expect(readItemDraft(item.id)).toBeNull();
  });

  it('flushes a same-tick edit on close and reuses the editor on reopen', async () => {
    const patch = vi.fn(async (body) => saved(body));
    const editor = await open(patch);
    await act(async () => {
      editor.commands.insertContentAt(1, '快速');
      fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    });
    expect(patch.mock.calls[0][0].contentMd).toBe('快速已有正文');
    fireEvent.click(screen.getByRole('button', { name: '快速已有正文' }));
    expect(
      (screen.getByRole('textbox', { name: '正文内容' }) as HTMLElement & { editor: Editor }).editor
    ).toBe(editor);
  });

  it('retains a local draft offline and retries the latest body', async () => {
    const patch = vi
      .fn()
      .mockRejectedValueOnce(new Error('断网'))
      .mockImplementation(async (body) => saved(body));
    const editor = await open(patch);
    act(() => {
      editor.commands.insertContentAt(1, '离线');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(readItemDraft<{ contentMd: string }>(item.id)?.draft.contentMd).toBe('离线已有正文');
    expect(screen.getAllByText('保存失败').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '重试保存' })[0]);
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(readItemDraft(item.id)).toBeNull();
    expect(screen.getByText('已保存')).toBeTruthy();
  });

  it('keeps later input when a slow save responds and serializes the next version', async () => {
    let finish!: (value: unknown) => void;
    const patch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockImplementation(async (body) => saved(body, 3));
    const editor = await open(patch);
    act(() => {
      editor.commands.insertContentAt(1, '甲');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    act(() => {
      editor.commands.insertContentAt(2, '乙');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(patch).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(saved(patch.mock.calls[0][0]));
    });
    expect(patch.mock.calls[1][0]).toMatchObject({ contentMd: '甲乙已有正文', expectedVersion: 2 });
    expect(editor.getText()).toBe('甲乙已有正文');
  });

  it('keeps conflict edits local until the user explicitly reapplies them', async () => {
    const patch = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, { current: { ...item, contentMd: '远端', version: 4 }, reportVersion: 4 })
      )
      .mockImplementation(async (body) => saved(body, 5));
    const editor = await open(patch);
    act(() => {
      editor.commands.insertContentAt(1, '本地');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    act(() => {
      editor.commands.insertContentAt(3, '继续');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(readItemDraft<{ contentMd: string }>(item.id)?.draft.contentMd).toBe('本地继续已有正文');
    await act(async () => {
      fireEvent.click(screen.getByText('重新应用本地修改'));
    });
    expect(patch.mock.calls[1][0]).toMatchObject({ contentMd: '本地继续已有正文', expectedVersion: 4 });
    expect(editor.getText()).toBe('本地继续已有正文');
  });

  it('restores a local draft without replacing it with stale server content', async () => {
    writeItemDraft(item.id, {
      serverVersion: 1,
      revision: 2,
      draft: {
        contentMd: '本地草稿',
        progress: item.progress,
        note: '',
        projectId: null,
        categoryId: null,
        type: item.type,
        occurredOn: null,
        tagIds: []
      }
    });
    const patch = vi.fn(async (body) => saved(body));
    const editor = await open(patch);
    expect(editor.getText()).toBe('本地草稿');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(patch.mock.calls[0][0].contentMd).toBe('本地草稿');
  });
});
