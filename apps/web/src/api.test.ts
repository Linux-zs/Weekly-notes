import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('does not send a JSON content type for bodyless deletes', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await api('/api/items/1', { method: 'DELETE' });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });
  it('adds JSON content type when a body is present', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch);
    await api('/api/items', { method: 'POST', body: '{}' });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });
  it('surfaces structured API messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: '保存冲突' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    await expect(api('/api/items/1')).rejects.toEqual(
      expect.objectContaining({ status: 409, message: '保存冲突' })
    );
  });
});
