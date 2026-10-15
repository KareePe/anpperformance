/**
 * Cloudflare Worker entry (see wrangler.jsonc).
 * Static files are served from dist/ (built by scripts/build.sh) before this runs;
 * the Worker only sees requests that match no file — /api/contact and 404s.
 */
import { onRequest as contact } from './functions/api/contact.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/contact') {
      return contact({ request, env });
    }
    return env.ASSETS.fetch(request);
  }
};
