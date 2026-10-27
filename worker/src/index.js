// Roster API on Workers. Serves /api/* from D1; every other request falls
// through to the static SPA assets (with SPA fallback handled by the assets
// binding). Errors are mapped to the shared {status,code,message,details} envelope.
import { handleApi } from './routes.js';
import { errorResponse, json } from './lib/http.js';
import { ensureReady } from './bootstrap.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        await ensureReady(env);
        const res = await handleApi(request, env);
        if (res) return res;
        return json(
          { status: 404, code: 'NOT_FOUND', message: `No route for ${request.method} ${url.pathname}`, details: null },
          404,
        );
      } catch (err) {
        return errorResponse(err);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
