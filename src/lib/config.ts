// CORS Proxy Configuration
// If you're experiencing CORS issues with the HIFI API, you can set up a proxy

type RegionPreference = 'auto' | 'us' | 'eu';

export interface ApiClusterTarget {
	name: string;
	baseUrl: string;
	weight: number;
	requiresProxy: boolean;
	category: 'auto-only';
}

const V2_API_TARGETS = [
	{
		name: 'squid-api',
		baseUrl: 'https://triton.squid.wtf',
		weight: 60,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'kinoplus',
		baseUrl: 'https://tidal.kinoplus.online',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'binimum',
		baseUrl: 'https://tidal-api.binimum.org',
		weight: 10,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'binimum-2',
		baseUrl: 'https://tidal-api-2.binimum.org',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
] satisfies ApiClusterTarget[];

const ALL_API_TARGETS = [
	{
		name: 'monochrome-california',
		baseUrl: 'https://california.monochrome.tf',
		weight: 40,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'hund',
		baseUrl: 'https://hund.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'katze',
		baseUrl: 'https://katze.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'maus',
		baseUrl: 'https://maus.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'wolf',
		baseUrl: 'https://wolf.qqdl.site',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome-singapore',
		baseUrl: 'https://singapore.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome-oregon',
		baseUrl: 'https://oregon.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
] satisfies ApiClusterTarget[];
const US_API_TARGETS = [] satisfies ApiClusterTarget[];
const TARGET_COLLECTIONS: Record<RegionPreference, ApiClusterTarget[]> = {
	auto: [...ALL_API_TARGETS],
	eu: [],
	us: [...US_API_TARGETS]
};

const TARGETS = TARGET_COLLECTIONS.auto;

export const API_CONFIG = {
	// Cluster of target endpoints for load distribution and redundancy
	targets: TARGETS,
	baseUrl: TARGETS[0]?.baseUrl ?? 'https://tidal.401658.xyz',
	// Proxy configuration for endpoints that need it
	useProxy: true,
	proxyUrl: '/api/proxy'
};

type WeightedTarget = ApiClusterTarget & { cumulativeWeight: number };

let v1WeightedTargets: WeightedTarget[] | null = null;
let v2WeightedTargets: WeightedTarget[] | null = null;

function buildWeightedTargets(targets: ApiClusterTarget[]): WeightedTarget[] {
	const validTargets = targets.filter((target) => {
		if (!target?.baseUrl || typeof target.baseUrl !== 'string') {
			return false;
		}
		if (target.weight <= 0) {
			return false;
		}
		try {
			new URL(target.baseUrl);
			return true;
		} catch (error) {
			console.error(`Invalid API target URL for ${target.name}:`, error);
			return false;
		}
	});

	if (validTargets.length === 0) {
		throw new Error('No valid API targets configured');
	}

	let cumulative = 0;
	const collected: WeightedTarget[] = [];
	for (const target of validTargets) {
		cumulative += target.weight;
		collected.push({ ...target, cumulativeWeight: cumulative });
	}
	return collected;
}

function ensureWeightedTargets(apiVersion: 'v1' | 'v2' = 'v1'): WeightedTarget[] {
	if (apiVersion === 'v2') {
		if (!v2WeightedTargets) {
			v2WeightedTargets = buildWeightedTargets(V2_API_TARGETS);
		}
		return v2WeightedTargets;
	} else {
		if (!v1WeightedTargets) {
			// v1 includes ALL_API_TARGETS (v1) + V2_API_TARGETS (fallback with low weight)
			const v2Fallback = V2_API_TARGETS.map((t) => ({ ...t, weight: 1 }));
			v1WeightedTargets = buildWeightedTargets([...ALL_API_TARGETS, ...v2Fallback]);
		}
		return v1WeightedTargets;
	}
}

export function selectApiTarget(apiVersion: 'v1' | 'v2' = 'v1'): ApiClusterTarget {
	const targets = ensureWeightedTargets(apiVersion);
	return selectFromWeightedTargets(targets);
}

export function getPrimaryTarget(apiVersion: 'v1' | 'v2' = 'v1'): ApiClusterTarget {
	return ensureWeightedTargets(apiVersion)[0];
}

function selectFromWeightedTargets(weighted: WeightedTarget[]): ApiClusterTarget {
	if (weighted.length === 0) {
		throw new Error('No weighted targets available for selection');
	}

	const totalWeight = weighted[weighted.length - 1]?.cumulativeWeight ?? 0;
	if (totalWeight <= 0) {
		return weighted[0];
	}

	const random = Math.random() * totalWeight;
	for (const target of weighted) {
		if (random < target.cumulativeWeight) {
			return target;
		}
	}

	return weighted[0];
}

export function getTargetsForRegion(region: RegionPreference = 'auto'): ApiClusterTarget[] {
	const targets = TARGET_COLLECTIONS[region];
	return Array.isArray(targets) ? targets : [];
}

export function selectApiTargetForRegion(region: RegionPreference): ApiClusterTarget {
	if (region === 'auto') {
		return selectApiTarget();
	}

	const targets = getTargetsForRegion(region);
	if (targets.length === 0) {
		return selectApiTarget();
	}

	const weighted = buildWeightedTargets(targets);
	return selectFromWeightedTargets(weighted);
}

export function hasRegionTargets(region: RegionPreference): boolean {
	if (region === 'auto') {
		return TARGET_COLLECTIONS.auto.length > 0;
	}

	return getTargetsForRegion(region).length > 0;
}

function parseTargetBase(target: ApiClusterTarget): URL | null {
	try {
		return new URL(target.baseUrl);
	} catch (error) {
		console.error(`Invalid API target base URL for ${target.name}:`, error);
		return null;
	}
}

function getBaseApiUrl(target?: ApiClusterTarget): URL | null {
	const chosen = target ?? getPrimaryTarget();
	return parseTargetBase(chosen);
}

function stripTrailingSlash(path: string): string {
	if (path === '/') return path;
	return path.replace(/\/+$/, '') || '/';
}

function combinePaths(basePath: string, relativePath: string): string {
	const trimmedBase = stripTrailingSlash(basePath || '/');
	const normalizedRelative = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
	if (trimmedBase === '/' || trimmedBase === '') {
		return normalizedRelative;
	}
	if (normalizedRelative === '/') {
		return `${trimmedBase}/`;
	}
	return `${trimmedBase}${normalizedRelative}`;
}

function getRelativePath(url: URL, targetBase: URL): string {
	const basePath = stripTrailingSlash(targetBase.pathname || '/');
	const currentPath = url.pathname || '/';
	if (basePath === '/' || basePath === '') {
		return currentPath.startsWith('/') ? currentPath : `/${currentPath}`;
	}
	if (!currentPath.startsWith(basePath)) {
		return currentPath;
	}
	const relative = currentPath.slice(basePath.length);
	if (!relative) {
		return '/';
	}
	return relative.startsWith('/') ? relative : `/${relative}`;
}

function matchesTarget(url: URL, target: ApiClusterTarget): boolean {
	const base = parseTargetBase(target);
	if (!base) {
		return false;
	}

	if (url.origin !== base.origin) {
		return false;
	}

	const basePath = stripTrailingSlash(base.pathname || '/');
	if (basePath === '/' || basePath === '') {
		return true;
	}

	const targetPath = stripTrailingSlash(url.pathname || '/');
	return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
}

function findTargetForUrl(url: URL): ApiClusterTarget | null {
	for (const target of API_CONFIG.targets) {
		if (matchesTarget(url, target)) {
			return target;
		}
	}
	return null;
}

export function isProxyTarget(url: URL): boolean {
	const target = findTargetForUrl(url);
	return target?.requiresProxy === true;
}

function shouldPreferPrimaryTarget(url: URL): boolean {
	const path = url.pathname.toLowerCase();

	// Prefer the proxied primary target for endpoints that routinely require the legacy domain
	if (path.includes('/album/') || path.includes('/artist/') || path.includes('/playlist/')) {
		return true;
	}

	if (path.includes('/search/')) {
		const params = url.searchParams;
		if (params.has('a') || params.has('al') || params.has('p')) {
			return true;
		}
	}

	return false;
}

function resolveUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		const baseApiUrl = getBaseApiUrl();
		if (!baseApiUrl) {
			return null;
		}

		try {
			return new URL(url, baseApiUrl);
		} catch {
			return null;
		}
	}
}

