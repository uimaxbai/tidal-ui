import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import vercel from '@sveltejs/adapter-vercel';
import node from '@sveltejs/adapter-node';
import cloudflare from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: selectAdapter()
	}
};

function selectAdapter() {
	// Vercel automatically sets this
	if (process.env.VERCEL) {
		console.log('Using Vercel adapter');
		return vercel();
	}

	// Cloudflare Workers environment
	if (process.env.CF_PAGES || process.env.CF_WORKER) {
		console.log('Using Cloudflare adapter');
		return cloudflare();
	}

	// Docker / local / default
	console.log('Using Node adapter (Docker/local)');
	return node({
		out: 'build',
		precompress: true
	});
}

export default config;
