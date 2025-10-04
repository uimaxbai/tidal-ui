# tidal-ui

High-fidelity music streaming UI built with SvelteKit and Tailwind.

## Features

- Full-featured audio player with queue management, shuffle, seek, and volume controls.
- Lossless playback with runtime quality selection and optional preloading for smooth transitions.
- Powerful search experience across tracks, albums, artists, and playlists with keyboard support.
- Dedicated album, artist, and playlist pages with rich metadata and quick actions.
- One-click track downloads that honor the selected audio quality.
- Optional Redis-backed response cache to reduce API latency and load.
- Built-in CORS proxy routing and multi-endpoint failover for resilient API access.

## Run with Docker

### Quick start with Docker Compose

1. Create a `.env` file by copying `.env.example`. Redis is optional.

2. Build and run the production container:

   ```bash
   docker compose up --build
   ```

3. Visit <http://localhost:5000> once the container finishes booting.

`docker compose` automatically passes through the optional Redis environment variables and sets `PORT=5000` so the SvelteKit server binds correctly. Stop the stack with `docker compose down` when you are done.

### Manual Docker usage

Build the image and run it directly if you prefer to manage containers yourself:

```bash
docker build -t tidal-ui .
docker run --rm -p 5000:5000 -e PORT=5000 tidal-ui
```

Pass any optional configuration (for example `TITLE`, `REDIS_URL`, or the Redis tuning knobs listed above) with additional `-e` flags.

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
