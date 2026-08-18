import { describe, expect, it } from 'vitest';
import { readItemDraft, readOrMigrateItemDraft, removeItemDraft, writeItemDraft } from './item-draft-store';

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
    expect(writeItemDraft('item', { serverVersion: 1, revision: 1, draft: {} }, undefined)).toBe(false);
  });
});
