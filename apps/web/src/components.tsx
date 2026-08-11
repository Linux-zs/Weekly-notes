import * as Dialog from '@radix-ui/react-dialog';
import { Plus, Tag as TagIcon, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Tag } from '@zhoubao/shared';
import { useState, type ReactNode } from 'react';
import { api } from './api';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  fullscreen = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  fullscreen?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`dialog-content ${wide ? 'dialog-wide' : ''} ${fullscreen ? 'dialog-fullscreen' : ''}`}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && <Dialog.Description>{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function EmptyState({
  icon,
  heading,
  body,
  action
}: {
  icon: ReactNode;
  heading: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{heading}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-stack" aria-label="加载中">
      <span />
      <span />
      <span />
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <strong>加载失败</strong>
      <p>{message}</p>
      {onRetry && (
        <button className="button secondary" onClick={onRetry}>
          重新加载
        </button>
      )}
    </div>
  );
}

const tagColors = ['#2F5597', '#990000', '#ED7D31', '#808080', '#44546A'];
export function TagField({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(tagColors[0]);
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api<{ tags: Tag[] }>('/api/tags') });
  const create = useMutation({
    mutationFn: () => api<Tag>('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
    onSuccess: (tag) => {
      qc.setQueryData<{ tags: Tag[] }>(['tags'], (old) => ({
        tags: [...(old?.tags ?? []), tag].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      }));
      onChange([...value, tag.id]);
      setName('');
      setCreating(false);
    }
  });
  if (tags.isLoading) return <div className="tag-field-loading">正在加载标签…</div>;
  if (tags.error) return <div className="form-error">标签加载失败：{tags.error.message}</div>;
  return (
    <div className="tag-field">
      <div className="tag-field-list">
        {tags.data!.tags.map((tag) => (
          <button
            type="button"
            key={tag.id}
            className={`tag-choice${value.includes(tag.id) ? ' selected' : ''}`}
            onClick={() =>
              onChange(value.includes(tag.id) ? value.filter((id) => id !== tag.id) : [...value, tag.id])
            }
          >
            <i style={{ background: tag.color }} />
            <span>{tag.name}</span>
          </button>
        ))}
        <button
          type="button"
          className="tag-choice add-tag"
          onClick={() => setCreating((current) => !current)}
        >
          <Plus size={13} />
          新标签
        </button>
      </div>
      {creating && (
        <div className="tag-create-row">
          <TagIcon size={15} />
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="标签名称"
            maxLength={40}
          />
          <div className="mini-color-picker">
            {tagColors.map((option) => (
              <button
                type="button"
                key={option}
                aria-label={`使用颜色 ${option}`}
                className={color === option ? 'selected' : ''}
                style={{ background: option }}
                onClick={() => setColor(option)}
              />
            ))}
          </div>
          <button
            type="button"
            className="button compact-button"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? '创建中…' : '创建'}
          </button>
        </div>
      )}
      {create.error && <div className="form-error">{create.error.message}</div>}
    </div>
  );
}
