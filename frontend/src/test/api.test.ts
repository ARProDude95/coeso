import { describe, expect, it } from 'vitest';
import {
  ApiError,
  listReps,
  placeRep,
  setActiveWorkspaceId,
  setAuthToken,
} from '../api';
import { mockFetch } from './setup';

describe('api client', () => {
  it('sends the JWT and X-Workspace headers on workspace-scoped calls', async () => {
    const requests = mockFetch({
      '/api/reps': { body: { page: 0, size: 20, total: 0, items: [] } },
    });
    setAuthToken('jwt-token-123');
    setActiveWorkspaceId(42);

    await listReps({ q: 'alice' });

    expect(requests).toHaveLength(1);
    expect(requests[0].headers['Authorization']).toBe('Bearer jwt-token-123');
    expect(requests[0].headers['X-Workspace']).toBe('42');
    expect(requests[0].url).toContain('q=alice');
  });

  it('omits X-Workspace for non-scoped calls such as login', async () => {
    const requests = mockFetch({
      '/api/auth/login': { body: { token: 't', user: { id: 1, email: 'a', displayName: 'A' } } },
    });
    setActiveWorkspaceId(7);

    const { login } = await import('../api');
    await login('a@example.test', 'pw');

    expect(requests[0].headers['X-Workspace']).toBeUndefined();
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toEqual({ email: 'a@example.test', password: 'pw' });
  });

  it('surfaces the backend error envelope as ApiError', async () => {
    mockFetch({
      '/api/placements': {
        status: 409,
        body: { status: 409, code: 'CONFLICT', message: 'Offer is full (1/1 seats filled)' },
      },
    });
    setActiveWorkspaceId(1);

    await expect(placeRep(10, 20)).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Offer is full (1/1 seats filled)',
    });
    await expect(placeRep(10, 20)).rejects.toBeInstanceOf(ApiError);
  });

  it('keeps plan-limit details so the UI can show current/limit', async () => {
    mockFetch({
      '/api/reps': {
        status: 402,
        body: {
          status: 402,
          code: 'PLAN_LIMIT_EXCEEDED',
          message: "Plan 'free' allows at most 10 reps",
          details: { resource: 'reps', current: 10, limit: 10 },
        },
      },
    });
    setActiveWorkspaceId(1);

    const err = await listReps({}).then(
      () => null,
      (e: ApiError) => e,
    );
    expect(err?.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(err?.details).toEqual({ resource: 'reps', current: 10, limit: 10 });
    expect(err?.status).toBe(402);
  });
});
