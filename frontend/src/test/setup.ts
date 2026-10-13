import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/**
 * Installs a fetch stub routing path-prefixes to canned responses. Returns a
 * recorder of the requests so tests can assert headers (X-Workspace, JWT).
 */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export function mockFetch(
  routes: Record<string, { status?: number; body?: unknown }>,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = { ...(init?.headers as Record<string, string>) };
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    const match = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!match) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: 404, code: 'NOT_FOUND', message: 'no route' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const { status = 200, body = null } = match[1];
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return requests;
}
