import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	process.env = { ...process.env, ...env };

	const parsedPort = env.PORT ? Number.parseInt(env.PORT, 10) : undefined;

	return {
		plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
		server: {
			watch: { usePolling: true },
			host: '0.0.0.0',
			port: Number.isFinite(parsedPort) ? parsedPort : undefined
		},
		optimizeDeps: {
			exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
		},
		ssr: {
			external: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
		}
	};
});
