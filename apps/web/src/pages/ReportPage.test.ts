import { describe, expect, it } from 'vitest';
import type { Project, ReportCategory, ReportItem, WeeklyReport } from '@zhoubao/shared';
import {
  applyOpenItemPlacement,
  buildReportText,
  clipboardImage,
  groupItemsByProjectAndCategory,
  lastActiveCategoryId,
  previousReportWeek,
  reportProgressSummary,
  reportWithLatestDrafts
} from './ReportPage';

const projects: Project[] = [
  { id: 'project-a', name: '项目甲', color: '#345B9B', archivedAt: null, position: 0 }
];
const categories: ReportCategory[] = [
  { id: 'operations', name: '运维', position: 1, archivedAt: null },
  { id: 'development', name: '开发', position: 0, archivedAt: null }
];

function item(id: string, categoryId: string | null, contentMd = id): ReportItem {
  return {
    id,
    reportId: 'report',
    importedFromItemId: null,
    projectId: 'project-a',
    categoryId,
    type: 'completed',
    contentMd,
    occurredOn: null,
    progress: 'completed',
    note: '',
    position: 0,
    version: 1,
    tags: []
  };
}

describe('weekly report category presentation', () => {
  it('keeps an open item in its original group until details close', () => {
    const saved = {
      ...item('moving', 'operations'),
      projectId: 'project-b',
      type: 'next_plan' as const
    };

    expect(
      applyOpenItemPlacement([saved], {
        itemId: saved.id,
        placement: { projectId: 'project-a', categoryId: 'development', type: 'completed' }
      })[0]
    ).toMatchObject({
      projectId: 'project-a',
      categoryId: 'development',
      type: 'completed',
      version: saved.version
    });
    expect(applyOpenItemPlacement([saved], null)[0]).toBe(saved);
  });

  it('prefers the current live draft when preparing copied report data', () => {
    const serverItem = item('drafted', 'development', '服务器内容');
    const report: WeeklyReport = {
      id: 'report',
      weekYear: 2026,
      weekNumber: 34,
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      version: 1,
      author: { id: 'user', displayName: '测试用户', email: null, avatarUrl: null },
      items: [serverItem],
      calendarDays: [],
      holidayDataAvailable: true
    };
    const liveDrafts = new Map([
      [
        serverItem.id,
        {
          contentMd: '刚刚输入的内容',
          progress: 'incomplete' as const,
          note: '本地备注',
          projectId: serverItem.projectId,
          categoryId: serverItem.categoryId,
          type: serverItem.type,
          occurredOn: '2026-08-19',
          tagIds: []
        }
      ]
    ]);

    const latest = reportWithLatestDrafts(report, liveDrafts, () => ({
      ...liveDrafts.get(serverItem.id)!,
      contentMd: '较旧的持久化草稿'
    }));
    expect(latest.items[0]).toMatchObject({
      contentMd: '刚刚输入的内容',
      progress: 'incomplete',
      note: '本地备注',
      occurredOn: '2026-08-19'
    });
  });

  it('selects supported clipboard images without intercepting ordinary clipboard data', () => {
    const png = { name: 'screenshot.png', type: 'image/png' } as File;
    const textItem = { kind: 'string', type: 'text/plain', getAsFile: () => null };
    const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => png };

    expect(clipboardImage({ items: [textItem] })).toBeNull();
    expect(clipboardImage({ items: [textItem, imageItem] })).toBe(png);
    expect(clipboardImage({ files: [{ name: 'photo.bmp', type: 'image/bmp' } as File] })).toBeNull();
  });

  it('merges all items of the same category and keeps uncategorized items last', () => {
    const groups = groupItemsByProjectAndCategory(
      [
        item('ops-1', 'operations'),
        item('none', null),
        item('dev-1', 'development'),
        item('dev-2', 'development')
      ],
      projects,
      categories
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.categoryGroups.map((group) => group.category?.name ?? '未分类')).toEqual([
      '开发',
      '运维',
      '未分类'
    ]);
    expect(groups[0]?.categoryGroups[0]?.items.map((entry) => entry.id)).toEqual(['dev-1', 'dev-2']);
  });

  it('keeps archived project names in historical report groups', () => {
    const archivedProject: Project = {
      id: 'project-archived',
      name: '历史项目',
      color: '#61758A',
      archivedAt: '2026-08-17T00:00:00Z',
      position: 1
    };
    const archivedItem = { ...item('archived-item', 'development'), projectId: archivedProject.id };

    const groups = groupItemsByProjectAndCategory(
      [archivedItem, { ...item('unassigned', null), projectId: null }],
      [...projects, archivedProject],
      categories
    );

    expect(groups.find((group) => group.key === archivedProject.id)?.project?.name).toBe('历史项目');
    expect(groups.find((group) => group.key === 'unassigned')?.items.map((entry) => entry.id)).toEqual([
      'unassigned'
    ]);
  });

  it('orders project groups by active state and configured position with unassigned last', () => {
    const second: Project = {
      id: 'project-b',
      name: '项目乙',
      color: '#61758A',
      archivedAt: null,
      position: 0
    };
    const first = { ...projects[0]!, position: 2 };
    const archived = { ...first, id: 'project-old', name: '历史项目', archivedAt: '2026-08-01T00:00:00Z' };
    const groups = groupItemsByProjectAndCategory(
      [
        { ...item('first', null), projectId: first.id },
        { ...item('none', null), projectId: null },
        { ...item('old', null), projectId: archived.id },
        { ...item('second', null), projectId: second.id }
      ],
      [first, second, archived],
      categories
    );

    expect(groups.map((group) => group.key)).toEqual([second.id, first.id, archived.id, 'unassigned']);
  });

  it('prefixes copied entries with their category name', () => {
    const report: WeeklyReport = {
      id: 'report',
      weekYear: 2026,
      weekNumber: 33,
      weekStart: '2026-08-10',
      weekEnd: '2026-08-16',
      version: 1,
      author: { id: 'user', displayName: '测试用户', email: null, avatarUrl: null },
      items: [
        item('ops', 'operations', '处理告警'),
        item('dev', 'development', '完成接口改造'),
        item('none', null, '整理记录')
      ],
      calendarDays: [],
      holidayDataAvailable: true
    };

    const text = buildReportText(report, projects, categories);
    expect(text).toContain('1. [开发] 完成接口改造');
    expect(text).toContain('2. [运维] 处理告警');
    expect(text).toContain('3. [未分类] 整理记录');
  });

  it('includes an occurrence date in copied text only when present', () => {
    const report: WeeklyReport = {
      id: 'report-dates',
      weekYear: 2026,
      weekNumber: 34,
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      version: 1,
      author: { id: 'user', displayName: '测试用户', email: null, avatarUrl: null },
      items: [
        { ...item('dated', 'development', '完成日期展示'), occurredOn: '2026-08-18' },
        item('undated', 'development', '没有日期')
      ],
      calendarDays: [],
      holidayDataAvailable: true
    };
    const text = buildReportText(report, projects, categories);
    expect(text).toContain('1. [开发] [2026-08-18] 完成日期展示');
    expect(text).toContain('2. [开发] 没有日期');
  });

  it('inherits the last active category used by the project', () => {
    const grouped = groupItemsByProjectAndCategory(
      [item('dev', 'development'), item('ops', 'operations'), item('none', null)],
      projects,
      categories
    )[0]!;
    expect(lastActiveCategoryId(grouped)).toBe('operations');

    const operationsArchived = categories.map((category) =>
      category.id === 'operations' ? { ...category, archivedAt: '2026-08-13T00:00:00Z' } : category
    );
    const archivedGrouped = groupItemsByProjectAndCategory(
      [item('dev', 'development'), item('ops', 'operations'), item('none', null)],
      projects,
      operationsArchived
    )[0]!;
    expect(lastActiveCategoryId(archivedGrouped)).toBe('development');

    const allArchived = operationsArchived.map((category) => ({
      ...category,
      archivedAt: category.archivedAt ?? '2026-08-13T00:00:00Z'
    }));
    const fallbackGrouped = groupItemsByProjectAndCategory(
      [item('dev', 'development'), item('ops', 'operations'), item('none', null)],
      projects,
      allArchived
    )[0]!;
    expect(lastActiveCategoryId(fallbackGrouped)).toBeNull();
  });

  it('counts answered work as completed and labels incomplete work as in progress', () => {
    const completed = item('completed', 'development', '已完成任务');
    const answered = { ...item('answered', 'development', '已解答问题'), progress: 'answered' as const };
    const inProgress = {
      ...item('in-progress', 'operations', '继续推进任务'),
      progress: 'incomplete' as const
    };
    expect(reportProgressSummary([completed, answered, inProgress])).toEqual({
      total: 3,
      completed: 2,
      inProgress: 1,
      projectCount: 1
    });

    const report: WeeklyReport = {
      id: 'report',
      weekYear: 2026,
      weekNumber: 33,
      weekStart: '2026-08-10',
      weekEnd: '2026-08-16',
      version: 1,
      author: { id: 'user', displayName: '测试用户', email: null, avatarUrl: null },
      items: [inProgress],
      calendarDays: [],
      holidayDataAvailable: true
    };
    expect(buildReportText(report, projects, categories)).toContain('推进中');
  });

  it('finds the previous ISO week across calendar years', () => {
    expect(previousReportWeek('2024-12-30')).toEqual({ year: 2024, week: 52 });
  });
});
