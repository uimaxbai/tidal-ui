/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'binitidal';
const APP_CACHE_NAME = `${CACHE_PREFIX}-app-v${version}`;
const DATA_CACHE_NAME = `${CACHE_PREFIX}-data-v1`; // this cache persists across app versions

const ASSETS_TO_CACHE = [...new Set([...build, ...files, '/offline.html'])];

const ALLOWED_STREAM_HOSTS = ['lgf.audio.tidal.com', 'amz-pr-fa.audio.tidal.com', 'flac.tidal.com'];


sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(APP_CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS_TO_CACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key.startsWith(`${CACHE_PREFIX}-app-`) && key !== APP_CACHE_NAME) {
					await caches.delete(key);
				}
			}
			await sw.clients.claim();
		})
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	if (url.origin !== sw.location.origin && !url.pathname.startsWith('/api/proxy')) {
		return;
	}

	if (url.pathname.startsWith('/api/proxy')) {
		try {
			const proxiedUrl = new URL(url.searchParams.get('url') || '');
			if (ALLOWED_STREAM_HOSTS.includes(proxiedUrl.hostname)) {
				event.respondWith(cacheFirst(request, DATA_CACHE_NAME));
				return;
			}
		} catch {
			// Invalid proxied URL, fall through to other strategies
		}
	}

	if (ASSETS_TO_CACHE.includes(url.pathname)) {
		event.respondWith(cacheFirst(request, APP_CACHE_NAME));
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request, APP_CACHE_NAME));
		return;
	}

	event.respondWith(staleWhileRevalidate(request, DATA_CACHE_NAME));
});


async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const cachedResponse = await cache.match(request);

	if (cachedResponse) {
		return cachedResponse;
	}

	const networkResponse = await fetch(request);
	if (networkResponse.ok) {
		await cache.put(request, networkResponse.clone());
	}
	return networkResponse;
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
	try {
		const networkResponse = await fetch(request);
		if (networkResponse.ok) {
			const cache = await caches.open(cacheName);
			await cache.put(request, networkResponse.clone());
		}
		return networkResponse;
	} catch (error) {
		const cache = await caches.open(cacheName);
		const cachedResponse = await cache.match(request);
		// Fallback to offline page if both network and cache fail
		return cachedResponse || (await cache.match('/offline.html'))!;
	}
}

async function staleWhileRevalidate(request: Request, cacheName: string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const cachedResponse = await cache.match(request);

	const fetchPromise = fetch(request).then((networkResponse) => {
		if (networkResponse.ok) {
			cache.put(request, networkResponse.clone());
		}
		return networkResponse;
	});

	// Return cached response immediately if available, otherwise wait for the network
	return cachedResponse || (await fetchPromise);
}