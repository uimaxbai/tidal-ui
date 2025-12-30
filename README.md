# lossless-ui

High-fidelity music streaming UI built with SvelteKit and Tailwind.

## See a list of instances of APIs and frontends [here](https://github.com/SamidyFR/monochrome/blob/main/INSTANCES.md).

## API + API docs are [here](https://github.com/uimaxbai/hifi-api)

## Features

- It works (kinda)
- Downloads in FLAC up to 24-bit/192kHz

## Run with Docker

### Quick start with Docker Compose

1. Create a `.env` file by copying `.env.example`. Redis is deprecated (don't use it).

2. Build and run the production container:

   ```bash
   docker compose up --build
   ```

3. Visit <http://localhost:5000> once the container finishes booting.

`docker compose` automatically passes through the optional Redis environment variables and sets `PORT=5000` so the SvelteKit server binds correctly. Stop the stack with `docker compose down` when you are done.

Pass any optional configuration (for example `TITLE`) with additional `-e` flags.

## Development Notes

- Redis for this project has been **deprecated**. Don't use it.
- Some requests are proxied through the first-party SvelteKit route at `/api/proxy` so the browser can call the API without CORS errors.
- Cached responses are stored only for safe GET requests without `Authorization`, `Cookie`, or `Range` headers. Responses larger than `REDIS_CACHE_MAX_BODY_BYTES`, non-text/JSON payloads, 4xx/5xx statuses, and responses with `Cache-Control: no-store|private` are never cached.
- Install dependencies with `npm install` after updating `package.json`.

## Todo
