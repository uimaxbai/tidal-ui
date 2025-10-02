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
	useProxy: false,
	
	// Your proxy endpoint (if using custom backend)
	proxyUrl: '/api/proxy'
};

/**
 * Create a proxied URL if needed
 */
export function getProxiedUrl(url: string): string {
	if (API_CONFIG.useProxy && API_CONFIG.proxyUrl) {
		return `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(url)}`;
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
			...options,
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
