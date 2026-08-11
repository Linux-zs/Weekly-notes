import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@zhoubao/shared';
import { Archive, ArrowDown, ArrowUp, FolderKanban, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { EmptyState, ErrorState, Loading, Modal } from '../components';

const palette = ['#2F5597', '#990000', '#ED7D31', '#FFD966', '#808080', '#44546A'];
type ProjectDraft = { name: string; color: string };

export function ProjectsPage() {
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
    mutationFn: ({
      id,
      body
    }: {
      id: string;
      body: Partial<ProjectDraft> & { archived?: boolean; position?: number };
    }) => api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
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
    mutationFn: async ({ project, target }: { project: Project; target: Project }) => {
      await Promise.all([
        api(`/api/projects/${project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: target.position })
        }),
        api(`/api/projects/${target.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ position: project.position })
        })
      ]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] })
  });
  if (projects.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (projects.error)
    return (
      <div className="page">
        <ErrorState message={projects.error.message} onRetry={() => projects.refetch()} />
      </div>
    );
  const active = projects.data!.projects.filter((project) => !project.archivedAt);
  const archived = projects.data!.projects.filter((project) => project.archivedAt);
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
              onClick={() => reorder.mutate({ project, target: list[index - 1]! })}
            >
              <ArrowUp size={15} />
            </button>
            <button
              className="icon-button"
              aria-label="下移"
              disabled={index === list.length - 1 || reorder.isPending}
              onClick={() => reorder.mutate({ project, target: list[index + 1]! })}
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
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">项目管理</span>
          <h1>项目</h1>
          <p>维护项目边界、颜色、顺序与周报归属。</p>
        </div>
        <button className="button" onClick={openCreate}>
          <Plus size={17} />
          新建项目
        </button>
      </div>
      {(updateProject.error || reorder.error) && (
        <div className="page-action-error">操作失败：{(updateProject.error ?? reorder.error)!.message}</div>
      )}
      <div className="management-grid projects-only">
        <section className="management-panel">
          <div className="panel-heading">
            <h2>进行中</h2>
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
        </section>
        {archived.length > 0 && (
          <section className="management-panel archived-projects">
            <div className="panel-heading">
              <h2>已归档</h2>
              <span>{archived.length} 个项目</span>
            </div>
            <div className="project-list">
              {archived.map((project, index) => renderProject(project, index, archived))}
            </div>
          </section>
        )}
      </div>
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
              <p>删除后，尚未形成周报的素材会变为未归属。</p>
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
    </div>
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
