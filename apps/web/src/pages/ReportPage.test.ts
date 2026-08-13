import { describe, expect, it } from 'vitest';
import type { Project, ReportCategory, ReportItem, WeeklyReport } from '@zhoubao/shared';
import { buildReportText, groupItemsByProjectAndCategory, lastActiveCategoryId } from './ReportPage';

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
});
