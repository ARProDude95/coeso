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

export interface RouteResponse {
  status?: number;
  body?: unknown;
  /** Optional HTTP method; when set, the route only matches that method
   *  (needed where GET and POST share a path, e.g. /api/activity). */
  method?: string;
}

export type RouteTable = Record<string, RouteResponse | RouteResponse[]>;

export function mockFetch(
  routes: RouteTable,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const headers = { ...(init?.headers as Record<string, string>) };
    let body: unknown = null;
    if (init?.body instanceof FormData) {
      body = '(form-data)';
    } else if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    requests.push({ url, method, headers, body });
    const match = Object.entries(routes)
      .map(([prefix, value]) => [prefix, Array.isArray(value) ? value : [value]] as const)
      .find(([prefix, variants]) =>
        url.startsWith(prefix) &&
        variants.some(
          (route) =>
            !route.method || route.method.toUpperCase() === method.toUpperCase(),
        ),
      );
    if (!match) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: 404, code: 'NOT_FOUND', message: 'no route' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const variants = Array.isArray(match[1]) ? match[1] : [match[1]];
    const chosen =
      variants.find(
        (route) =>
          !route.method || route.method.toUpperCase() === method.toUpperCase(),
      ) ?? variants[0];
    const { status = 200, body: responseBody = null } = chosen;
    return Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return requests;
}