/**
 * Create a proxied URL if needed
 */
export function getProxiedUrl(url: string): string {
	if (!API_CONFIG.useProxy || !API_CONFIG.proxyUrl) {
		return url;
	}

	const targetUrl = resolveUrl(url);
	if (!targetUrl) {
		return url;
	}

	if (!isProxyTarget(targetUrl)) {
		return url;
	}

	return `${API_CONFIG.proxyUrl}?url=${encodeURIComponent(targetUrl.toString())}`;
}

function isLikelyProxyErrorEntry(entry: unknown): boolean {
	if (!entry || typeof entry !== 'object') {
		return false;
	}

	const record = entry as Record<string, unknown>;
	const status = typeof record.status === 'number' ? record.status : undefined;
	const subStatus = typeof record.subStatus === 'number' ? record.subStatus : undefined;
	const userMessage = typeof record.userMessage === 'string' ? record.userMessage : undefined;
	const detail = typeof record.detail === 'string' ? record.detail : undefined;

	if (typeof status === 'number' && status >= 400) {
		return true;
	}

	if (typeof subStatus === 'number' && subStatus >= 400) {
		return true;
	}

	const tokenPattern = /(token|invalid|unauthorized)/i;
	if (userMessage && tokenPattern.test(userMessage)) {
		return true;
	}

	if (detail && tokenPattern.test(detail)) {
		return true;
	}

	return false;
}

