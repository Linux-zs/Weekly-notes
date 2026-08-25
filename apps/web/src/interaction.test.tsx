// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from './api';
import { LoginPage } from './App';
import { TagField } from './components';
import { SearchPage } from './pages/SearchPage';
import { ReportPage } from './pages/ReportPage';

vi.mock('./api', () => ({
  api: vi.fn()
}));

const mockedApi = vi.mocked(api);

function queryWrapper(client: QueryClient, children: ReactNode) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderSearchPage(tags: Array<{ id: string; name: string; color: string }>) {
  mockedApi.mockImplementation((path: string) => {
    if (path === '/api/projects') return Promise.resolve({ projects: [] }) as never;
    if (path === '/api/tags') return Promise.resolve({ tags }) as never;
    if (path.startsWith('/api/search?')) {
      return Promise.resolve({ items: [], page: 1, hasMore: false }) as never;
    }
    throw new Error(`Unexpected API path: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    queryWrapper(
      client,
      <MemoryRouter>
        <SearchPage />
      </MemoryRouter>
    )
  );
}

afterEach(() => {
  cleanup();
  mockedApi.mockReset();
});

describe('interactive limits and login availability', () => {
  it('offers previous-week import from an empty report section', async () => {
    const report = {
      id: 'report-34',
      weekYear: 2026,
      weekNumber: 34,
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      version: 1,
      author: { id: 'user-1', displayName: '测试用户' },
      items: [],
      calendarDays: [],
      holidayDataAvailable: true
    };
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/reports/2026/34') return Promise.resolve(report) as never;
      if (path === '/api/reports/2026/33')
        return Promise.resolve({
          ...report,
          id: 'report-33',
          weekNumber: 33,
          weekStart: '2026-08-10',
          weekEnd: '2026-08-16'
        }) as never;
      if (path === '/api/report-weeks/2026') return Promise.resolve({ year: 2026, weeks: [] }) as never;
      if (path === '/api/projects') return Promise.resolve({ projects: [] }) as never;
      if (path === '/api/categories') return Promise.resolve({ categories: [] }) as never;
      throw new Error(`Unexpected API path: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      queryWrapper(
        client,
        <MemoryRouter initialEntries={['/week/2026/34']}>
          <Routes>
            <Route
              path="/week/:year/:week"
              element={
                <ReportPage
                  user={{
                    id: 'user-1',
                    displayName: '测试用户',
                    email: null,
                    avatarUrl: null,
                    timezone: 'Asia/Shanghai'
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      )
    );

    const openImport = await screen.findByRole('button', { name: '引入上周任务' });
    expect(screen.getByRole('button', { name: '添加一条本周完成' })).toBeTruthy();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    });
    await userEvent.click(screen.getByRole('button', { name: '复制汇报' }));
    expect(await screen.findByText('复制汇报失败，请检查浏览器剪贴板权限后重试。')).toBeTruthy();
    await userEvent.click(openImport);
    expect(await screen.findByRole('dialog', { name: '引入上周任务' })).toBeTruthy();
  });

  it('opens details with one click and exposes explicit and keyboard editing', async () => {
    const report = {
      id: 'report-34',
      weekYear: 2026,
      weekNumber: 34,
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      version: 1,
      author: { id: 'user-1', displayName: '测试用户' },
      items: [
        {
          id: 'item-1',
          reportId: 'report-34',
          importedFromItemId: null,
          projectId: 'project-1',
          categoryId: 'category-1',
          type: 'completed' as const,
          contentMd: '完成接口改造',
          occurredOn: null,
          progress: 'completed' as const,
          note: '',
          position: 0,
          version: 1,
          tags: []
        }
      ],
      calendarDays: [],
      holidayDataAvailable: true
    };
    mockedApi.mockImplementation((path: string) => {
      if (path === '/api/reports/2026/34') return Promise.resolve(report) as never;
      if (path === '/api/report-weeks/2026') return Promise.resolve({ year: 2026, weeks: [] }) as never;
      if (path === '/api/projects')
        return Promise.resolve({
          projects: [{ id: 'project-1', name: '客户端', color: '#CF4F1C', position: 0, archivedAt: null }]
        }) as never;
      if (path === '/api/categories')
        return Promise.resolve({
          categories: [{ id: 'category-1', name: '开发', position: 0, archivedAt: null }]
        }) as never;
      if (path === '/api/report-items/item-1/attachments')
        return Promise.resolve({ attachments: [] }) as never;
      throw new Error(`Unexpected API path: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      queryWrapper(
        client,
        <MemoryRouter initialEntries={['/week/2026/34']}>
          <Routes>
            <Route
              path="/week/:year/:week"
              element={
                <ReportPage
                  user={{
                    id: 'user-1',
                    displayName: '测试用户',
                    email: null,
                    avatarUrl: null,
                    timezone: 'Asia/Shanghai'
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      )
    );

    await userEvent.click(await screen.findByRole('button', { name: '完成接口改造' }));
    expect(screen.getByRole('dialog', { name: '周报详情 · 第 1 条' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '关闭' }));
    await userEvent.click(screen.getByRole('button', { name: '编辑第 1 条内容' }));
    expect(screen.getByRole('textbox', { name: '本周完成第 1 条内容' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');

    const projectName = screen.getByRole('button', { name: '客户端' });
    projectName.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: '编辑项目名称' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    const categoryName = screen.getByRole('button', { name: '编辑分类 开发' });
    categoryName.focus();
    await userEvent.keyboard('{F2}');
    expect(screen.getByRole('textbox', { name: '编辑分类 开发' })).toBeTruthy();
  });

  it('disables new tag choices at the per-item limit but still allows removal', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } }
    });
    const tags = Array.from({ length: 21 }, (_, index) => ({
      id: `tag-${index + 1}`,
      name: `标签 ${index + 1}`,
      color: '#78909C'
    }));
    client.setQueryData(['tags'], { tags });
    const onChange = vi.fn();
    render(
      queryWrapper(client, <TagField value={tags.slice(0, 20).map((tag) => tag.id)} onChange={onChange} />)
    );

    expect(screen.getByText('每条周报最多选择 20 个标签')).toBeTruthy();
    expect((screen.getByRole('button', { name: '标签 21' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /新标签/ }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '标签 1' }));
    expect(onChange).toHaveBeenCalledWith(tags.slice(1, 20).map((tag) => tag.id));
  });

  it('uses the latest selection when an asynchronous tag creation finishes', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } }
    });
    client.setQueryData(['tags'], { tags: [] });
    let finishCreation: ((value: unknown) => void) | undefined;
    mockedApi.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreation = resolve;
        }) as never
    );
    const onChange = vi.fn();
    const view = render(queryWrapper(client, <TagField value={[]} onChange={onChange} />));

    await userEvent.click(screen.getByRole('button', { name: /新标签/ }));
    await userEvent.type(screen.getByPlaceholderText('标签名称'), '新标签');
    await userEvent.click(screen.getByRole('button', { name: '创建' }));
    view.rerender(queryWrapper(client, <TagField value={['later-selection']} onChange={onChange} />));
    await act(async () => {
      finishCreation?.({ id: 'created-tag', name: '新标签', color: '#CF4F1C' });
    });

    expect(onChange).toHaveBeenCalledWith(['later-selection', 'created-tag']);
  });

  it('shows a configuration error instead of an unavailable development login', async () => {
    mockedApi.mockResolvedValue({
      devAuthEnabled: false,
      providers: [
        { provider: 'google', enabled: false },
        { provider: 'microsoft', enabled: false }
      ]
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(queryWrapper(client, <LoginPage />));

    expect(await screen.findByText('尚未配置可用的登录平台，请联系管理员完成身份平台配置。')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '进入本地开发环境' })).toBeNull();
  });

  it('hides the tag filter row when the workspace has no tags', async () => {
    renderSearchPage([]);

    expect(await screen.findByPlaceholderText('搜索周报内容……')).toBeTruthy();
    expect(screen.queryByText('标签', { selector: '.search-tag-row > span' })).toBeNull();
  });

  it('shows selectable tag filters when the workspace has tags', async () => {
    renderSearchPage([{ id: 'tag-1', name: '客户沟通', color: '#CF4F1C' }]);

    const tag = await screen.findByRole('button', { name: '客户沟通' });
    expect(screen.getByText('标签', { selector: '.search-tag-row > span' })).toBeTruthy();
    await userEvent.click(tag);
    expect(tag.classList.contains('selected')).toBe(true);
  });
});
