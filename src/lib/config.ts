// CORS Proxy Configuration
// If you're experiencing CORS issues with the HIFI API, you can set up a proxy

export const API_CONFIG = {
	// Default HIFI API endpoint
	baseUrl: 'https://tidal.401658.xyz',

	// If you're running into CORS issues, you can:
	// 1. Use a CORS proxy (not recommended for production)
	// 2. Set up your own backend proxy
	// 3. Use a serverless function as a proxy

	// Example with CORS proxy (development only):
	// baseUrl: 'https://corsproxy.io/?https://tidal.401658.xyz',

	// Example with custom backend:
	// baseUrl: '/api/tidal',

	// Enable this if you're using a custom proxy
	useProxy: true,

	// Your proxy endpoint (if using custom backend)
	proxyUrl: '/api/proxy',

	// Additional hosts that may be proxied (prefixed with '.' matches subdomains)
	proxyAllowedHosts: ['tidal.401658.xyz', '.tidal.com', '.tidalhifi.com']
};

const PROXY_HOST_CACHE = new Map<string, boolean>();

function getBaseHostname(): string | null {
	try {
		return new URL(API_CONFIG.baseUrl).hostname;
	} catch (error) {
		console.error('Invalid API base URL configuration:', error);
		return null;
	}
}

export function isProxyAllowedHost(hostname: string): boolean {
	if (!hostname) return false;

	if (PROXY_HOST_CACHE.has(hostname)) {
		return PROXY_HOST_CACHE.get(hostname) ?? false;
	}

	const baseHostname = getBaseHostname();
	if (baseHostname && hostname === baseHostname) {
		PROXY_HOST_CACHE.set(hostname, true);
		return true;
	}

	const allowedHosts = API_CONFIG.proxyAllowedHosts ?? [];
	const isAllowed = allowedHosts.some((entry) => {
		if (!entry) return false;
		if (entry.startsWith('.')) {
			const suffix = entry.slice(1);
			return hostname === suffix || hostname.endsWith(entry);
		}
		return hostname === entry;
	});

	PROXY_HOST_CACHE.set(hostname, isAllowed);
	return isAllowed;
}

/**
 * Create a proxied URL if needed
 */
export function getProxiedUrl(url: string): string {
	if (!API_CONFIG.useProxy || !API_CONFIG.proxyUrl) {
		return url;
	}

	try {
		const targetUrl = new URL(url);
		if (isProxyAllowedHost(targetUrl.hostname)) {
			return `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(targetUrl.toString())}`;
		}
	} catch (error) {
		// If the URL is relative or invalid, fall through without proxying
	}

	return url;
}

/**
 * Fetch with CORS handling
 */
export async function fetchWithCORS(url: string, options?: RequestInit): Promise<Response> {
	const proxiedUrl = getProxiedUrl(url);

	try {
		return await fetch(proxiedUrl, {
			...options
			// Add credentials if needed
			// credentials: 'include',
		});
	} catch (error) {
		if (error instanceof TypeError && error.message.includes('CORS')) {
			throw new Error(
				'CORS error detected. Please configure a proxy in src/lib/config.ts or enable CORS on your backend.'
			);
		}
		throw error;
	}
}
