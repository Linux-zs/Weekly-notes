export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any
  ) {
    super(data?.message ?? `请求失败 (${status})`);
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    let data: any = {};
    try {
      data = await response.json();
    } catch {
      /* Error responses are not guaranteed to be JSON. */
    }
    throw new ApiError(response.status, data);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
