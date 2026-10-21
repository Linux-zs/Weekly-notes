import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Database,
  Download,
  Link2,
  Palette,
  ShieldCheck,
  Trash2,
  Unlink,
  UserRound
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { readUiTheme, saveUiTheme, UI_THEME_STORAGE_KEY, type UiTheme } from '../appearance';
import { ErrorState, Loading, Modal } from '../components';

const names: Record<string, string> = {
  dev: '本地开发账号',
  google: 'Google',
  microsoft: 'Microsoft',
  github: 'GitHub'
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
};
type Account = {
  id: string;
  provider: string;
  email: string | null;
  displayName: string | null;
  lastLoginAt: string | null;
};
const themeOptions: Array<{ value: UiTheme; name: string; description: string }> = [
  { value: 'ios-glass', name: 'iOS 液态玻璃', description: '默认 · 通透柔和的白天外观' },
  { value: 'night', name: '夜间玻璃', description: '深色玻璃与清晰柔和的文字' },
  { value: 'auto', name: '随时间自动', description: '本地时间 07:00–19:00 白天，其余夜间' }
];

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsData>('/api/settings') });
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/auth/accounts')
  });
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () =>
      api<{ devAuthEnabled: boolean; providers: Array<{ provider: string; enabled: boolean }> }>(
        '/api/auth/providers'
      )
  });
  const status = (
    title: string,
    query: { isPending: boolean; error: Error | null; refetch: () => unknown }
  ) =>
    query.error || query.isPending ? (
      <section className="settings-card vertical" aria-label={title}>
        <h2>{title}</h2>
        {query.error ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (
          <Loading />
        )}
      </section>
    ) : null;
  return (
    <SettingsContent
      settings={settings.data}
      accounts={accounts.data?.accounts ?? []}
      providers={providers.data?.providers ?? []}
      states={{
        settings: status('个人资料与空间', settings),
        accounts: status('已绑定身份', accounts) ?? status('可用登录平台', providers)
      }}
      qc={qc}
    />
  );
}

