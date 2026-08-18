import { describe, expect, it } from 'vitest';
import {
  createDraftChangeTracker,
  readItemDraft,
  readOrMigrateItemDraft,
  removeItemDraft,
  writeItemDraft
} from './item-draft-store';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values
  };
}

describe('item draft storage', () => {
  it('does not treat repeated mount effects or acknowledged server state as draft edits', () => {
    const initial = { contentMd: '服务器正文', tagIds: ['tag'] };
    const tracker = createDraftChangeTracker(initial);

    expect(tracker.hasChanged(initial)).toBe(false);
    expect(tracker.hasChanged({ ...initial, tagIds: [...initial.tagIds] })).toBe(false);
    expect(tracker.hasChanged({ ...initial, contentMd: '本地修改' })).toBe(true);
    expect(tracker.hasChanged({ ...initial, contentMd: '本地修改' })).toBe(false);
    tracker.acknowledge({ ...initial, contentMd: '服务器新正文' });
    expect(tracker.hasChanged({ ...initial, contentMd: '服务器新正文' })).toBe(false);
  });

  it('queues a recovered draft exactly once', () => {
    const draft = { contentMd: '恢复的草稿', tagIds: [] as string[] };
    const tracker = createDraftChangeTracker(draft, true);

    expect(tracker.hasChanged(draft)).toBe(true);
    expect(tracker.hasChanged(draft)).toBe(false);
  });

  it('round-trips and removes a complete draft snapshot', () => {
    const storage = memoryStorage();
    const snapshot = { serverVersion: 3, revision: 5, draft: { contentMd: '未保存内容' } };

    expect(writeItemDraft('item', snapshot, storage)).toBe(true);
    expect(readItemDraft('item', storage)).toEqual(snapshot);
    removeItemDraft('item', storage);
    expect(readItemDraft('item', storage)).toBeNull();
  });

  it('migrates legacy progress metadata once without losing the server draft', () => {
    const storage = memoryStorage();
    storage.setItem('weekly-notes:item-meta:item', JSON.stringify({ progress: 'answered', note: '旧备注' }));

    const migrated = readOrMigrateItemDraft(
      'item',
      2,
      { contentMd: '正文', progress: 'incomplete', note: '', tagIds: ['tag'] },
      storage
    );

    expect(migrated).toEqual({
      serverVersion: 2,
      revision: 1,
      draft: { contentMd: '正文', progress: 'answered', note: '旧备注', tagIds: ['tag'] }
    });
    expect(storage.getItem('weekly-notes:item-meta:item')).toBeNull();
    expect(readOrMigrateItemDraft('item', 3, migrated!.draft, storage)).toEqual(migrated);
  });

  it('ignores malformed or unavailable storage', () => {
    const storage = memoryStorage();
    storage.setItem('weekly-report:item-draft:v1:item', '{broken');
    expect(readItemDraft('item', storage)).toBeNull();
    expect(storage.getItem('weekly-report:item-draft:v1:item')).toBeNull();
    expect(writeItemDraft('item', { serverVersion: 1, revision: 1, draft: {} }, undefined)).toBe(false);
  });

  it('discards malformed legacy metadata after the one-time migration attempt', () => {
    const storage = memoryStorage();
    storage.setItem('weekly-notes:item-meta:item', '{broken');

    expect(
      readOrMigrateItemDraft(
        'item',
        1,
        { contentMd: '正文', progress: 'incomplete', note: '', tagIds: [] },
        storage
      )
    ).toBeNull();
    expect(storage.getItem('weekly-notes:item-meta:item')).toBeNull();
  });
});
