import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@zhoubao/shared';
import { Archive, ArrowDown, ArrowUp, FolderKanban, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { EmptyState, ErrorState, Loading, Modal } from '../components';

const palette = ['#CF4F1C', '#2D6A4F', '#3A5BA0', '#8A4FA3', '#C7831B', '#59636E'];
type ProjectDraft = { name: string; color: string };

export function ProjectSettings() {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<Project | null | undefined>(undefined);
  const [draft, setDraft] = useState<ProjectDraft>({ name: '', color: palette[0] });
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: Project[] }>('/api/projects')
  });
  const createProject = useMutation({
    mutationFn: () => api('/api/projects', { method: 'POST', body: JSON.stringify(draft) }),
    onSuccess: () => {
      setEditor(undefined);
      qc.invalidateQueries({ queryKey: ['projects'] });
    }
  });
  const updateProject = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ProjectDraft> & { archived?: boolean } }) =>
      api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] })
  });
  const saveEdit = useMutation({
    mutationFn: () => api(`/api/projects/${editor!.id}`, { method: 'PATCH', body: JSON.stringify(draft) }),
    onSuccess: () => {
      setEditor(undefined);
      qc.invalidateQueries({ queryKey: ['projects'] });
    }
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteProject(null);
      qc.invalidateQueries({ queryKey: ['projects'] });
    }
  });
  const reorder = useMutation({
    mutationFn: ({ ids, expectedIds }: { ids: string[]; expectedIds: string[] }) =>
      api('/api/projects/reorder', { method: 'POST', body: JSON.stringify({ ids, expectedIds }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] })
  });
  if (projects.isLoading)
    return (
      <section id="projects" className="settings-card vertical settings-projects">
        <Loading />
      </section>
    );
  if (projects.error)
    return (
      <section id="projects" className="settings-card vertical settings-projects">
        <ErrorState message={projects.error.message} onRetry={() => projects.refetch()} />
      </section>
    );
  const active = projects.data!.projects.filter((project) => !project.archivedAt);
  const archived = projects.data!.projects.filter((project) => project.archivedAt);
  const moveProject = (list: Project[], index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const expectedIds = list.map((project) => project.id);
    const ids = [...expectedIds];
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ ids, expectedIds });
  };
  const openCreate = () => {
    setDraft({ name: '', color: palette[0] });
    setEditor(null);
  };
  const openEdit = (project: Project) => {
    setDraft({ name: project.name, color: project.color });
    setEditor(project);
  };
  const renderProject = (project: Project, index: number, list: Project[]) => (
    <div className={`project-row ${project.archivedAt ? 'archived' : ''}`} key={project.id}>
      <span className="project-swatch" style={{ background: project.color }} />
      <div>
        <strong>{project.name}</strong>
        <span>{project.archivedAt ? '已归档' : `排序 ${index + 1}`}</span>
      </div>
      <div className="project-row-actions">
        {!project.archivedAt && (
          <>
            <button
              className="icon-button"
              aria-label="上移"
              disabled={index === 0 || reorder.isPending}
              onClick={() => moveProject(list, index, -1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="下移"
              disabled={index === list.length - 1 || reorder.isPending}
              onClick={() => moveProject(list, index, 1)}
            >
              <ArrowDown size={15} />
            </button>
          </>
        )}
        <button className="icon-button" aria-label="编辑项目" onClick={() => openEdit(project)}>
          <Pencil size={15} />
        </button>
        <button
          className="icon-button"
          aria-label={project.archivedAt ? '恢复项目' : '归档项目'}
          onClick={() => updateProject.mutate({ id: project.id, body: { archived: !project.archivedAt } })}
        >
          {project.archivedAt ? <RotateCcw size={16} /> : <Archive size={16} />}
        </button>
        <button
          className="icon-button danger"
          aria-label="删除项目"
          onClick={() => {
            remove.reset();
            setDeleteProject(project);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
  return (
    <>
      <section id="projects" className="settings-card vertical settings-projects">
        <div className="panel-heading">
          <div>
            <h2>
              <FolderKanban size={18} />
              项目管理
            </h2>
            <p>维护项目颜色、显示顺序与周报归属。</p>
          </div>
          <button className="button" onClick={openCreate}>
            <Plus size={17} />
            新建项目
          </button>
        </div>
        {(updateProject.error || reorder.error) && (
          <div className="page-action-error">操作失败：{(updateProject.error ?? reorder.error)!.message}</div>
        )}
        <div className="project-settings-groups">
          <div className="project-settings-group">
            <div className="project-settings-heading">
              <h3>进行中</h3>
              <span>{active.length} 个项目</span>
            </div>
            {active.length ? (
              <div className="project-list">
                {active.map((project, index) => renderProject(project, index, active))}
              </div>
            ) : (
              <EmptyState
                icon={<FolderKanban />}
                heading="还没有项目"
                body="建立第一个项目，让每条周报都有清晰归属。"
              />
            )}
          </div>
          {archived.length > 0 && (
            <div className="project-settings-group archived-projects">
              <div className="project-settings-heading">
                <h3>已归档</h3>
                <span>{archived.length} 个项目</span>
              </div>
              <div className="project-list">
                {archived.map((project, index) => renderProject(project, index, archived))}
              </div>
            </div>
          )}
        </div>
      </section>
      {editor !== undefined && (
        <ProjectEditor
          project={editor}
          draft={draft}
          setDraft={setDraft}
          onClose={() => setEditor(undefined)}
          onSubmit={() => (editor ? saveEdit.mutate() : createProject.mutate())}
          pending={editor ? saveEdit.isPending : createProject.isPending}
          error={(editor ? saveEdit.error : createProject.error)?.message}
        />
      )}
      {deleteProject && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleteProject(null);
          }}
          title="删除项目"
          description="未被周报引用的项目可以永久删除；已经使用的项目请保留归档。"
        >
          <div className="delete-confirmation">
            <div className="delete-confirmation-icon">
              <Trash2 size={20} />
            </div>
            <div>
              <strong>{deleteProject.name}</strong>
              <p>只有从未被周报引用的项目才能永久删除。</p>
            </div>
          </div>
          {remove.error && <div className="delete-error">{remove.error.message}</div>}
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteProject(null)}
              disabled={remove.isPending}
            >
              取消
            </button>
            <button
              className="button destructive"
              onClick={() => remove.mutate(deleteProject.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? '删除中…' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ProjectEditor({
  project,
  draft,
  setDraft,
  onClose,
  onSubmit,
  pending,
  error
}: {
  project: Project | null;
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={project ? '编辑项目' : '新建项目'}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label>
          名称
          <input
            autoFocus
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
            maxLength={80}
          />
        </label>
        <fieldset>
          <legend>颜色</legend>
          <div className="color-picker">
            {palette.map((value) => (
              <button
                type="button"
                key={value}
                className={draft.color === value ? 'selected' : ''}
                style={{ background: value }}
                onClick={() => setDraft({ ...draft, color: value })}
                aria-label={`选择颜色 ${value}`}
              />
            ))}
          </div>
        </fieldset>
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button" disabled={pending}>
            {pending ? '保存中…' : project ? '保存修改' : '创建'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
