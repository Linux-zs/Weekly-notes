import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Project,
  ReportCategory,
  ReportItem,
  ReportItemProgress,
  ReportItemType,
  WeeklyReport
} from '@zhoubao/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Download,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { ErrorState, Loading, Modal, TagField } from '../components';
import { createDeferredAction } from '../deferred-action';
import { createLatestTaskQueue } from '../latest-task-queue';
import {
  addDays,
  formatDate,
  hasMarkdownImage,
  isoWeekForDate,
  Markdown,
  attachmentImageWidth,
  sectionHints,
  sectionLabels,
  setAttachmentImageWidth,
  stripMarkdownImages,
  todayShanghai,
  weeksInIsoYear
} from '../lib';

const sections: ReportItemType[] = ['completed', 'next_plan'];
const copySections: ReportItemType[] = ['completed', 'other', 'next_plan'];
const projectColors = ['#CF4F1C', '#2D6A4F', '#3A5BA0', '#8A4FA3', '#C7831B', '#59636E'];
type User = { id: string; displayName: string; email: string | null; avatarUrl: string | null };
type ReportWeekSummary = { year: number; weeks: Array<{ weekNumber: number; itemCount: number }> };
type CategoryItemGroup = {
  key: string;
  category: ReportCategory | null;
  items: ReportItem[];
};
type ProjectItemGroup = {
  key: string;
  project: Project | null;
  items: ReportItem[];
  categoryGroups: CategoryItemGroup[];
};
type ProjectDraft = { name: string; color: string };
type ItemMeta = { progress: ReportItemProgress; note: string };
type ItemDraft = {
  contentMd: string;
  progress: ReportItemProgress;
  note: string;
  projectId: string | null;
  categoryId: string | null;
  type: ReportItemType;
  occurredOn: string | null;
  tagIds: string[];
};
type ItemSaveTask = { revision: number; draft: ItemDraft };
type CategoryAssignment = { itemId: string; expectedVersion: number };
type CreateCategoryInput = { name: string; assignments?: CategoryAssignment[] };
const progressLabels: Record<ReportItemProgress, string> = {
  completed: '已完成',
  answered: '已解答',
  incomplete: '推进中'
};

function readInitialItemMeta(item: ReportItem): { meta: ItemMeta; legacy: boolean } {
  const fallback: ItemMeta = { progress: item.progress, note: item.note };
  try {
    const value = localStorage.getItem(`weekly-notes:item-meta:${item.id}`);
    return value
      ? { meta: { ...fallback, ...JSON.parse(value) }, legacy: true }
      : { meta: fallback, legacy: false };
  } catch {
    return { meta: fallback, legacy: false };
  }
}

export function ReportPage({ user }: { user: User }) {
  const params = useParams();
  const current = isoWeekForDate(todayShanghai());
  const year = Number(params.year) || current.year;
  const week = Number(params.week) || current.week;
  const [activeSection, setActiveSection] = useState(0);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const report = useQuery({
    queryKey: ['report', year, week],
    queryFn: () => api<WeeklyReport>(`/api/reports/${year}/${week}`)
  });
  const reportWeeks = useQuery({
    queryKey: ['report-weeks', year],
    queryFn: () => api<ReportWeekSummary>(`/api/report-weeks/${year}`)
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: Project[] }>('/api/projects')
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: ReportCategory[] }>('/api/categories')
  });
  useEffect(() => setActiveSection(0), [year, week]);
  const addMutation = useMutation({
    mutationFn: async ({
      type,
      projectId,
      categoryId
    }: {
      type: ReportItemType;
      projectId: string | null;
      categoryId: string | null;
    }) => {
      let data = report.data!;
      if (!data.id)
        data = await api<WeeklyReport>(`/api/reports/${year}/${week}`, { method: 'PUT', body: '{}' });
      return api(`/api/reports/${data.id}/items`, {
        method: 'POST',
        body: JSON.stringify({ type, projectId, categoryId, contentMd: '' })
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report', year, week] });
      qc.invalidateQueries({ queryKey: ['report-weeks', year] });
    }
  });
  const createCategory = useMutation({
    mutationFn: ({ name, assignments }: CreateCategoryInput) =>
      api<ReportCategory>('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name, assignments })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] })
  });
  const createProject = useMutation({
    mutationFn: async ({ type, draft }: { type: ReportItemType; draft: ProjectDraft }) => {
      const result = await api<{ project: Project; items: ReportItem[]; reportVersion: number }>(
        `/api/reports/${year}/${week}/projects`,
        {
          method: 'POST',
          body: JSON.stringify({ ...draft, type })
        }
      );
      return result.project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['report', year, week] });
      qc.invalidateQueries({ queryKey: ['report-weeks', year] });
    }
  });

  if (report.isLoading || reportWeeks.isLoading || projects.isLoading || categories.isLoading)
    return (
      <PageFrame title="周报">
        <Loading />
      </PageFrame>
    );
  if (report.error || reportWeeks.error || projects.error || categories.error)
    return (
      <PageFrame title="周报">
        <ErrorState
          message={(report.error ?? reportWeeks.error ?? projects.error ?? categories.error)!.message}
          onRetry={() => {
            report.refetch();
            reportWeeks.refetch();
            projects.refetch();
            categories.refetch();
          }}
        />
      </PageFrame>
    );

  const data = report.data!;
  const activeType = sections[activeSection];
  const move = (delta: number) => {
    const next = isoWeekForDate(addDays(data.weekStart, delta * 7));
    navigate(
      next.year === current.year && next.week === current.week ? '/' : `/week/${next.year}/${next.week}`
    );
  };
  const copyReport = async () => {
    await navigator.clipboard.writeText(
      buildReportText(data, projects.data!.projects, categories.data!.categories)
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="page report-page">
      <header className="week-hero">
        <div className="week-main-row">
          <div className="week-title-block">
            <div className="week-kicker">
              <CalendarDays size={16} />
              <span>
                {year} · WEEK {String(week).padStart(2, '0')}
              </span>
            </div>
            <h1>工作汇报</h1>
            <p>
              {formatDate(data.weekStart)} — {formatDate(data.weekEnd)} · 汇报人：{user.displayName}
            </p>
            <HolidaySummary report={data} />
          </div>
          <ReportOverview report={data} />
          <div className="week-nav">
            <button className="icon-button bordered" onClick={() => move(-1)} aria-label="上一周">
              <ArrowLeft />
            </button>
            <button className="icon-button bordered" onClick={() => move(1)} aria-label="下一周">
              <ArrowRight />
            </button>
          </div>
        </div>
        <WeekNavigator
          year={year}
          selectedWeek={week}
          current={current}
          weeks={reportWeeks.data!.weeks}
          onSelect={(target) =>
            navigate(target === current.week && year === current.year ? '/' : `/week/${year}/${target}`)
          }
        />
      </header>
      {!data.holidayDataAvailable && (
        <div className="notice">
          <AlertTriangle size={17} />
          <span>{year} 年节假日数据尚未导入，当前仅按普通周末显示。</span>
        </div>
      )}
      {addMutation.error && (
        <div className="page-action-error">添加条目失败：{addMutation.error.message}</div>
      )}
      {createProject.error && (
        <div className="page-action-error">新增项目失败：{createProject.error.message}</div>
      )}
      <div className="report-sections report-sections-focused">
        <ReportSection
          key={activeType}
          index={activeSection}
          type={activeType}
          items={data.items.filter((item) => item.type === activeType)}
          report={data}
          projects={projects.data!.projects}
          categories={categories.data!.categories}
          onAdd={(projectId, categoryId) => addMutation.mutate({ type: activeType, projectId, categoryId })}
          onCreateCategory={(name, assignments) => createCategory.mutateAsync({ name, assignments })}
          onCreateProject={(draft) => createProject.mutateAsync({ type: activeType, draft })}
          creatingProject={createProject.isPending}
          onPrevious={() => setActiveSection((index) => Math.max(0, index - 1))}
          onNext={() => setActiveSection((index) => Math.min(sections.length - 1, index + 1))}
          canPrevious={activeSection > 0}
          canNext={activeSection < sections.length - 1}
          onCopy={activeType === 'completed' ? copyReport : undefined}
          copied={copied}
        />
        {activeType === 'completed' && (
          <ReportSection
            type="other"
            items={data.items.filter((item) => item.type === 'other')}
            report={data}
            projects={projects.data!.projects}
            categories={categories.data!.categories}
            onAdd={(projectId, categoryId) => addMutation.mutate({ type: 'other', projectId, categoryId })}
            onCreateCategory={(name, assignments) => createCategory.mutateAsync({ name, assignments })}
            onCreateProject={(draft) => createProject.mutateAsync({ type: 'other', draft })}
            creatingProject={createProject.isPending}
            index={activeSection}
            onPrevious={() => undefined}
            onNext={() => undefined}
            canPrevious={false}
            canNext={false}
            copied={false}
            supplementary
          />
        )}
      </div>
    </div>
  );
}

export function buildReportText(report: WeeklyReport, projects: Project[], categories: ReportCategory[]) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const lines = [
    `第 ${report.weekNumber} 周工作汇报（${report.weekStart} 至 ${report.weekEnd}）`,
    `汇报人：${report.author.displayName}`,
    ''
  ];
  for (const type of copySections) {
    lines.push(`【${sectionLabels[type]}】`);
    const items = groupItemsByProjectAndCategory(
      report.items.filter((item) => item.type === type),
      projects,
      categories
    )
      .flatMap((group) => group.categoryGroups.flatMap((categoryGroup) => categoryGroup.items))
      .filter((item) => item.contentMd.trim());
    if (!items.length) lines.push('无');
    else
      items.forEach((item, index) => {
        const project = item.projectId ? projectNames.get(item.projectId) : null;
        const meta = [project, progressLabels[item.progress], item.note && `备注：${item.note}`]
          .filter(Boolean)
          .join(' · ');
        const summary =
          summarizeMarkdown(item.contentMd) || (item.contentMd.trim() ? '详见周报详情' : '暂无内容');
        const category = item.categoryId ? categoryNames.get(item.categoryId) : null;
        lines.push(`${index + 1}. [${category ?? '未分类'}] ${summary}${meta ? `（${meta}）` : ''}`);
      });
    lines.push('');
  }
  return lines.join('\n').trim();
}

function PageFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>{title}</h1>
        </div>
      </div>
      {children}
    </div>
  );
}

function HolidaySummary({ report }: { report: WeeklyReport }) {
  if (!report.calendarDays.length) return null;
  return (
    <div className="holiday-summary">
      {report.calendarDays.map((day) => (
        <span className={day.kind} key={day.date}>
          {formatDate(day.date)} · {day.kind === 'holiday' ? day.name : '调休上班'}
        </span>
      ))}
    </div>
  );
}

function WeekNavigator({
  year,
  selectedWeek,
  current,
  weeks,
  onSelect
}: {
  year: number;
  selectedWeek: number;
  current: { year: number; week: number };
  weeks: Array<{ weekNumber: number; itemCount: number }>;
  onSelect: (week: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const populated = new Set(weeks.map((item) => item.weekNumber));
  const total = weeksInIsoYear(year);
  return (
    <div className={`year-weeks${open ? ' open' : ''}`}>
      <button className="year-weeks-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>
          <CalendarDays size={14} />
          选择周次
        </span>
        <small>
          {year} · 共 {total} 周
        </small>
        <strong>第 {selectedWeek} 周</strong>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="year-weeks-panel">
          <div className="year-weeks-heading">
            <span>{year} 全年周次</span>
            <div className="week-legend">
              <span className="legend-current">本周</span>
              <span className="legend-selected">当前选择</span>
              <span className="legend-filled">有内容</span>
            </div>
          </div>
          <div className="week-grid">
            {Array.from({ length: total }, (_, index) => index + 1).map((number) => {
              const selected = number === selectedWeek;
              const isCurrent = year === current.year && number === current.week;
              const hasContent = populated.has(number);
              return (
                <button
                  key={number}
                  className={`week-number${hasContent ? ' has-report' : ' empty'}${isCurrent ? ' current' : ''}${selected ? ' selected' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    onSelect(number);
                  }}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={`第 ${number} 周${hasContent ? '，有周报内容' : '，暂无周报内容'}${isCurrent ? '，本周' : ''}`}
                >
                  {number}
                  {isCurrent && <i aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function groupItemsByProjectAndCategory(
  items: ReportItem[],
  projects: Project[],
  categories: ReportCategory[]
) {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const groups = new Map<string, ProjectItemGroup>();
  for (const item of items) {
    const project = item.projectId ? (projectById.get(item.projectId) ?? null) : null;
    const key = project?.id ?? 'unassigned';
    const group = groups.get(key) ?? { key, project, items: [], categoryGroups: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const categoryGroups = new Map<string, CategoryItemGroup>();
    for (const item of group.items) {
      const category = item.categoryId ? (categoryById.get(item.categoryId) ?? null) : null;
      const key = category?.id ?? 'uncategorized';
      const categoryGroup = categoryGroups.get(key) ?? { key, category, items: [] };
      categoryGroup.items.push(item);
      categoryGroups.set(key, categoryGroup);
    }
    group.categoryGroups = [...categoryGroups.values()].sort((left, right) => {
      if (!left.category) return 1;
      if (!right.category) return -1;
      return (
        left.category.position - right.category.position ||
        left.category.name.localeCompare(right.category.name)
      );
    });
  }
  return [...groups.values()];
}

export function lastActiveCategoryId(group: ProjectItemGroup) {
  for (let index = group.categoryGroups.length - 1; index >= 0; index -= 1) {
    const category = group.categoryGroups[index]?.category;
    if (category && !category.archivedAt) return category.id;
  }
  return null;
}

export function previousReportWeek(weekStart: string) {
  return isoWeekForDate(addDays(weekStart, -7));
}

export function reportProgressSummary(items: ReportItem[]) {
  const visibleItems = items.filter((item) => item.contentMd.trim());
  return {
    total: visibleItems.length,
    completed: visibleItems.filter((item) => item.progress === 'completed' || item.progress === 'answered')
      .length,
    inProgress: visibleItems.filter((item) => item.progress === 'incomplete').length,
    projectCount: new Set(visibleItems.map((item) => item.projectId).filter(Boolean)).size
  };
}

function ReportOverview({ report }: { report: WeeklyReport }) {
  const summary = reportProgressSummary(report.items);
  return (
    <section className="briefing-summary week-overview" aria-label="本周工作概览">
      <h2 className="visually-hidden">本周工作概览</h2>
      <dl className="briefing-metrics">
        <div>
          <dt>汇报事项</dt>
          <dd>{summary.total}</dd>
        </div>
        <div>
          <dt>已完成</dt>
          <dd>{summary.completed}</dd>
        </div>
        <div>
          <dt>推进中</dt>
          <dd>{summary.inProgress}</dd>
        </div>
        <div>
          <dt>涉及项目</dt>
          <dd>{summary.projectCount}</dd>
        </div>
      </dl>
    </section>
  );
}

function ReportSection({
  type,
  items,
  report,
  projects,
  categories,
  onAdd,
  onCreateCategory,
  onCreateProject,
  creatingProject,
  index,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  onCopy,
  copied,
  supplementary = false
}: {
  type: ReportItemType;
  items: ReportItem[];
  report: WeeklyReport;
  projects: Project[];
  categories: ReportCategory[];
  onAdd: (projectId: string | null, categoryId: string | null) => void;
  onCreateCategory: (name: string, assignments?: CategoryAssignment[]) => Promise<ReportCategory>;
  onCreateProject: (draft: ProjectDraft) => Promise<Project>;
  creatingProject: boolean;
  index: number;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  onCopy?: () => void;
  copied: boolean;
  supplementary?: boolean;
}) {
  const qc = useQueryClient();
  const [projectEditorOpen, setProjectEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({ name: '', color: projectColors[0] });
  const [projectError, setProjectError] = useState('');
  const groups = groupItemsByProjectAndCategory(items, projects, categories);
  const orderedItems = groups.flatMap((group) =>
    group.categoryGroups.flatMap((categoryGroup) => categoryGroup.items)
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const reorder = useMutation({
    mutationFn: (payload: {
      ids: string[];
      expectedReportVersion: number;
      move?: {
        itemId: string;
        projectId: string | null;
        categoryId: string | null;
        expectedVersion: number;
      };
    }) =>
      api<{ ok: boolean; movedItem: ReportItem | null; reportVersion: number }>(
        `/api/reports/${report.id}/reorder`,
        {
          method: 'POST',
          body: JSON.stringify({ type, ...payload })
        }
      ),
    onMutate: async (payload) => {
      const queryKey = ['report', report.weekYear, report.weekNumber] as const;
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<WeeklyReport>(queryKey);
      qc.setQueryData<WeeklyReport>(queryKey, (old) => {
        if (!old) return old;
        const byId = new Map(old.items.map((item) => [item.id, item]));
        const moved = payload.move;
        const reordered = payload.ids.map((id, position) => {
          const item = byId.get(id)!;
          return moved?.itemId === id
            ? { ...item, projectId: moved.projectId, categoryId: moved.categoryId, position }
            : { ...item, position };
        });
        const unaffected = old.items.filter((item) => item.type !== type);
        return { ...old, items: [...unaffected, ...reordered] };
      });
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous)
        qc.setQueryData(['report', report.weekYear, report.weekNumber], context.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData<WeeklyReport>(['report', report.weekYear, report.weekNumber], (old) =>
        old ? { ...old, version: data.reportVersion } : old
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['report', report.weekYear, report.weekNumber] })
  });
  const dragEnd = (event: DragEndEvent) => {
    if (!event.over || reorder.isPending) return;
    const activeItem = orderedItems.find((item) => item.id === event.active.id);
    if (!activeItem) return;
    const overItem = orderedItems.find((item) => item.id === event.over!.id);
    const target = event.over.data.current as
      { kind?: string; projectId?: string | null; categoryId?: string | null } | undefined;
    const targetProjectId =
      target && 'projectId' in target
        ? (target.projectId ?? null)
        : (overItem?.projectId ?? activeItem.projectId);
    const targetCategoryId =
      target?.kind === 'project'
        ? activeItem.categoryId
        : target && 'categoryId' in target
          ? (target.categoryId ?? null)
          : (overItem?.categoryId ?? activeItem.categoryId);
    const oldIndex = orderedItems.findIndex((item) => item.id === activeItem.id);
    let targetIndex = overItem ? orderedItems.findIndex((item) => item.id === overItem.id) : -1;
    if (targetIndex < 0) {
      let matching = orderedItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.projectId === targetProjectId && item.categoryId === targetCategoryId);
      if (!matching.length && target?.kind === 'project')
        matching = orderedItems
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.projectId === targetProjectId);
      const lastMatchingIndex = matching.at(-1)?.index;
      targetIndex = lastMatchingIndex ?? oldIndex;
      if (lastMatchingIndex !== undefined && oldIndex > lastMatchingIndex)
        targetIndex = lastMatchingIndex + 1;
    }
    const changedContainer =
      activeItem.projectId !== targetProjectId || activeItem.categoryId !== targetCategoryId;
    if (!changedContainer && oldIndex === targetIndex) return;
    const nextItems = arrayMove(orderedItems, oldIndex, targetIndex);
    const currentReportVersion =
      qc.getQueryData<WeeklyReport>(['report', report.weekYear, report.weekNumber])?.version ??
      report.version;
    reorder.mutate({
      ids: nextItems.map((item) => item.id),
      expectedReportVersion: currentReportVersion,
      move: changedContainer
        ? {
            itemId: activeItem.id,
            projectId: targetProjectId,
            categoryId: targetCategoryId,
            expectedVersion: activeItem.version
          }
        : undefined
    });
  };
  const openProjectEditor = () => {
    setProjectDraft({ name: '', color: projectColors[projects.length % projectColors.length] });
    setProjectError('');
    setProjectEditorOpen(true);
  };
  const submitProject = async () => {
    const name = projectDraft.name.trim();
    if (!name) return setProjectError('请输入项目名称');
    setProjectError('');
    try {
      await onCreateProject({ ...projectDraft, name });
      setProjectEditorOpen(false);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '新增项目失败');
    }
  };
  return (
    <>
      <section
        className={`report-section project-table-section${supplementary ? ' report-section-supplementary' : ''}`}
        style={{ '--section-index': index } as React.CSSProperties}
      >
        <div className="section-heading">
          <div>
            <span className={`section-index section-${type}`}>
              {supplementary ? '附' : String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <div className="section-title-line">
                <h2>{sectionLabels[type]}</h2>
                {!supplementary && (
                  <nav className="section-switcher" aria-label="切换周报分类">
                    <button onClick={onPrevious} disabled={!canPrevious} aria-label="上一个分类">
                      <ArrowLeft size={14} />
                    </button>
                    <span>
                      {index + 1} / {sections.length}
                    </span>
                    <button onClick={onNext} disabled={!canNext} aria-label="下一个分类">
                      <ArrowRight size={14} />
                    </button>
                  </nav>
                )}
              </div>
              <p>{sectionHints[type]}</p>
            </div>
          </div>
          <div className="section-heading-actions">
            {onCopy && (
              <button className="button secondary compact-button" onClick={onCopy}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? '已复制' : '复制汇报'}
              </button>
            )}
            <button className="button ghost" onClick={openProjectEditor}>
              <Plus size={17} />
              新增项目
            </button>
          </div>
        </div>
        {reorder.error && <div className="page-action-error">排序保存失败：{reorder.error.message}</div>}
        {items.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
            <SortableContext
              items={orderedItems.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="project-report-groups">
                {groups.map((group) => (
                  <ProjectReportGroup
                    key={group.key}
                    group={group}
                    report={report}
                    projects={projects}
                    categories={categories}
                    type={type}
                    onAdd={(categoryId) => onAdd(group.project?.id ?? null, categoryId)}
                    onCreateCategory={onCreateCategory}
                    onImport={() => setImportOpen(true)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <button className="section-empty" onClick={() => onAdd(null, null)}>
            <Plus size={18} />
            <span>添加一条{sectionLabels[type]}</span>
          </button>
        )}
      </section>
      <Modal
        open={projectEditorOpen}
        onOpenChange={(open) => !creatingProject && setProjectEditorOpen(open)}
        title="新增项目"
        description="创建项目后，会在当前栏目生成第一条空白周报。"
      >
        <form
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitProject();
          }}
        >
          <label>
            项目名称
            <input
              autoFocus
              value={projectDraft.name}
              onChange={(event) => setProjectDraft((draft) => ({ ...draft, name: event.target.value }))}
              maxLength={80}
              required
            />
          </label>
          <fieldset>
            <legend>标识颜色</legend>
            <div className="color-picker">
              {projectColors.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={projectDraft.color === color ? 'selected' : ''}
                  style={{ background: color }}
                  onClick={() => setProjectDraft((draft) => ({ ...draft, color }))}
                  aria-label={`选择颜色 ${color}`}
                />
              ))}
            </div>
          </fieldset>
          {projectError && <div className="form-error">{projectError}</div>}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setProjectEditorOpen(false)}
              disabled={creatingProject}
            >
              取消
            </button>
            <button className="button" disabled={creatingProject}>
              {creatingProject ? '创建中…' : '创建项目'}
            </button>
          </div>
        </form>
      </Modal>
      <ImportPreviousItemsModal
        open={importOpen}
        onOpenChange={setImportOpen}
        report={report}
        projects={projects}
        categories={categories}
      />
    </>
  );
}

function ProjectReportGroup({
  group,
  report,
  projects,
  categories,
  type,
  onAdd,
  onCreateCategory,
  onImport
}: {
  group: ProjectItemGroup;
  report: WeeklyReport;
  projects: Project[];
  categories: ReportCategory[];
  type: ReportItemType;
  onAdd: (categoryId: string | null) => void;
  onCreateCategory: (name: string, assignments?: CategoryAssignment[]) => Promise<ReportCategory>;
  onImport: () => void;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [projectName, setProjectName] = useState(group.project?.name ?? '');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryError, setNewCategoryError] = useState('');
  const projectArchived = Boolean(group.project?.archivedAt);
  const projectDrop = useDroppable({
    id: `project-drop:${group.key}`,
    data: { kind: 'project', projectId: group.project?.id ?? null },
    disabled: projectArchived
  });
  useEffect(() => setProjectName(group.project?.name ?? ''), [group.project?.id, group.project?.name]);
  const saveProjectName = useMutation({
    mutationFn: async (name: string) => {
      if (group.project) {
        await api(`/api/projects/${group.project.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        return;
      }
      await api<{ project: Project; items: ReportItem[]; reportVersion: number }>(
        `/api/reports/${report.weekYear}/${report.weekNumber}/projects`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            color: projectColors[projects.length % projectColors.length],
            type,
            assignments: group.items.map((item) => ({
              itemId: item.id,
              expectedVersion: item.version
            }))
          })
        }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['report', report.weekYear, report.weekNumber] });
    }
  });
  const createProjectCategory = useMutation({
    mutationFn: (name: string) => {
      if (!report.id) throw new Error('请先创建周报');
      return api<{ category: ReportCategory; item: ReportItem }>(`/api/reports/${report.id}/categories`, {
        method: 'POST',
        body: JSON.stringify({ name, projectId: group.project?.id ?? null, type })
      });
    },
    onSuccess: () => {
      setAddingCategory(false);
      setNewCategoryName('');
      setNewCategoryError('');
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['report', report.weekYear, report.weekNumber] });
      qc.invalidateQueries({ queryKey: ['report-weeks', report.weekYear] });
    }
  });
  const finishRename = () => {
    const name = projectName.trim();
    setRenaming(false);
    if (name && name !== group.project?.name) saveProjectName.mutate(name);
    else setProjectName(group.project?.name ?? '');
  };
  const finishNewCategory = () => {
    if (createProjectCategory.isPending) return;
    const name = newCategoryName.trim();
    if (!name) {
      setNewCategoryError('请输入分类名称');
      return;
    }
    setNewCategoryError('');
    createProjectCategory.mutate(name);
  };
  const cancelNewCategory = () => {
    setAddingCategory(false);
    setNewCategoryName('');
    setNewCategoryError('');
    createProjectCategory.reset();
  };
  const sequenceById = new Map(
    group.categoryGroups
      .flatMap((categoryGroup) => categoryGroup.items)
      .map((item, index) => [item.id, index + 1])
  );
  const defaultCategoryId = lastActiveCategoryId(group);
  return (
    <section className={`project-report-group${projectDrop.isOver ? ' project-drop-active' : ''}`}>
      <div className="project-group-label" ref={projectDrop.setNodeRef}>
        <i style={{ background: group.project?.color ?? '#98A2B3' }} />
        <div className="project-name-control">
          {renaming ? (
            <input
              autoFocus
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onBlur={finishRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setProjectName(group.project?.name ?? '');
                  setRenaming(false);
                }
              }}
              placeholder="输入项目名"
              aria-label="编辑项目名称"
            />
          ) : group.project ? (
            <button
              className="project-name-display"
              onDoubleClick={() => setRenaming(true)}
              title="双击修改项目名称"
            >
              {group.project.name}
            </button>
          ) : (
            <button
              className="project-name-display"
              onDoubleClick={() => setRenaming(true)}
              title="双击创建项目"
            >
              未归属
            </button>
          )}
        </div>
        <span>{group.items.length} 条</span>
        {projectArchived && <small>已停用</small>}
      </div>
      {saveProjectName.error && (
        <div className="page-action-error">项目名称保存失败：{saveProjectName.error.message}</div>
      )}
      <div className="project-group-rows">
        {group.categoryGroups.map((categoryGroup) => (
          <CategoryReportGroup
            key={categoryGroup.key}
            group={categoryGroup}
            projectId={group.project?.id ?? null}
            report={report}
            projects={projects}
            categories={categories}
            sequenceById={sequenceById}
            onCreateCategory={onCreateCategory}
            onImport={onImport}
            projectArchived={projectArchived}
          />
        ))}
        {!projectArchived && (
          <div className="project-add-row">
            <div className={`project-category-add${addingCategory ? ' editing' : ''}`}>
              {addingCategory ? (
                <>
                  <input
                    autoFocus
                    value={newCategoryName}
                    onChange={(event) => setNewCategoryName(event.target.value)}
                    onBlur={finishNewCategory}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') cancelNewCategory();
                    }}
                    maxLength={40}
                    placeholder="分类名称"
                    aria-label={`为${group.project?.name ?? '未归属'}新增分类`}
                    disabled={createProjectCategory.isPending}
                  />
                  {(newCategoryError || createProjectCategory.error) && (
                    <small>{newCategoryError || createProjectCategory.error?.message}</small>
                  )}
                </>
              ) : (
                <button
                  onClick={() => {
                    createProjectCategory.reset();
                    setNewCategoryError('');
                    setAddingCategory(true);
                  }}
                >
                  <Plus size={12} />
                  新增分类
                </button>
              )}
            </div>
            <button className="project-row-add" onClick={() => onAdd(defaultCategoryId)}>
              <Plus size={13} />
              添加一条
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryReportGroup({
  group,
  projectId,
  report,
  projects,
  categories,
  sequenceById,
  onCreateCategory,
  onImport,
  projectArchived
}: {
  group: CategoryItemGroup;
  projectId: string | null;
  report: WeeklyReport;
  projects: Project[];
  categories: ReportCategory[];
  sequenceById: Map<string, number>;
  onCreateCategory: (name: string, assignments?: CategoryAssignment[]) => Promise<ReportCategory>;
  onImport: () => void;
  projectArchived: boolean;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [categoryName, setCategoryName] = useState(group.category?.name ?? '');
  const [categoryError, setCategoryError] = useState('');
  const drop = useDroppable({
    id: `category-drop:${projectId ?? 'unassigned'}:${group.key}`,
    data: { kind: 'category', projectId, categoryId: group.category?.id ?? null },
    disabled: projectArchived
  });
  useEffect(() => {
    if (!renaming) setCategoryName(group.category?.name ?? '');
  }, [group.category?.id, group.category?.name, renaming]);
  const saveCategory = useMutation({
    mutationFn: (name: string) =>
      group.category
        ? api<ReportCategory>(`/api/categories/${group.category.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name })
          })
        : onCreateCategory(
            name,
            group.items.map((item) => ({ itemId: item.id, expectedVersion: item.version }))
          ),
    onSuccess: () => {
      setRenaming(false);
      setCategoryError('');
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['report', report.weekYear, report.weekNumber] });
    }
  });
  const finishCategoryRename = () => {
    if (saveCategory.isPending) return;
    const name = categoryName.trim();
    if (!name) {
      setCategoryError('请输入分类名称');
      return;
    }
    if (group.category && name === group.category.name) {
      setRenaming(false);
      setCategoryError('');
      return;
    }
    setCategoryError('');
    saveCategory.mutate(name);
  };
  const cancelCategoryRename = () => {
    setCategoryName(group.category?.name ?? '');
    setCategoryError('');
    saveCategory.reset();
    setRenaming(false);
  };
  return (
    <section
      ref={drop.setNodeRef}
      className={`category-report-group${drop.isOver ? ' category-drop-active' : ''}`}
    >
      <div
        className={`category-group-label${renaming ? ' category-label-editing' : ''}`}
        onDoubleClick={() => {
          if (saveCategory.isPending) return;
          saveCategory.reset();
          setCategoryError('');
          setRenaming(true);
        }}
        title="双击编辑分类"
      >
        {renaming ? (
          <input
            className="category-name-input"
            autoFocus
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
            onBlur={finishCategoryRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') cancelCategoryRename();
            }}
            maxLength={40}
            placeholder="分类名称"
            aria-label={group.category ? `编辑分类 ${group.category.name}` : '为未分类条目创建分类'}
            disabled={saveCategory.isPending}
          />
        ) : (
          <strong>{group.category?.name ?? '未分类'}</strong>
        )}
        {group.category?.archivedAt && <small>已停用</small>}
        <span>{group.items.length} 条</span>
        {(categoryError || saveCategory.error) && (
          <small className="category-edit-error">
            {categoryError || saveCategory.error?.message || '分类保存失败'}
          </small>
        )}
      </div>
      <div className="category-group-rows">
        {group.items.map((item) => (
          <ReportItemRow
            key={item.id}
            item={item}
            sequence={sequenceById.get(item.id) ?? 1}
            report={report}
            projects={projects}
            categories={categories}
            onCreateCategory={onCreateCategory}
            onImport={onImport}
          />
        ))}
      </div>
    </section>
  );
}

function CategoryCreateModal({
  open,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setError('');
    }
  }, [open]);
  const submit = async () => {
    const value = name.trim();
    if (!value) return setError('请输入分类名称');
    setPending(true);
    setError('');
    try {
      await onCreate(value);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '分类创建失败');
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={(value) => !pending && onOpenChange(value)}
      title="新建条目分类"
      description="分类会在当前工作区的所有项目和周报中复用。"
    >
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          分类名称
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            placeholder="例如：开发、运维"
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={() => onOpenChange(false)}>
            取消
          </button>
          <button className="button" disabled={pending}>
            {pending ? '创建中…' : '创建并使用'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportPreviousItemsModal({
  open,
  onOpenChange,
  report,
  projects,
  categories
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: WeeklyReport;
  projects: Project[];
  categories: ReportCategory[];
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const sourceWeek = previousReportWeek(report.weekStart);
  const previous = useQuery({
    queryKey: ['report', sourceWeek.year, sourceWeek.week],
    queryFn: () => api<WeeklyReport>(`/api/reports/${sourceWeek.year}/${sourceWeek.week}`),
    enabled: open
  });
  const candidates = (previous.data?.items ?? []).filter(
    (item) => item.progress === 'incomplete' && item.contentMd.trim()
  );
  const importedIds = new Set(
    report.items.map((item) => item.importedFromItemId).filter((value): value is string => Boolean(value))
  );
  const availableIds = candidates.filter((item) => !importedIds.has(item.id)).map((item) => item.id);
  const groups = groupItemsByProjectAndCategory(candidates, projects, categories);
  useEffect(() => {
    if (!open) setSelected([]);
  }, [open]);
  useEffect(() => {
    setSelected((current) => current.filter((itemId) => availableIds.includes(itemId)));
  }, [availableIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const importItems = useMutation({
    mutationFn: () =>
      api<{ items: ReportItem[] }>(`/api/reports/${report.weekYear}/${report.weekNumber}/import-items`, {
        method: 'POST',
        body: JSON.stringify({
          sources: selected.map((itemId) => ({
            itemId,
            expectedVersion: candidates.find((item) => item.id === itemId)!.version
          }))
        })
      }),
    onSuccess: () => {
      setSelected([]);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ['report', report.weekYear, report.weekNumber] });
      qc.invalidateQueries({ queryKey: ['report-weeks', report.weekYear] });
    }
  });
  const allSelected = availableIds.length > 0 && availableIds.every((itemId) => selected.includes(itemId));
  return (
    <Modal
      open={open}
      onOpenChange={(value) => !importItems.isPending && onOpenChange(value)}
      title="引入上周任务"
      description={`选择 ${sourceWeek.year} 年第 ${sourceWeek.week} 周仍在推进的任务，复制到本周继续跟进。`}
      wide
    >
      <div className="import-task-toolbar">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!availableIds.length || importItems.isPending}
            onChange={(event) => setSelected(event.target.checked ? availableIds : [])}
          />
          全选可引入任务
        </label>
        <span>
          已选择 {selected.length} / {availableIds.length} 条
        </span>
      </div>
      <div className="import-task-list">
        {previous.isLoading ? (
          <Loading />
        ) : previous.error ? (
          <ErrorState message={previous.error.message} onRetry={() => previous.refetch()} />
        ) : !candidates.length ? (
          <div className="import-task-empty">上周没有可引入的推进中任务</div>
        ) : (
          groups.map((projectGroup) => (
            <section className="import-project-group" key={projectGroup.key}>
              <div className="import-project-heading">
                <i style={{ background: projectGroup.project?.color ?? '#98A2B3' }} />
                <strong>{projectGroup.project?.name ?? '未归属'}</strong>
              </div>
              {projectGroup.categoryGroups.map((categoryGroup) => (
                <div className="import-category-group" key={categoryGroup.key}>
                  <div className="import-category-heading">
                    {categoryGroup.category?.name ?? '未分类'}
                    {categoryGroup.category?.archivedAt && <small>已停用</small>}
                  </div>
                  <div className="import-category-items">
                    {categoryGroup.items.map((item) => {
                      const imported = importedIds.has(item.id);
                      const checked = selected.includes(item.id);
                      return (
                        <label className={`import-task-option${imported ? ' imported' : ''}`} key={item.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={imported || importItems.isPending}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, item.id]
                                  : current.filter((itemId) => itemId !== item.id)
                              )
                            }
                          />
                          <span className="import-task-content">{summarizeMarkdown(item.contentMd)}</span>
                          <span className={`import-section-badge section-${item.type}`}>
                            {sectionLabels[item.type]}
                          </span>
                          <span className="import-task-status">{imported ? '已引入' : '推进中'}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
      {importItems.error && (
        <div className="form-error" role="alert">
          引入失败：{importItems.error.message}
        </div>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => onOpenChange(false)}
          disabled={importItems.isPending}
        >
          取消
        </button>
        <button
          type="button"
          className="button"
          onClick={() => importItems.mutate()}
          disabled={!selected.length || importItems.isPending}
        >
          {importItems.isPending ? '引入中…' : `引入 ${selected.length} 条`}
        </button>
      </div>
    </Modal>
  );
}

function summarizeMarkdown(content: string) {
  return stripMarkdownImages(content)
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type Attachment = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};
function ReportItemRow({
  item,
  report,
  sequence,
  projects,
  categories,
  onCreateCategory,
  onImport
}: {
  item: ReportItem;
  report: WeeklyReport;
  sequence: number;
  projects: Project[];
  categories: ReportCategory[];
  onCreateCategory: (name: string, assignments?: CategoryAssignment[]) => Promise<ReportCategory>;
  onImport: () => void;
}) {
  const qc = useQueryClient();
  const [initialMeta] = useState(() => readInitialItemMeta(item));
  const [content, setContent] = useState(item.contentMd);
  const [itemMeta, setItemMeta] = useState<ItemMeta>(initialMeta.meta);
  const [projectId, setProjectId] = useState(item.projectId ?? '');
  const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
  const [itemType, setItemType] = useState<ReportItemType>(item.type);
  const [occurredOn, setOccurredOn] = useState(item.occurredOn ?? '');
  const [tagIds, setTagIds] = useState(item.tags.map((tag) => tag.id));
  const [inlineEditing, setInlineEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; alt: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [categoryCreatorOpen, setCategoryCreatorOpen] = useState(false);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error' | 'conflict'>('saved');
  const [conflictCurrent, setConflictCurrent] = useState<ReportItem | null>(null);
  const version = useRef(item.version);
  const draftRevision = useRef(0);
  const acknowledgedRevision = useRef(0);
  const mounted = useRef(true);
  const initial = useRef(!initialMeta.legacy);
  const skipNextSave = useRef(false);
  const clickTimer = useRef<number | undefined>(undefined);
  const deferredSave = useRef(createDeferredAction()).current;
  const saveTaskHandler = useRef<(task: ItemSaveTask) => Promise<void>>(async () => undefined);
  const saveQueue = useRef(
    createLatestTaskQueue((task: ItemSaveTask) => saveTaskHandler.current(task))
  ).current;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestDraft = useRef<ItemDraft>({
    contentMd: content,
    progress: itemMeta.progress,
    note: itemMeta.note,
    projectId: projectId || null,
    categoryId: categoryId || null,
    type: itemType,
    occurredOn: occurredOn || null,
    tagIds
  });
  latestDraft.current = {
    contentMd: content,
    progress: itemMeta.progress,
    note: itemMeta.note,
    projectId: projectId || null,
    categoryId: categoryId || null,
    type: itemType,
    occurredOn: occurredOn || null,
    tagIds
  };
  const sortable = useSortable({
    id: item.id,
    data: {
      kind: 'item',
      projectId: item.projectId,
      categoryId: item.categoryId
    }
  });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  useEffect(() => {
    if (
      draftRevision.current > acknowledgedRevision.current ||
      saveQueue.isBusy() ||
      deferredSave.hasPending()
    ) {
      return;
    }
    setContent(item.contentMd);
    setItemMeta({ progress: item.progress, note: item.note });
    setProjectId(item.projectId ?? '');
    setCategoryId(item.categoryId ?? '');
    setItemType(item.type);
    setOccurredOn(item.occurredOn ?? '');
    setTagIds(item.tags.map((tag) => tag.id));
    version.current = item.version;
  }, [
    item.contentMd,
    item.categoryId,
    item.id,
    item.note,
    item.occurredOn,
    item.progress,
    item.projectId,
    item.tags,
    item.type,
    item.version,
    deferredSave,
    saveQueue
  ]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(clickTimer.current);
      deferredSave.flush();
    };
  }, [deferredSave]);
  saveTaskHandler.current = async (task) => {
    try {
      const data = await api<ReportItem & { reportVersion: number }>(`/api/report-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...task.draft, expectedVersion: version.current })
      });
      const { reportVersion, ...savedItem } = data;
      version.current = savedItem.version;
      acknowledgedRevision.current = Math.max(acknowledgedRevision.current, task.revision);
      if (mounted.current) {
        setConflictCurrent(null);
        setStatus(draftRevision.current > task.revision ? 'saving' : 'saved');
      }
      localStorage.removeItem(`weekly-notes:item-meta:${item.id}`);
      qc.setQueryData<WeeklyReport>(['report', report.weekYear, report.weekNumber], (old) =>
        old
          ? {
              ...old,
              version: reportVersion,
              items: old.items.map((existing) => (existing.id === savedItem.id ? savedItem : existing))
            }
          : old
      );
      qc.invalidateQueries({ queryKey: ['report-weeks', report.weekYear] });
    } catch (error) {
      deferredSave.cancel();
      saveQueue.clearPending();
      if (mounted.current) {
        if (error instanceof ApiError && error.status === 409 && error.data?.current) {
          setConflictCurrent(error.data.current as ReportItem);
          setStatus('conflict');
        } else setStatus('error');
      }
      throw error;
    }
  };
  const enqueueLatestDraft = () => {
    if (mounted.current) setStatus('saving');
    saveQueue.enqueue({ revision: draftRevision.current, draft: { ...latestDraft.current } });
  };
  const tagKey = tagIds.join(',');
  // The mutation intentionally saves the latest controlled draft after a debounce.
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (skipNextSave.current) {
      skipNextSave.current = false;
      deferredSave.cancel();
      return;
    }
    draftRevision.current += 1;
    setStatus('saving');
    deferredSave.schedule(enqueueLatestDraft, 800);
  }, [content, itemMeta.progress, itemMeta.note, projectId, categoryId, itemType, occurredOn, tagKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== 'saving') return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [status]);
  const attachments = useQuery({
    queryKey: ['attachments', item.id],
    queryFn: () => api<{ attachments: Attachment[] }>(`/api/report-items/${item.id}/attachments`),
    enabled: detailsOpen
  });
  const upload = useMutation({
    mutationFn: async ({ file }: { file: File; insertAt: number }) => {
      const form = new FormData();
      form.append('image', file);
      return api<{ id: string; originalName: string; url: string }>(`/api/report-items/${item.id}/images`, {
        method: 'POST',
        body: form
      });
    },
    onSuccess: (data, { file, insertAt }) => {
      qc.invalidateQueries({ queryKey: ['attachments', item.id] });
      const alt =
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[[\]\\]/g, ' ')
          .trim() || '图片';
      let nextCursor = insertAt;
      setContent((current) => {
        const point = Math.min(insertAt, current.length);
        const before = current.slice(0, point);
        const after = current.slice(point);
        const leading = before && !before.endsWith('\n') ? '\n\n' : '';
        const trailing = after && !after.startsWith('\n') ? '\n\n' : '\n';
        const markdown = `${leading}![${alt}](${data.url})${trailing}`;
        nextCursor = point + markdown.length;
        return before + markdown + after;
      });
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    }
  });
  const removeAttachment = useMutation({
    mutationFn: (id: string) => api(`/api/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', item.id] })
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/report-items/${item.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      localStorage.removeItem(`weekly-notes:item-meta:${item.id}`);
      qc.setQueryData<WeeklyReport>(['report', report.weekYear, report.weekNumber], (old) =>
        old
          ? {
              ...old,
              version: old.version + 1,
              items: old.items.filter((existing) => existing.id !== item.id)
            }
          : old
      );
      qc.invalidateQueries({ queryKey: ['report-weeks', report.weekYear] });
    }
  });
  const singleClick = () => {
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => setInlineEditing(true), 210);
  };
  const doubleClick = () => {
    window.clearTimeout(clickTimer.current);
    setInlineEditing(false);
    setDetailEditing(false);
    setDetailsOpen(true);
  };
  const displayContent = summarizeMarkdown(content) || (content.trim() ? '点击打开详情' : '点击填写内容');

  return (
    <article
      ref={sortable.setNodeRef}
      style={style}
      className={`report-table-row${sortable.isDragging ? ' item-dragging' : ''} ${status === 'conflict' ? 'item-conflict' : ''} ${status === 'error' ? 'item-save-error' : ''}`}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) deferredSave.flush();
      }}
    >
      <div className="report-row-main">
        <button
          className="row-sequence"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`第 ${sequence} 条，拖动排序`}
        >
          <span>{sequence}</span>
          <GripVertical size={12} />
        </button>
        <div className="row-content-cell">
          {inlineEditing ? (
            <textarea
              ref={textareaRef}
              autoFocus
              value={content}
              rows={1}
              onChange={(event) => setContent(event.target.value)}
              onBlur={() => setInlineEditing(false)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setContent(item.contentMd);
                  setInlineEditing(false);
                }
              }}
              aria-label={`${sectionLabels[item.type]}第 ${sequence} 条内容`}
            />
          ) : (
            <button
              className={`row-content-preview${content ? '' : ' placeholder'}`}
              onClick={singleClick}
              onDoubleClick={doubleClick}
            >
              <span className="row-content-text">
                <span>{displayContent}</span>
              </span>
              {hasMarkdownImage(content) && (
                <span className="row-image-indicator" role="img" aria-label="包含图片" title="包含图片">
                  <ImageIcon size={14} />
                </span>
              )}
            </button>
          )}
        </div>
        <label className={`item-progress-cell progress-${itemMeta.progress}`}>
          <span className="visually-hidden">进度</span>
          <select
            value={itemMeta.progress}
            onChange={(event) =>
              setItemMeta((value) => ({ ...value, progress: event.target.value as ReportItemProgress }))
            }
            aria-label={`第 ${sequence} 条进度`}
          >
            {Object.entries(progressLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="item-note-cell">
          <span className="visually-hidden">备注</span>
          <input
            value={itemMeta.note}
            onChange={(event) => setItemMeta((value) => ({ ...value, note: event.target.value }))}
            placeholder="添加备注"
            aria-label={`第 ${sequence} 条备注`}
          />
        </label>
        <div className="row-actions">
          {(status === 'error' || status === 'conflict') && (
            <span className={`save-status ${status}`}>{status === 'conflict' ? '冲突' : '保存失败'}</span>
          )}
          <button
            className="icon-button import-item"
            onClick={onImport}
            aria-label="引入上周任务"
            title="从上周引入任务"
          >
            <Download size={15} />
          </button>
          <button
            className="icon-button danger"
            onClick={() => {
              remove.reset();
              setDeleteOpen(true);
            }}
            aria-label="删除"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {status === 'conflict' && (
        <div className="conflict-bar">
          <span>服务器上的内容已经变化，当前编辑未覆盖。</span>
          <button
            onClick={() => {
              if (!conflictCurrent) return;
              deferredSave.cancel();
              saveQueue.clearPending();
              skipNextSave.current = true;
              version.current = conflictCurrent.version;
              acknowledgedRevision.current = draftRevision.current;
              setContent(conflictCurrent.contentMd);
              setItemMeta({ progress: conflictCurrent.progress, note: conflictCurrent.note });
              setProjectId(conflictCurrent.projectId ?? '');
              setCategoryId(conflictCurrent.categoryId ?? '');
              setItemType(conflictCurrent.type);
              setOccurredOn(conflictCurrent.occurredOn ?? '');
              setTagIds(conflictCurrent.tags.map((tag) => tag.id));
              setConflictCurrent(null);
              setStatus('saved');
              qc.setQueryData<WeeklyReport>(['report', report.weekYear, report.weekNumber], (old) =>
                old
                  ? {
                      ...old,
                      items: old.items.map((existing) =>
                        existing.id === conflictCurrent.id ? conflictCurrent : existing
                      )
                    }
                  : old
              );
            }}
          >
            载入最新内容
          </button>
          <button
            onClick={() => {
              if (conflictCurrent) version.current = conflictCurrent.version;
              setConflictCurrent(null);
              enqueueLatestDraft();
            }}
          >
            重新应用本地修改
          </button>
        </div>
      )}
      <Modal
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) {
            setDetailEditing(false);
            setFullscreenImage(null);
          }
        }}
        title={`周报详情 · 第 ${sequence} 条`}
        description={
          detailEditing
            ? '直接修改 Markdown；图片会插入当前光标位置。'
            : '完整预览周报内容，点击编辑按钮可原地修改 Markdown。'
        }
        wide
      >
        <div className="report-detail-editor markdown-only-editor">
          <div className="detail-editor-status">
            <span className={`save-status ${status}`}>
              {status === 'saving'
                ? '保存中'
                : status === 'saved'
                  ? '已保存'
                  : status === 'conflict'
                    ? '内容有冲突'
                    : '保存失败'}
            </span>
            <div className="detail-edit-actions">
              {detailEditing && (
                <div className="detail-tools">
                  <input
                    ref={fileInputRef}
                    className="visually-hidden"
                    type="file"
                    tabIndex={-1}
                    aria-hidden="true"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        upload.mutate({
                          file,
                          insertAt: textareaRef.current?.selectionStart ?? content.length
                        });
                      event.currentTarget.value = '';
                    }}
                  />
                  <button
                    className="button secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={upload.isPending}
                  >
                    {upload.isPending ? <RefreshCcw size={15} className="spin" /> : <ImagePlus size={15} />}
                    添加图片
                  </button>
                  <span>PNG / JPEG / GIF / WebP，最大 8 MB</span>
                  {upload.error && <strong>{upload.error.message}</strong>}
                </div>
              )}
              <button
                className={`button ${detailEditing ? 'secondary' : ''}`}
                onClick={() => setDetailEditing((value) => !value)}
              >
                <Pencil size={15} />
                {detailEditing ? '完成编辑' : '编辑 Markdown'}
              </button>
            </div>
          </div>
          {detailEditing && (
            <div className="report-item-fields">
              <label>
                所属项目
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">未归属项目</option>
                  {projects
                    .filter((project) => !project.archivedAt || project.id === projectId)
                    .map((project) => (
                      <option value={project.id} key={project.id} disabled={Boolean(project.archivedAt)}>
                        {project.name}
                        {project.archivedAt ? '（已停用）' : ''}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                条目分类
                <select
                  value={categoryId}
                  onChange={(event) => {
                    if (event.target.value === '__create__') setCategoryCreatorOpen(true);
                    else setCategoryId(event.target.value);
                  }}
                >
                  <option value="">未分类</option>
                  {categories
                    .filter((category) => !category.archivedAt || category.id === categoryId)
                    .map((category) => (
                      <option value={category.id} key={category.id}>
                        {category.name}
                        {category.archivedAt ? '（已停用）' : ''}
                      </option>
                    ))}
                  <option value="__create__">＋ 新建分类…</option>
                </select>
              </label>
              <label>
                内容类型
                <select
                  value={itemType}
                  onChange={(event) => setItemType(event.target.value as ReportItemType)}
                >
                  {Object.entries(sectionLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                发生日期
                <input
                  type="date"
                  value={occurredOn}
                  onChange={(event) => setOccurredOn(event.target.value)}
                />
              </label>
              <div className="report-tags-field">
                <span>标签</span>
                <TagField value={tagIds} onChange={setTagIds} />
              </div>
            </div>
          )}
          {detailEditing ? (
            <div className="markdown-editor-pane markdown-editor-single">
              <span>MARKDOWN</span>
              <textarea
                ref={textareaRef}
                autoFocus
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={16}
                placeholder="写下一件值得回看的事……"
                aria-label="Markdown 内容"
              />
            </div>
          ) : (
            <div
              className="detail-preview detail-preview-only"
              onDoubleClick={(event) => {
                if (!(event.target instanceof HTMLImageElement)) return;
                setFullscreenImage({
                  src: event.target.currentSrc || event.target.src,
                  alt: event.target.alt || '周报图片'
                });
              }}
            >
              <Markdown content={content} sizeImages />
            </div>
          )}
          <div className="attachment-panel">
            <div className="attachment-panel-heading">
              <strong>附件</strong>
              <span>{attachments.data?.attachments.length ?? 0} 个文件</span>
            </div>
            {attachments.isLoading ? (
              <small>正在读取附件…</small>
            ) : attachments.error ? (
              <small className="form-error">附件读取失败：{attachments.error.message}</small>
            ) : attachments.data?.attachments.length ? (
              <div className="attachment-list">
                {attachments.data.attachments.map((attachment) => (
                  <div key={attachment.id}>
                    <a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer">
                      {attachment.originalName}
                    </a>
                    <span>{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</span>
                    {attachmentImageWidth(content, attachment.id) !== null ? (
                      <label className="attachment-size-control">
                        <span>宽度 {attachmentImageWidth(content, attachment.id)}%</span>
                        <input
                          type="range"
                          min="25"
                          max="100"
                          step="5"
                          value={attachmentImageWidth(content, attachment.id) ?? 70}
                          onChange={(event) =>
                            setContent((current) =>
                              setAttachmentImageWidth(current, attachment.id, Number(event.target.value))
                            )
                          }
                          aria-label={`调整图片 ${attachment.originalName} 的显示宽度`}
                        />
                      </label>
                    ) : (
                      <span className="attachment-unlinked">未插入正文</span>
                    )}
                    <button
                      className="icon-button danger"
                      aria-label={`删除附件 ${attachment.originalName}`}
                      disabled={removeAttachment.isPending}
                      onClick={() => removeAttachment.mutate(attachment.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <small>暂无附件。进入编辑模式可以添加图片。</small>
            )}
            {removeAttachment.error && (
              <div className="form-error">删除附件失败：{removeAttachment.error.message}</div>
            )}
          </div>
        </div>
      </Modal>
      <CategoryCreateModal
        open={categoryCreatorOpen}
        onOpenChange={setCategoryCreatorOpen}
        onCreate={async (name) => {
          const category = await onCreateCategory(name);
          setCategoryId(category.id);
        }}
      />
      <Modal
        open={Boolean(fullscreenImage)}
        onOpenChange={(open) => {
          if (!open) setFullscreenImage(null);
        }}
        title={fullscreenImage?.alt || '图片预览'}
        description="按 Esc 或右上角关闭全屏预览。"
        fullscreen
      >
        <div className="image-lightbox">
          {fullscreenImage && <img src={fullscreenImage.src} alt={fullscreenImage.alt} />}
        </div>
      </Modal>
      <Modal
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!remove.isPending) setDeleteOpen(open);
        }}
        title="删除周报条目"
        description="删除后无法恢复，请确认这条内容不再需要。"
      >
        <div className="delete-confirmation">
          <div className="delete-confirmation-icon">
            <Trash2 size={20} />
          </div>
          <div>
            <strong>即将删除</strong>
            <p>{displayContent}</p>
          </div>
        </div>
        {remove.error && (
          <div className="delete-error" role="alert">
            删除失败：{remove.error.message}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => setDeleteOpen(false)}
            disabled={remove.isPending}
          >
            取消
          </button>
          <button
            type="button"
            className="button destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending ? '删除中…' : '确认删除'}
          </button>
        </div>
      </Modal>
    </article>
  );
}
