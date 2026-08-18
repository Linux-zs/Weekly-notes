export interface ItemDraftSnapshot<T> {
  serverVersion: number;
  revision: number;
  draft: T;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type DraftChangeTracker<T> = {
  acknowledge: (draft: T) => void;
  hasChanged: (draft: T) => boolean;
};

const draftKey = (itemId: string) => `weekly-report:item-draft:v1:${itemId}`;
const legacyKey = (itemId: string) => `weekly-notes:item-meta:${itemId}`;

export function createDraftChangeTracker<T>(
  initialDraft: T,
  queueInitialDraft = false
): DraftChangeTracker<T> {
  let acknowledged = queueInitialDraft ? null : JSON.stringify(initialDraft);
  return {
    acknowledge(draft) {
      acknowledged = JSON.stringify(draft);
    },
    hasChanged(draft) {
      const current = JSON.stringify(draft);
      if (current === acknowledged) return false;
      acknowledged = current;
      return true;
    }
  };
}

function browserStorage(): DraftStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function discardStorageKey(storage: DraftStorage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be disabled; callers still fall back to in-memory state.
  }
}

export function readItemDraft<T>(itemId: string, storage = browserStorage()) {
  if (!storage) return null;
  try {
    const value = storage.getItem(draftKey(itemId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<ItemDraftSnapshot<T>>;
    if (
      !Number.isInteger(parsed.serverVersion) ||
      !Number.isInteger(parsed.revision) ||
      !parsed.draft ||
      typeof parsed.draft !== 'object'
    ) {
      discardStorageKey(storage, draftKey(itemId));
      return null;
    }
    return parsed as ItemDraftSnapshot<T>;
  } catch {
    discardStorageKey(storage, draftKey(itemId));
    return null;
  }
}

export function writeItemDraft<T>(
  itemId: string,
  snapshot: ItemDraftSnapshot<T>,
  storage = browserStorage()
) {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(itemId), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function removeItemDraft(itemId: string, storage = browserStorage()) {
  if (!storage) return;
  discardStorageKey(storage, draftKey(itemId));
}

export function readOrMigrateItemDraft<T extends { progress: string; note: string }>(
  itemId: string,
  serverVersion: number,
  serverDraft: T,
  storage = browserStorage()
) {
  const current = readItemDraft<T>(itemId, storage);
  if (current || !storage) return current;
  try {
    const legacyValue = storage.getItem(legacyKey(itemId));
    if (!legacyValue) return null;
    const legacy = JSON.parse(legacyValue) as { progress?: unknown; note?: unknown };
    const snapshot: ItemDraftSnapshot<T> = {
      serverVersion,
      revision: 1,
      draft: {
        ...serverDraft,
        progress: typeof legacy.progress === 'string' ? legacy.progress : serverDraft.progress,
        note: typeof legacy.note === 'string' ? legacy.note : serverDraft.note
      }
    };
    if (writeItemDraft(itemId, snapshot, storage)) discardStorageKey(storage, legacyKey(itemId));
    return snapshot;
  } catch {
    discardStorageKey(storage, legacyKey(itemId));
    return null;
  }
}
