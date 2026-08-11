import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project, ReportItemType, Tag } from '@zhoubao/shared';
import {
  Archive,
  ArrowRight,
  Grid2X2,
  List,
  Pin,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash2
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { EmptyState, ErrorState, Loading, Modal, TagField } from '../components';
import { Markdown, sectionLabels, todayShanghai, isoWeekForDate } from '../lib';

type Memo = {
  id: string;
  title: string;
  contentMd: string;
  projectId: string | null;
  color: string;
  pinned: boolean;
  archivedAt: string | null;
  convertedReportItemId: string | null;
  version: number;
  updatedAt: string;
  tags: Tag[];
};
const colors = ['#DAE3F3', '#FCEADE', '#FFF2CC', '#F2F2F2', '#FAEBEB'];

export function MemosPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [edit, setEdit] = useState<Memo | null | undefined>(undefined);
  const [convert, setConvert] = useState<Memo | null>(null);
  const [scope, setScope] = useState<'active' | 'archived'>('active');
  const [deleteMemo, setDeleteMemo] = useState<Memo | null>(null);
  const memos = useQuery({
    queryKey: ['memos', scope],
    queryFn: () => api<{ memos: Memo[] }>(`/api/memos${scope === 'archived' ? '?archived=true' : ''}`)
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: Project[] }>('/api/projects')
  });
  const change = useMutation({
    mutationFn: ({ memo, body }: { memo: Memo; body: any }) =>
      api(`/api/memos/${memo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...body, expectedVersion: memo.version })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memos'] })
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/memos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memos'] });
      setDeleteMemo(null);
    }
  });
  const filtered = useMemo(
    () =>
      memos.data?.memos.filter(
        (m) =>
          (!query || `${m.title} ${m.contentMd}`.toLowerCase().includes(query.toLowerCase())) &&
          (!projectFilter || m.projectId === projectFilter)
      ) ?? [],
    [memos.data, query, projectFilter]
  );
  if (memos.isLoading || projects.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (memos.error || projects.error)
    return (
      <div className="page">
        <ErrorState
          message={(memos.error ?? projects.error)!.message}
          onRetry={() => {
            memos.refetch();
            projects.refetch();
          }}
        />
      </div>
    );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">工作素材</span>
          <h1>工作素材</h1>
          <p>集中收集会议结论、待办和可转入周报的工作线索。</p>
        </div>
        <button className="button" onClick={() => setEdit(null)}>
          <Plus size={17} />
          新建素材
        </button>
      </div>
      <div className="memo-scope">
        <button className={scope === 'active' ? 'active' : ''} onClick={() => setScope('active')}>
          当前素材
        </button>
        <button className={scope === 'archived' ? 'active' : ''} onClick={() => setScope('archived')}>
          归档箱
        </button>
      </div>
      <div className="memo-toolbar">
        <div className="mini-search">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索素材" />
        </div>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
          <option value="">全部项目</option>
          {projects.data!.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="view-toggle">
          <button
            className={view === 'grid' ? 'active' : ''}
            onClick={() => setView('grid')}
            aria-label="网格视图"
          >
            <Grid2X2 size={17} />
          </button>
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => setView('list')}
            aria-label="列表视图"
          >
            <List size={17} />
          </button>
        </div>
      </div>
      {change.error && <div className="page-action-error">操作失败：{change.error.message}</div>}
      {filtered.length ? (
        <div className={`memo-board ${view}`}>
          {filtered.map((memo, index) => (
            <article
              className="memo-card"
              key={memo.id}
              style={{ '--memo-color': memo.color, '--memo-index': index } as React.CSSProperties}
            >
              <div className="memo-top">
                <span>{projects.data!.projects.find((p) => p.id === memo.projectId)?.name ?? '随手记'}</span>
                <div>
                  {scope === 'active' && (
                    <button
                      className={`icon-button ${memo.pinned ? 'active-pin' : ''}`}
                      onClick={() => change.mutate({ memo, body: { pinned: !memo.pinned } })}
                      aria-label="置顶"
                    >
                      <Pin size={16} />
                    </button>
                  )}
                  <button className="icon-button" onClick={() => setEdit(memo)} aria-label="编辑">
                    •••
                  </button>
                </div>
              </div>
              <button className="memo-content" onClick={() => setEdit(memo)}>
                <h2>{memo.title}</h2>
                <Markdown content={memo.contentMd} />
              </button>
              <div className="memo-tags">
                {memo.tags.map((tag) => (
                  <span key={tag.id}>
                    <i style={{ background: tag.color }} />
                    {tag.name}
                  </span>
                ))}
              </div>
              <div className="memo-foot">
                {memo.convertedReportItemId ? (
                  <span className="converted">已转入周报</span>
                ) : scope === 'active' ? (
                  <button onClick={() => setConvert(memo)}>
                    转入周报
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <span />
                )}
                <div>
                  <button
                    className="icon-button"
                    onClick={() => change.mutate({ memo, body: { archived: scope === 'active' } })}
                    aria-label={scope === 'active' ? '归档' : '恢复'}
                  >
                    {scope === 'active' ? <Archive size={15} /> : <RotateCcw size={15} />}
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={() => {
                      remove.reset();
                      setDeleteMemo(memo);
                    }}
                    aria-label="删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<StickyNote />}
          heading={scope === 'active' ? '收集箱还是空的' : '归档箱为空'}
          body={
            scope === 'active'
              ? '写下一条想法、待办或会议线索，需要时再转入周报。'
              : '归档的素材会集中显示在这里，并且可以随时恢复。'
          }
          action={
            scope === 'active' ? (
              <button className="button" onClick={() => setEdit(null)}>
                <Plus size={16} />
                新建第一张卡片
              </button>
            ) : undefined
          }
        />
      )}
      {edit !== undefined && (
        <MemoEditor memo={edit} projects={projects.data!.projects} onClose={() => setEdit(undefined)} />
      )}{' '}
      {convert && (
        <ConvertMemo
          memo={convert}
          projects={projects.data!.projects}
          onClose={() => setConvert(null)}
          onSuccess={(target) => {
            setConvert(null);
            qc.invalidateQueries({ queryKey: ['memos'] });
            navigate(`/week/${target.weekYear}/${target.weekNumber}`);
          }}
        />
      )}
      {deleteMemo && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleteMemo(null);
          }}
          title="永久删除素材"
          description="删除后无法恢复，已转入周报的内容快照不会受影响。"
        >
          <div className="delete-confirmation">
            <div className="delete-confirmation-icon">
              <Trash2 size={20} />
            </div>
            <div>
              <strong>{deleteMemo.title}</strong>
              <p>请确认这条素材不再需要。</p>
            </div>
          </div>
          {remove.error && <div className="delete-error">删除失败：{remove.error.message}</div>}
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteMemo(null)}
              disabled={remove.isPending}
            >
              取消
            </button>
            <button
              className="button destructive"
              onClick={() => remove.mutate(deleteMemo.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? '删除中…' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MemoEditor({
  memo,
  projects,
  onClose
}: {
  memo: Memo | null;
  projects: Project[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(memo?.title ?? '');
  const [content, setContent] = useState(memo?.contentMd ?? '');
  const [projectId, setProjectId] = useState(memo?.projectId ?? '');
  const [color, setColor] = useState(memo?.color ?? colors[0]);
  const [tagIds, setTagIds] = useState(memo?.tags.map((tag) => tag.id) ?? []);
  const save = useMutation({
    mutationFn: () =>
      memo
        ? api(`/api/memos/${memo.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              title,
              contentMd: content,
              projectId: projectId || null,
              color,
              tagIds,
              expectedVersion: memo.version
            })
          })
        : api('/api/memos', {
            method: 'POST',
            body: JSON.stringify({
              title,
              contentMd: content,
              projectId: projectId || null,
              color,
              tagIds,
              pinned: false
            })
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memos'] });
      onClose();
    }
  });
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={memo ? '编辑卡片' : '新建卡片'}
      description="卡片会独立保存，转入周报时生成一份内容快照。"
      wide
    >
      <form
        className="memo-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <input
          className="memo-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="卡片标题"
          required
          autoFocus
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="支持 Markdown，记下一些还不成熟的想法……"
          rows={9}
        />
        <div className="memo-form-row">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">未归属项目</option>
            {projects
              .filter((p) => !p.archivedAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <div className="color-picker">
            {colors.map((value) => (
              <button
                type="button"
                key={value}
                className={color === value ? 'selected' : ''}
                style={{ background: value }}
                onClick={() => setColor(value)}
              />
            ))}
          </div>
        </div>
        <div className="memo-tag-field">
          <span>标签</span>
          <TagField value={tagIds} onChange={setTagIds} />
        </div>
        {save.error && <p className="form-error">{save.error.message}</p>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button" disabled={save.isPending}>
            {save.isPending ? '保存中…' : '保存卡片'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConvertMemo({
  memo,
  projects,
  onClose,
  onSuccess
}: {
  memo: Memo;
  projects: Project[];
  onClose: () => void;
  onSuccess: (target: { weekYear: number; weekNumber: number }) => void;
}) {
  const current = isoWeekForDate(todayShanghai());
  const [weekYear, setWeekYear] = useState(current.year);
  const [weekNumber, setWeekNumber] = useState(current.week);
  const [type, setType] = useState<ReportItemType>('completed');
  const [projectId, setProjectId] = useState(memo.projectId ?? '');
  const mutation = useMutation({
    mutationFn: () =>
      api(`/api/memos/${memo.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({ weekYear, weekNumber, type, projectId: projectId || null })
      }),
    onSuccess: () => onSuccess({ weekYear, weekNumber })
  });
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="转入周报"
      description={`“${memo.title}”将作为内容快照写入目标周。`}
    >
      <form
        className="dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="two-fields">
          <label>
            年份
            <input type="number" value={weekYear} onChange={(e) => setWeekYear(Number(e.target.value))} />
          </label>
          <label>
            周数
            <input
              type="number"
              min="1"
              max="53"
              value={weekNumber}
              onChange={(e) => setWeekNumber(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          内容类型
          <select value={type} onChange={(e) => setType(e.target.value as ReportItemType)}>
            {Object.entries(sectionLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          所属项目
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">未归属项目</option>
            {projects
              .filter((p) => !p.archivedAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        {mutation.error && <p className="form-error">{mutation.error.message}</p>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button" disabled={mutation.isPending}>
            确认转入
          </button>
        </div>
      </form>
    </Modal>
  );
}
