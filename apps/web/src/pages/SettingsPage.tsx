import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Tag } from '@zhoubao/shared';
import {
  CheckCircle2,
  Camera,
  CloudDownload,
  Database,
  Download,
  HardDrive,
  Link2,
  Palette,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Tag as TagIcon,
  Trash2,
  Unlink,
  UserRound
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ErrorState, Loading, Modal } from '../components';
import { ProjectSettings } from './ProjectsPage';

const names: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  github: 'GitHub',
  apple: 'Apple'
};
type SettingsData = {
  profile: { displayName: string; email: string | null; timezone: string; avatarUrl: string | null };
  workspace: { id: string; name: string; type: string };
  workspaces: Array<{ id: string; name: string; type: string; role: string }>;
  members: Array<{
    id: string;
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
    role: string;
    joinedAt: string;
  }>;
  invitations: Array<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>;
  role: string;
  status: {
    databaseBytes: number;
    uploads: { files: number; bytes: number };
    backups: Array<{ name: string; createdAt: string; files: number; bytes: number }>;
    holidayYears: Array<{ year: number; dayCount: number; sourceUrl: string | null }>;
    backupSchedule: string;
    retentionDays: number;
  };
};
type Account = {
  id: string;
  provider: string;
  email: string | null;
  displayName: string | null;
  lastLoginAt: string | null;
};
const tagColors = ['#CF4F1C', '#2D6A4F', '#3A5BA0', '#8A4FA3', '#C7831B', '#59636E'];
const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/api/settings') });
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/auth/accounts')
  });
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<{ providers: Array<{ provider: string; enabled: boolean }> }>('/api/auth/providers')
  });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<{ tags: Tag[] }>('/api/tags') });
  if (settings.isLoading || accounts.isLoading || providers.isLoading || tags.isLoading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  const error = settings.error ?? accounts.error ?? providers.error ?? tags.error;
  if (error)
    return (
      <div className="page">
        <ErrorState
          message={error.message}
          onRetry={() => {
            settings.refetch();
            accounts.refetch();
            providers.refetch();
            tags.refetch();
          }}
        />
      </div>
    );
  return (
    <SettingsContent
      settings={settings.data!}
      accounts={accounts.data!.accounts}
      providers={providers.data!.providers}
      tags={tags.data!.tags}
      qc={qc}
    />
  );
}

