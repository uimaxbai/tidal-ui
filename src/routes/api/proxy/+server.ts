import type { RequestHandler } from './$types';
import { isProxyAllowedHost } from '$lib/config';

const allowOrigin = (_origin?: string | null): boolean => true;

const hopByHopHeaders = new Set([
	'connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade'
]);

const ensureVaryIncludesOrigin = (value: string | null): string => {
	const entries = value
		? value
			.split(',')
			.map((v) => v.trim())
			.filter(Boolean)
	: [];
	if (!entries.includes('Origin')) {
		entries.push('Origin');
	}
	return entries.join(', ');
};

export const GET: RequestHandler = async ({ url, request, fetch }) => {
	const target = url.searchParams.get('url');
	const origin = request.headers.get('origin');

	if (!allowOrigin(origin)) {
		return new Response('Forbidden', { status: 403 });
	}

	if (!target) {
		return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let parsedTarget: URL;

	try {
		parsedTarget = new URL(target);
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Invalid target URL' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!isProxyAllowedHost(parsedTarget.hostname)) {
		return new Response(JSON.stringify({ error: 'Invalid target host' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const upstreamHeaders = new Headers();

	request.headers.forEach((value, key) => {
		const lowerKey = key.toLowerCase();
		if (hopByHopHeaders.has(lowerKey) || lowerKey === 'host') {
			return;
		}
		upstreamHeaders.set(key, value);
	});

	if (!upstreamHeaders.has('User-Agent')) {
		upstreamHeaders.set('User-Agent', 'Mozilla/5.0 (compatible; TIDAL-UI/1.0)');
	}

	try {
		const upstream = await fetch(parsedTarget.toString(), {
			headers: upstreamHeaders,
			redirect: 'follow'
		});

		const headers = new Headers(upstream.headers);

		headers.set('Access-Control-Allow-Origin', origin ?? '*');
		headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
		headers.set('Access-Control-Allow-Headers', 'Content-Type, Range');
		headers.set('Vary', ensureVaryIncludesOrigin(upstream.headers.get('vary')));

		if (!headers.has('Cache-Control')) {
			headers.set('Cache-Control', 'public, max-age=300');
		}

		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers
		});
	} catch (error) {
		console.error('Proxy error:', error);
		return new Response(
			JSON.stringify({
				error: 'Proxy request failed',
				message: error instanceof Error ? error.message : 'Unknown error'
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			}
		);
	}
};

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');

	if (!allowOrigin(origin)) {
		return new Response(null, { status: 403 });
	}

	const headers = new Headers();
	headers.set('Access-Control-Allow-Origin', origin ?? '*');
	headers.set('Vary', 'Origin');
	headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type, Range');
	headers.set('Access-Control-Max-Age', '86400');

	return new Response(null, {
		status: 204,
		headers
	});
};