function isLikelyProxyErrorPayload(payload: unknown): boolean {
	if (Array.isArray(payload)) {
		return payload.some((entry) => isLikelyProxyErrorEntry(entry));
	}

	if (payload && typeof payload === 'object') {
		return isLikelyProxyErrorEntry(payload);
	}

	return false;
}

async function isUnexpectedProxyResponse(response: Response): Promise<boolean> {
	if (!response.ok) {
		return false;
	}

	const contentType = response.headers.get('content-type');
	if (!contentType || !contentType.toLowerCase().includes('application/json')) {
		return false;
	}

	try {
		const payload = await response.clone().json();
		return isLikelyProxyErrorPayload(payload);
	} catch {
		return false;
	}
}

function isV2Target(target: ApiClusterTarget): boolean {
	return V2_API_TARGETS.some((t) => t.name === target.name);
}

/**
 * Fetch with CORS handling
 */
export async function fetchWithCORS(
	url: string,
	options?: RequestInit & { apiVersion?: 'v1' | 'v2'; preferredQuality?: string }
): Promise<Response> {
	const resolvedUrl = resolveUrl(url);
	if (!resolvedUrl) {
		throw new Error(`Unable to resolve URL: ${url}`);
	}

	const originTarget = findTargetForUrl(resolvedUrl);
	if (!originTarget) {
		return fetch(getProxiedUrl(resolvedUrl.toString()), {
			...options
		});
	}

	const apiVersion = options?.apiVersion ?? 'v1';
	const weightedTargets = ensureWeightedTargets(apiVersion);
	const attemptOrder: ApiClusterTarget[] = [];
	if (shouldPreferPrimaryTarget(resolvedUrl)) {
		const primary = getPrimaryTarget(apiVersion);
		if (!attemptOrder.some((candidate) => candidate.name === primary.name)) {
			attemptOrder.push(primary);
		}
	}

	const selected = selectApiTarget(apiVersion);
	if (!attemptOrder.some((candidate) => candidate.name === selected.name)) {
		attemptOrder.push(selected);
	}

	for (const target of weightedTargets) {
		if (!attemptOrder.some((candidate) => candidate.name === target.name)) {
			attemptOrder.push(target);
		}
	}

	let uniqueTargets = attemptOrder.filter(
		(target, index, array) => array.findIndex((entry) => entry.name === target.name) === index
	);

	if (uniqueTargets.length === 0) {
		uniqueTargets = [getPrimaryTarget(apiVersion)];
	}

	const originBase = parseTargetBase(originTarget);
	if (!originBase) {
		throw new Error('Invalid origin target configuration.');
	}

	const totalAttempts = Math.max(3, uniqueTargets.length);
	let lastError: unknown = null;
	let lastResponse: Response | null = null;
	let lastUnexpectedResponse: Response | null = null;

	for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
		const target = uniqueTargets[attempt % uniqueTargets.length];
		const targetBase = parseTargetBase(target);
		if (!targetBase) {
			continue;
		}

		const relativePath = getRelativePath(resolvedUrl, originBase);
		const rewrittenPath = combinePaths(targetBase.pathname || '/', relativePath);
		const rewrittenUrl = new URL(
			rewrittenPath + resolvedUrl.search + resolvedUrl.hash,
			targetBase.origin
		);

		// If we are falling back to a v2 target and have a preferred quality (e.g. HI_RES_LOSSLESS),
		// upgrade the quality parameter in the URL.
		if (
			isV2Target(target) &&
			options?.preferredQuality &&
			rewrittenUrl.searchParams.has('quality')
		) {
			rewrittenUrl.searchParams.set('quality', options.preferredQuality);
		}

		const finalUrl = getProxiedUrl(rewrittenUrl.toString());

		try {
			const response = await fetch(finalUrl, {
				...options
			});
			if (response.ok) {
				const unexpected = await isUnexpectedProxyResponse(response);
				if (!unexpected) {
					return response;
				}
				lastUnexpectedResponse = response;
				continue;
			}

			lastResponse = response;
		} catch (error) {
			lastError = error;
			if (error instanceof TypeError && error.message.includes('CORS')) {
				continue;
			}
		}
	}

	if (lastUnexpectedResponse) {
		return lastUnexpectedResponse;
	}

	if (lastResponse) {
		return lastResponse;
	}

	if (lastError) {
		if (
			lastError instanceof TypeError &&
			typeof lastError.message === 'string' &&
			lastError.message.includes('CORS')
		) {
			throw new Error(
				'CORS error detected. Please configure a proxy in src/lib/config.ts or enable CORS on your backend.'
			);
		}
		throw lastError;
	}

	throw new Error('All API targets failed without response.');
}
