// Run `npm run cf:types` after changing wrangler.jsonc bindings.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    STREAM_API_KEY: string;
    STREAM_ORGANIZATION_ID: string;
  }
}