function SettingsContent({
  settings,
  accounts,
  providers,
  tags,
  qc
}: {
  settings: SettingsData;
  accounts: Account[];
  providers: Array<{ provider: string; enabled: boolean }>;
  tags: Tag[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [displayName, setDisplayName] = useState(settings.profile.displayName);
  const [timezone, setTimezone] = useState(settings.profile.timezone);
  const avatarInput = useRef<HTMLInputElement>(null);
  const [workspaceName, setWorkspaceName] = useState(settings.workspace.name);
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const [inviteEmail, setInviteEmail] = useState('');
  const [removeMember, setRemoveMember] = useState<SettingsData['members'][number] | null>(null);
  const [unlinkProvider, setUnlinkProvider] = useState<string | null>(null);
  const [editTag, setEditTag] = useState<Tag | null>(null);
  const [createTagOpen, setCreateTagOpen] = useState(false);
  const [deleteTagTarget, setDeleteTagTarget] = useState<Tag | null>(null);
  const [compact, setCompact] = useState(() => localStorage.getItem('weekly-report:compact') === 'true');
  useEffect(() => {
    if (location.hash === '#projects')
      requestAnimationFrame(() => document.getElementById('projects')?.scrollIntoView({ block: 'start' }));
  }, []);
  const profile = useMutation({
    mutationFn: () =>
      api('/api/settings/profile', { method: 'PATCH', body: JSON.stringify({ displayName, timezone }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    }
  });
  const avatar = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('avatar', file);
      return api<{ avatarUrl: string }>('/api/settings/avatar', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      if (avatarInput.current) avatarInput.current.value = '';
    }
  });
  const workspace = useMutation({
    mutationFn: () =>
      api('/api/settings/workspace', { method: 'PATCH', body: JSON.stringify({ name: workspaceName }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] })
  });
  const switchWorkspace = useMutation({
    mutationFn: (workspaceId: string) =>
      api('/api/settings/workspace/switch', { method: 'POST', body: JSON.stringify({ workspaceId }) }),
    onSuccess: () => window.location.reload()
  });
  const invite = useMutation({
    mutationFn: () =>
      api('/api/settings/invitations', { method: 'POST', body: JSON.stringify({ email: inviteEmail }) }),
    onSuccess: () => {
      setInviteEmail('');
      qc.invalidateQueries({ queryKey: ['settings'] });
    }
  });
  const revokeInvitation = useMutation({
    mutationFn: (id: string) => api(`/api/settings/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] })
  });
  const removeWorkspaceMember = useMutation({
    mutationFn: (id: string) => api(`/api/settings/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoveMember(null);
      qc.invalidateQueries({ queryKey: ['settings'] });
    }
  });
  const backup = useMutation({
    mutationFn: () => api<{ name: string; createdAt: string }>('/api/settings/backup', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] })
  });
  const holiday = useMutation({
    mutationFn: () =>
      api<{ year: number; count: number; sourceUrl: string }>(
        `/api/settings/holidays/${holidayYear}/import`,
        { method: 'POST' }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['report'] });
    }
  });
  const unlink = useMutation({
    mutationFn: (provider: string) => api(`/api/auth/accounts/${provider}`, { method: 'DELETE' }),
    onSuccess: () => {
      setUnlinkProvider(null);
      qc.invalidateQueries({ queryKey: ['accounts'] });
    }
  });
  const deleteTag = useMutation({
    mutationFn: (id: string) => api(`/api/tags/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteTagTarget(null);
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['report'] });
    }
  });
  const saveTag = useMutation({
    mutationFn: ({ id, name, color }: { id: string; name: string; color: string }) =>
      api(`/api/tags/${id}`, { method: 'PATCH', body: JSON.stringify({ name, color }) }),
    onSuccess: () => {
      setEditTag(null);
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['report'] });
    }
  });
  const createTag = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) =>
      api<Tag>('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
    onSuccess: () => {
      setCreateTagOpen(false);
      qc.invalidateQueries({ queryKey: ['tags'] });
    }
  });
  const applyCompact = (value: boolean) => {
    setCompact(value);
    localStorage.setItem('weekly-report:compact', String(value));
    document.documentElement.classList.toggle('compact-ui', value);
  };
  const lastBackup = settings.status.backups[0];
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">系统控制台</span>
          <h1>设置</h1>
          <p>管理身份、空间、项目、标签和数据。</p>
        </div>
      </div>
      <div className="settings-dashboard">
        <section className="settings-card vertical settings-profile">
          <div className="panel-heading">
            <div>
              <h2>
                <UserRound size={18} />
                个人资料
              </h2>
              <p>用于周报署名、头像与日期展示。</p>
            </div>
          </div>
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              profile.mutate();
            }}
          >
            <div className="profile-avatar-row">
              <div className="profile-avatar-preview">
                {settings.profile.avatarUrl ? (
                  <img src={settings.profile.avatarUrl} alt={`${displayName}的头像`} />
                ) : (
                  <span>{displayName.slice(0, 1) || '周'}</span>
                )}
                <button
                  type="button"
                  onClick={() => avatarInput.current?.click()}
                  disabled={avatar.isPending}
                  aria-label="上传自定义头像"
                >
                  <Camera size={15} />
                </button>
              </div>
              <div>
                <strong>个人头像</strong>
                <span>支持 PNG、JPEG、GIF、WebP，最大 3 MB</span>
                <button
                  type="button"
                  className="button secondary compact-button"
                  onClick={() => avatarInput.current?.click()}
                  disabled={avatar.isPending}
                >
                  {avatar.isPending ? '上传中…' : settings.profile.avatarUrl ? '更换头像' : '上传头像'}
                </button>
                <input
                  ref={avatarInput}
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) avatar.mutate(file);
                  }}
                />
              </div>
            </div>
            {avatar.error && <div className="form-error">{avatar.error.message}</div>}
            <label>
              显示名称
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            <label>
              时区
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="Asia/Shanghai">Asia/Shanghai · 中国标准时间</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            {profile.error && <div className="form-error">{profile.error.message}</div>}
            <button className="button" disabled={profile.isPending}>
              {profile.isPending ? '保存中…' : '保存个人资料'}
            </button>
          </form>
        </section>
        <section className="settings-card vertical settings-space">
          <div className="panel-heading">
            <div>
              <h2>
                <ShieldCheck size={18} />
                空间设置
              </h2>
              <p>当前角色：{settings.role === 'owner' ? '所有者' : '成员'}</p>
            </div>
          </div>
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              workspace.mutate();
            }}
          >
            <label>
              空间名称
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                maxLength={80}
                required
                disabled={settings.role !== 'owner'}
              />
            </label>
            <div className="security-note">
              <CheckCircle2 size={16} />
              开放注册已启用；跨平台身份不会仅凭邮箱自动合并。
            </div>
            {workspace.error && <div className="form-error">{workspace.error.message}</div>}
            <button className="button secondary" disabled={workspace.isPending || settings.role !== 'owner'}>
              {workspace.isPending ? '保存中…' : '保存空间名称'}
            </button>
          </form>
        </section>
        <ProjectSettings />
        <section className="settings-card vertical settings-team">
          <div className="panel-heading">
            <div>
              <h2>
                <UserRound size={18} />
                团队成员
              </h2>
              <p>受邀邮箱使用已配置的登录平台登录后，会自动加入当前空间。</p>
            </div>
            {settings.workspaces.length > 1 && (
              <select
                value={settings.workspace.id}
                onChange={(event) => switchWorkspace.mutate(event.target.value)}
                disabled={switchWorkspace.isPending}
              >
                {settings.workspaces.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name} · {item.role === 'owner' ? '所有者' : '成员'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="member-list">
            {settings.members.map((member) => (
              <div key={member.id}>
                {member.avatarUrl ? (
                  <img className="avatar" src={member.avatarUrl} alt="" />
                ) : (
                  <span className="avatar avatar-fallback">{member.displayName.slice(0, 1)}</span>
                )}
                <div>
                  <strong>{member.displayName}</strong>
                  <span>
                    {member.email ?? '未提供邮箱'} · {member.role === 'owner' ? '所有者' : '成员'}
                  </span>
                </div>
                {settings.role === 'owner' && member.role !== 'owner' && (
                  <button className="button secondary danger-text" onClick={() => setRemoveMember(member)}>
                    移除
                  </button>
                )}
              </div>
            ))}
          </div>
          {settings.role === 'owner' && (
            <form
              className="invite-form"
              onSubmit={(event) => {
                event.preventDefault();
                invite.mutate();
              }}
            >
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="同事邮箱"
                required
              />
              <button className="button" disabled={invite.isPending}>
                {invite.isPending ? '发送中…' : '创建 7 天邀请'}
              </button>
            </form>
          )}
          {invite.error && <div className="form-error">{invite.error.message}</div>}
          {settings.invitations.length > 0 && (
            <div className="invitation-list">
              {settings.invitations.map((item) => (
                <div key={item.id}>
                  <span>{item.email}</span>
                  <small>有效期至 {new Date(item.expiresAt).toLocaleDateString('zh-CN')}</small>
                  <button
                    className="icon-button danger"
                    aria-label={`撤销 ${item.email} 的邀请`}
                    onClick={() => revokeInvitation.mutate(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {revokeInvitation.error && <div className="form-error">{revokeInvitation.error.message}</div>}
        </section>
        <section className="settings-card vertical settings-accounts">
          <div className="panel-heading">
            <div>
              <h2>登录方式</h2>
              <p>绑定多个身份可以避免单一平台不可用时无法登录。</p>
            </div>
          </div>
          <div className="account-list">
            {providers.map((provider) => {
              const account = accounts.find((item) => item.provider === provider.provider);
              return (
                <div className="account-row" key={provider.provider}>
                  <span className={`provider-icon ${provider.provider}`}>
                    {provider.provider === 'google'
                      ? 'G'
                      : provider.provider === 'microsoft'
                        ? '⊞'
                        : provider.provider === 'github'
                          ? 'GH'
                          : '●'}
                  </span>
                  <div>
                    <strong>{names[provider.provider]}</strong>
                    <span>
                      {account
                        ? (account.email ?? account.displayName ?? '已绑定') +
                          (account.lastLoginAt
                            ? ` · 最近登录 ${new Date(account.lastLoginAt).toLocaleDateString('zh-CN')}`
                            : '')
                        : provider.enabled
                          ? '尚未绑定'
                          : '尚未配置'}
                    </span>
                  </div>
                  {account ? (
                    <button
                      className="button secondary danger-text"
                      disabled={accounts.length === 1}
                      onClick={() => setUnlinkProvider(provider.provider)}
                    >
                      <Unlink size={15} />
                      解绑
                    </button>
                  ) : provider.enabled ? (
                    <a className="button secondary" href={`/api/auth/accounts/${provider.provider}/link`}>
                      <Link2 size={15} />
                      绑定
                    </a>
                  ) : (
                    <span className="status-badge">不可用</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="settings-card vertical settings-data">
          <div className="panel-heading">
            <div>
              <h2>
                <Database size={18} />
                数据与备份
              </h2>
              <p>
                每日 {settings.status.backupSchedule} 自动生成完整数据包，保留 {settings.status.retentionDays}{' '}
                天。
              </p>
            </div>
            <a className="button secondary" href="/api/settings/export">
              <Download size={15} />
              导出 JSON
            </a>
          </div>
          <div className="storage-metrics">
            <div>
              <HardDrive />
              <span>数据库</span>
              <strong>{formatBytes(settings.status.databaseBytes)}</strong>
            </div>
            <div>
              <CloudDownload />
              <span>上传文件</span>
              <strong>
                {settings.status.uploads.files} 个 · {formatBytes(settings.status.uploads.bytes)}
              </strong>
            </div>
            <div>
              <RefreshCcw />
              <span>最近备份</span>
              <strong>
                {lastBackup ? new Date(lastBackup.createdAt).toLocaleString('zh-CN') : '尚无备份'}
              </strong>
            </div>
          </div>
          {backup.error && <div className="form-error">{backup.error.message}</div>}
          {backup.data && !backup.isPending && (
            <div className="operation-result" role="status" aria-live="polite">
              <CheckCircle2 size={17} />
              <div>
                <strong>完整备份已创建</strong>
                <span>{backup.data.name} · Docker Compose 默认保存在宿主机 runtime/backups</span>
              </div>
            </div>
          )}
          <p className="storage-location">
            每份备份包含数据库、上传文件和校验清单；容器目录为 <code>/app/backups</code>。
          </p>
          <button
            className="button"
            onClick={() => {
              backup.reset();
              backup.mutate();
            }}
            disabled={backup.isPending}
          >
            {backup.isPending ? '正在备份…' : '立即创建完整备份'}
          </button>
        </section>
        <section className="settings-card vertical settings-calendar">
          <div className="panel-heading">
            <div>
              <h2>节假日数据</h2>
              <p>导入仓库内已有的年度法定节假日与调休文件。</p>
            </div>
          </div>
          <div className="holiday-years">
            {settings.status.holidayYears.map((item) => (
              <span key={item.year}>
                {item.year} · {item.dayCount} 条
              </span>
            ))}
          </div>
          <div className="inline-setting">
            <input
              type="number"
              min="2000"
              max="2200"
              value={holidayYear}
              onChange={(event) => setHolidayYear(Number(event.target.value))}
            />
            <button
              className="button secondary"
              onClick={() => {
                holiday.reset();
                holiday.mutate();
              }}
              disabled={holiday.isPending}
            >
              {holiday.isPending ? '导入中…' : '导入年度数据'}
            </button>
          </div>
          {holiday.error && <div className="form-error">{holiday.error.message}</div>}
          {holiday.data && !holiday.isPending && (
            <div className="operation-result compact-result" role="status" aria-live="polite">
              <CheckCircle2 size={16} />
              <div>
                <strong>{holiday.data.year} 年数据已导入</strong>
                <span>已写入 {holiday.data.count} 条法定节假日和调休覆盖项。</span>
              </div>
            </div>
          )}
        </section>
        <section className="settings-card vertical settings-tags">
          <div className="panel-heading">
            <div>
              <h2>
                <TagIcon size={18} />
                标签管理
              </h2>
              <p>编辑或清理周报条目使用的标签。</p>
            </div>
            <button
              className="button secondary compact-button"
              onClick={() => {
                createTag.reset();
                setCreateTagOpen(true);
              }}
            >
              <Plus size={14} />
              新建标签
            </button>
          </div>
          <div className="tag-management">
            {tags.length ? (
              tags.map((tag) => (
                <div key={tag.id}>
                  <i style={{ background: tag.color }} />
                  <strong>{tag.name}</strong>
                  <button className="button secondary" onClick={() => setEditTag(tag)}>
                    编辑
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`删除标签 ${tag.name}`}
                    disabled={deleteTag.isPending}
                    onClick={() => setDeleteTagTarget(tag)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            ) : (
              <span className="muted">尚未创建标签，点击右上角“新建标签”开始使用。</span>
            )}
          </div>
        </section>
        <section className="settings-card settings-preference">
          <div className="settings-icon">
            <Palette />
          </div>
          <div className="settings-body">
            <h2>界面密度</h2>
            <p>紧凑模式会同步收紧页面留白、卡片间距与列表行高，适合信息较多的汇报。</p>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={compact}
                onChange={(event) => applyCompact(event.target.checked)}
              />
              <span>启用紧凑模式</span>
            </label>
          </div>
        </section>
      </div>
      {unlinkProvider && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !unlink.isPending) setUnlinkProvider(null);
          }}
          title="解绑登录方式"
          description={`确认解绑 ${names[unlinkProvider]}？`}
        >
          <p className="dialog-copy">解绑后将不能再使用该平台登录当前空间。</p>
          {unlink.error && <div className="delete-error">{unlink.error.message}</div>}
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setUnlinkProvider(null)}>
              取消
            </button>
            <button
              className="button destructive"
              onClick={() => unlink.mutate(unlinkProvider)}
              disabled={unlink.isPending}
            >
              {unlink.isPending ? '解绑中…' : '确认解绑'}
            </button>
          </div>
        </Modal>
      )}
      {editTag && (
        <TagEditor
          tag={editTag}
          onClose={() => setEditTag(null)}
          onSave={(name, color) => saveTag.mutate({ id: editTag.id, name, color })}
          pending={saveTag.isPending}
          error={saveTag.error?.message}
        />
      )}{' '}
      {createTagOpen && (
        <TagEditor
          onClose={() => {
            setCreateTagOpen(false);
            createTag.reset();
          }}
          onSave={(name, color) => createTag.mutate({ name, color })}
          pending={createTag.isPending}
          error={createTag.error?.message}
        />
      )}{' '}
      {deleteTagTarget && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !deleteTag.isPending) setDeleteTagTarget(null);
          }}
          title="删除标签"
          description="标签会从所有周报条目中移除，原始内容不会被删除。"
        >
          <div className="delete-confirmation">
            <div className="delete-confirmation-icon">
              <Trash2 size={20} />
            </div>
            <div>
              <strong>{deleteTagTarget.name}</strong>
              <p>确认永久删除这个标签。</p>
            </div>
          </div>
          {deleteTag.error && <div className="delete-error">{deleteTag.error.message}</div>}
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setDeleteTagTarget(null)}>
              取消
            </button>
            <button
              className="button destructive"
              onClick={() => deleteTag.mutate(deleteTagTarget.id)}
              disabled={deleteTag.isPending}
            >
              {deleteTag.isPending ? '删除中…' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}
      {removeMember && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !removeWorkspaceMember.isPending) setRemoveMember(null);
          }}
          title="移除团队成员"
          description="成员将无法继续访问当前空间，TA 在其他空间的数据不会受影响。"
        >
          <div className="delete-confirmation">
            <div className="delete-confirmation-icon">
              <Trash2 size={20} />
            </div>
            <div>
              <strong>{removeMember.displayName}</strong>
              <p>{removeMember.email}</p>
            </div>
          </div>
          {removeWorkspaceMember.error && (
            <div className="delete-error">{removeWorkspaceMember.error.message}</div>
          )}
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setRemoveMember(null)}>
              取消
            </button>
            <button
              className="button destructive"
              onClick={() => removeWorkspaceMember.mutate(removeMember.id)}
              disabled={removeWorkspaceMember.isPending}
            >
              {removeWorkspaceMember.isPending ? '移除中…' : '确认移除'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TagEditor({
  tag,
  onClose,
  onSave,
  pending,
  error
}: {
  tag?: Tag;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
  pending: boolean;
  error?: string;
}) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? tagColors[0]);
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={tag ? '编辑标签' : '新建标签'}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(name, color);
        }}
      >
        <label>
          标签名称
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
            required
          />
        </label>
        <fieldset>
          <legend>颜色</legend>
          <div className="color-picker">
            {tagColors.map((value) => (
              <button
                type="button"
                key={value}
                className={color === value ? 'selected' : ''}
                style={{ background: value }}
                onClick={() => setColor(value)}
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
            {pending ? (tag ? '保存中…' : '创建中…') : tag ? '保存标签' : '创建标签'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
