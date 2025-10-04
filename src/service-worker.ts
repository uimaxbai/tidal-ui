/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'binitidal';
const CACHE_NAME = `${CACHE_PREFIX}-v${version}`;
const ASSETS = [...build, ...files, '/offline.html'];

self.addEventListener('install', (event) => {
	self.skipWaiting();
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(ASSETS);
		})
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const cacheNames = await caches.keys();
			await Promise.all(
				cacheNames
					.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
					.map((name) => caches.delete(name))
			);
			await self.clients.claim();
		})()
	);
});

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') {
		return;
	}

	const url = new URL(request.url);

	// Only handle same-origin requests
	if (url.origin !== self.location.origin) {
		return;
	}

	if (ASSETS.includes(url.pathname)) {
		event.respondWith(cacheFirst(request));
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request));
		return;
	}

	event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request: Request) {
	const cache = await caches.open(CACHE_NAME);
	const cachedResponse = await cache.match(request);
	if (cachedResponse) {
		return cachedResponse;
	}
	const response = await fetch(request);
	if (response && response.ok) {
		cache.put(request, response.clone());
	}
	return response;
}

async function networkFirst(request: Request) {
	const cache = await caches.open(CACHE_NAME);
	try {
		const response = await fetch(request);
		cache.put(request, response.clone());
		return response;
	} catch (error) {
		const cached = await cache.match(request);
		if (cached) {
			return cached;
		}
		const fallback = await cache.match('/offline.html');
		if (fallback) {
			return fallback;
		}
		throw error;
	}
}

async function staleWhileRevalidate(request: Request) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);
	const fetchPromise = fetch(request)
		.then((response) => {
			if (response && response.ok) {
				cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => undefined);

	return cached ?? (await fetchPromise) ?? (await networkFirst(request));
}
