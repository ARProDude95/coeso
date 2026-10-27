// HTTP helpers: JSON responses + the API's shared error envelope, so the
// Worker answers failures in exactly the shape the Spring Boot backend does
// ({ status, code, message, details }) and the SPA's ApiError parses them.

export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(err) {
  if (err instanceof ApiError) {
    return json(
      { status: err.status, code: err.code, message: err.message, details: err.details },
      err.status,
    );
  }
  // Unexpected error: log server-side, answer a generic 500 (never leak internals).
  console.error('unhandled', err);
  return json({ status: 500, code: 'INTERNAL', message: 'Internal server error', details: null }, 500);
}

export const badRequest = (m, d = null) => new ApiError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Not authenticated') => new ApiError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'Forbidden') => new ApiError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new ApiError(404, 'NOT_FOUND', m);
export const conflict = (m, d = null) => new ApiError(409, 'CONFLICT', m, d);
