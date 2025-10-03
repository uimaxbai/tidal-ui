# tidal-ui

## Development Notes

- HIFI API requests are proxied through the first-party SvelteKit route at `/api/proxy` so the browser can call the API without CORS errors. Update `ALLOWED_ORIGINS` in `src/routes/api/proxy/+server.ts` to include any additional domains before deploying.