function SettingsContent({
  settings,
  accounts,
  providers,
  states,
  qc
}: {
  settings: SettingsData | undefined;
  states: Record<'settings' | 'accounts', ReactNode>;
  accounts: Account[];
  providers: Array<{ provider: string; enabled: boolean }>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [displayName, setDisplayName] = useState(settings?.profile.displayName ?? '');
  const [timezone, setTimezone] = useState(settings?.profile.timezone ?? 'Asia/Shanghai');
  const avatarInput = useRef<HTMLInputElement>(null);
  const [workspaceName, setWorkspaceName] = useState(settings?.workspace.name ?? '');
  const [loadedWorkspace, setLoadedWorkspace] = useState(settings?.workspace.id);
  if (settings && loadedWorkspace !== settings.workspace.id) {
    setLoadedWorkspace(settings.workspace.id);
    setDisplayName(settings.profile.displayName);
    setTimezone(settings.profile.timezone);
    setWorkspaceName(settings.workspace.name);
  }
  const [inviteEmail, setInviteEmail] = useState('');
  const [removeMember, setRemoveMember] = useState<SettingsData['members'][number] | null>(null);
  const [unlinkAccount, setUnlinkAccount] = useState<Account | null>(null);
  const [theme, setTheme] = useState<UiTheme>(() => readUiTheme());
  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === UI_THEME_STORAGE_KEY || event.key === null) setTheme(readUiTheme());
    };
    window.addEventListener('storage', syncPreference);
    return () => window.removeEventListener('storage', syncPreference);
  }, []);
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
  const unlink = useMutation({
    mutationFn: (accountId: string) => api(`/api/auth/accounts/${accountId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setUnlinkAccount(null);
      qc.invalidateQueries({ queryKey: ['accounts'] });
    }
  });
  const applyTheme = (value: UiTheme) => {
    setTheme(value);
    saveUiTheme(value);
  };
  const invitationVerificationRequired =
    new URLSearchParams(location.search).get('invite') === 'verification_required';
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">系统控制台</span>
          <h1>设置</h1>
        </div>
      </div>
      {invitationVerificationRequired && (
        <div className="inline-alert" role="alert">
          登录平台没有返回可信的已验证邮箱，因此暂未加入受邀空间。可以绑定另一个已验证相同邮箱的登录方式后重试。
        </div>
      )}
      <div className="settings-dashboard">
        {states.settings}
        {settings && !states.settings && (
          <>
            <section id="settings-profile" className="settings-card vertical settings-profile">
              <div className="panel-heading">
                <div>
                  <h2>
                    <UserRound size={18} />
                    个人资料
                  </h2>
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
                      hidden
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) avatar.mutate(file);
                      }}
                    />
                  </div>
                </div>
                {avatar.error && (
                  <div className="form-error" role="alert">
                    {avatar.error.message}
                  </div>
                )}
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
                {profile.error && (
                  <div className="form-error" role="alert">
                    {profile.error.message}
                  </div>
                )}
                <button className="button" disabled={profile.isPending}>
                  {profile.isPending ? '保存中…' : '保存个人资料'}
                </button>
              </form>
            </section>
            <section id="settings-space" className="settings-card vertical settings-space">
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
                {workspace.error && (
                  <div className="form-error" role="alert">
                    {workspace.error.message}
                  </div>
                )}
                <button
                  className="button secondary"
                  disabled={workspace.isPending || settings.role !== 'owner'}
                >
                  {workspace.isPending ? '保存中…' : '保存空间名称'}
                </button>
              </form>
            </section>
          </>
        )}
        {settings && !states.settings && (
          <section id="settings-team" className="settings-card vertical settings-team">
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
                  aria-label="切换空间"
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
            {switchWorkspace.error && (
              <div className="form-error" role="alert">
                切换空间失败：{switchWorkspace.error.message}
              </div>
            )}
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
            {invite.error && (
              <div className="form-error" role="alert">
                {invite.error.message}
              </div>
            )}
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
            {revokeInvitation.error && (
              <div className="form-error" role="alert">
                {revokeInvitation.error.message}
              </div>
            )}
          </section>
        )}
        {states.accounts || (
          <section id="settings-accounts" className="settings-card vertical settings-accounts">
            <div className="panel-heading">
              <div>
                <h2>登录方式</h2>
              </div>
            </div>
            <div className="account-list">
              {accounts.map((account) => {
                return (
                  <div className="account-row" key={account.id}>
                    <span className={`provider-icon ${account.provider}`}>
                      {account.provider === 'google'
                        ? 'G'
                        : account.provider === 'microsoft'
                          ? '⊞'
                          : account.provider === 'github'
                            ? 'GH'
                            : '●'}
                    </span>
                    <div>
                      <strong>{names[account.provider]}</strong>
                      <span>
                        {(account.email ?? account.displayName ?? '已绑定') +
                          (account.lastLoginAt
                            ? ` · 最近登录 ${new Date(account.lastLoginAt).toLocaleDateString('zh-CN')}`
                            : '')}
                      </span>
                    </div>
                    <button
                      className="button secondary danger-text"
                      disabled={accounts.length === 1}
                      onClick={() => setUnlinkAccount(account)}
                    >
                      <Unlink size={15} />
                      解绑
                    </button>
                  </div>
                );
              })}
              {providers
                .filter((provider) => !accounts.some((account) => account.provider === provider.provider))
                .map((provider) => (
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
                      <span>{provider.enabled ? '尚未绑定' : '尚未配置'}</span>
                    </div>
                    {provider.enabled ? (
                      <a className="button secondary" href={`/api/auth/accounts/${provider.provider}/link`}>
                        <Link2 size={15} />
                        绑定
                      </a>
                    ) : (
                      <span className="status-badge">不可用</span>
                    )}
                  </div>
                ))}
            </div>
          </section>
        )}
        <section id="settings-data" className="settings-card vertical settings-data">
          <div className="panel-heading">
            <div>
              <h2>
                <Database size={18} />
                数据导出
              </h2>
              <p>
                下载当前空间内的周报、项目、标签和个人资料。完整 JSON 包含图片附件的 Base64
                文件内容及原始链接映射，可离线保留和迁移。
              </p>
            </div>
            <a className="button secondary" href="/api/settings/export?includeFiles=true">
              <Download size={15} />
              导出完整 JSON（含附件）
            </a>
          </div>
        </section>
        <section id="settings-interface" className="settings-card settings-preference">
          <div className="settings-icon">
            <Palette />
          </div>
          <div className="settings-body">
            <h2>界面外观</h2>
            <fieldset className="theme-picker">
              <legend>主题</legend>
              <div className="theme-options">
                {themeOptions.map((option) => (
                  <label
                    className={`theme-option${theme === option.value ? ' selected' : ''}`}
                    key={option.value}
                  >
                    <input
                      type="radio"
                      name="ui-theme"
                      value={option.value}
                      checked={theme === option.value}
                      onChange={() => applyTheme(option.value)}
                    />
                    <span className={`theme-preview preview-${option.value}`} aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="theme-option-copy">
                      <strong>{option.name}</strong>
                      <small>{option.description}</small>
                    </span>
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
      </div>
      {unlinkAccount && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !unlink.isPending) setUnlinkAccount(null);
          }}
          title="解绑登录方式"
          description={`确认解绑 ${names[unlinkAccount.provider]}？`}
        >
          <p className="dialog-copy">解绑后将不能再使用该平台登录当前空间。</p>
          {unlink.error && (
            <div className="delete-error" role="alert">
              {unlink.error.message}
            </div>
          )}
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setUnlinkAccount(null)}>
              取消
            </button>
            <button
              className="button destructive"
              onClick={() => unlink.mutate(unlinkAccount.id)}
              disabled={unlink.isPending}
            >
              {unlink.isPending ? '解绑中…' : '确认解绑'}
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
          description="成员将无法继续访问当前空间。历史周报会保留在“已移除成员的历史周报”中，由所有者查看和管理；其他空间的数据不会受影响。"
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
            <div className="delete-error" role="alert">
              {removeWorkspaceMember.error.message}
            </div>
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
