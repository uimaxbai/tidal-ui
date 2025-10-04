# tidal-ui

## Development Notes

- HIFI API requests are proxied through the first-party SvelteKit route at `/api/proxy` so the browser can call the API without CORS errors.
- API responses are cached in Redis when the following environment variables are present:
  - `REDIS_URL` (preferred) or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_USERNAME`
  - Optional tuning knobs:
    - `REDIS_CACHE_TTL_SECONDS` (default 300)
    - `REDIS_CACHE_TTL_SEARCH_SECONDS` (default 300)
    - `REDIS_CACHE_TTL_TRACK_SECONDS` (default 120)
    - `REDIS_CACHE_MAX_BODY_BYTES` (default 200000)
- Cached responses are stored only for safe GET requests without `Authorization`, `Cookie`, or `Range` headers. Responses larger than `REDIS_CACHE_MAX_BODY_BYTES`, non-text/JSON payloads, 4xx/5xx statuses, and responses with `Cache-Control: no-store|private` are never cached.
- Install dependencies with `npm install` after updating `package.json`.
