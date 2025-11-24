import { get } from 'svelte/store';
import { apiHealthStore } from './stores/apiHealth';

type RegionPreference = 'auto' | 'us' | 'eu';

export interface ApiClusterTarget {
	name: string;
	baseUrl: string;
	weight: number;
	requiresProxy: boolean;
	category: 'auto-only';
}

export const ALL_API_TARGETS = [
	{
		name: 'new-squid',
		baseUrl: 'https://kraken.squid.wtf',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'squid-api',
		baseUrl: 'https://triton.squid.wtf',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'squid-api-2',
		baseUrl: 'https://zeus.squid.wtf',
		weight: 19,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'squid-api-3',
		baseUrl: 'https://aether.squid.wtf',
		weight: 19,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'phoenix',
		baseUrl: 'https://phoenix.squid.wtf',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'shiva',
		baseUrl: 'https://shiva.squid.wtf',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'chaos',
		baseUrl: 'https://chaos.squid.wtf',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'vercel-fastapi',
		baseUrl: 'https://tidal-api-2.binimum.org',
		weight: 1,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome-jakarta',
		baseUrl: 'https://jakarta.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome-california',
		baseUrl: 'https://california.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome-london',
		baseUrl: 'https://london.monochrome.tf',
		weight: 15,
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
		name: 'vogel',
		baseUrl: 'https://vogel.qqdl.site',
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
		name: 'monochrome',
		baseUrl: 'https://hifi.prigoana.com',
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
		name: 'monochrome-ohio',
		baseUrl: 'https://ohio.monochrome.tf',
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
	{
		name: 'monochrome-virginia',
		baseUrl: 'https://virginia.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome-frankfurt',
		baseUrl: 'https://frankfurt.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'monochrome-tokyo',
		baseUrl: 'https://tokyo.monochrome.tf',
		weight: 15,
		requiresProxy: false,
		category: 'auto-only'
	}
] satisfies ApiClusterTarget[];

const US_API_TARGETS = [
	{
		name: 'hund',
		baseUrl: 'https://hund.qqdl.site',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'katze',
		baseUrl: 'https://katze.qqdl.site',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'maus',
		baseUrl: 'https://maus.qqdl.site',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'vogel',
		baseUrl: 'https://vogel.qqdl.site',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	},
	{
		name: 'wolf',
		baseUrl: 'https://wolf.qqdl.site',
		weight: 20,
		requiresProxy: false,
		category: 'auto-only'
	}
] satisfies ApiClusterTarget[];

const TARGET_COLLECTIONS: Record<RegionPreference, ApiClusterTarget[]> = {
	auto: [...ALL_API_TARGETS],
	eu: [],
	us: [...US_API_TARGETS]
};

export const API_CONFIG = {
	targets: ALL_API_TARGETS,
	baseUrl: ALL_API_TARGETS[0]?.baseUrl ?? 'https://tidal.401658.xyz',
	useProxy: true,
	proxyUrl: '/api/proxy'
};

type WeightedTarget = ApiClusterTarget & { cumulativeWeight: number };

let weightedTargets: WeightedTarget[] | null = null;

function getActiveTargets(): ApiClusterTarget[] {
	const { healthyTargets, status } = get(apiHealthStore);
	if (healthyTargets.length > 0) {
		return healthyTargets;
	}

	if (status === 'complete') {
		return [];
	}

	return ALL_API_TARGETS;
}

function buildWeightedTargets(targets: ApiClusterTarget[]): WeightedTarget[] {
	let cumulative = 0;
	const collected: WeightedTarget[] = [];
	for (const target of targets) {
		cumulative += target.weight;
		collected.push({ ...target, cumulativeWeight: cumulative });
	}
	return collected;
}

function ensureWeightedTargets(): WeightedTarget[] {
	if (!weightedTargets) {
		weightedTargets = buildWeightedTargets(API_CONFIG.targets);
	}
	return weightedTargets;
}

export function selectApiTarget(): ApiClusterTarget {
	const targets = ensureWeightedTargets();
	return selectFromWeightedTargets(targets);
}

export function getPrimaryTarget(): ApiClusterTarget {
	return ensureWeightedTargets()[0];
}

function selectFromWeightedTargets(weighted: WeightedTarget[]): ApiClusterTarget {
	if (weighted.length === 0) {
		throw new Error('No API targets available for selection');
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

function stripTrailingSlash(path: string): string {
	if (path === '/') return path;
	return path.replace(/\/+$/, '') || '/';
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

function resolveUrl(url: string): URL {
	try {
		return new URL(url);
	} catch {
		const primaryTarget = getActiveTargets()[0] ?? ALL_API_TARGETS[0];
		return new URL(url, primaryTarget.baseUrl);
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

function shouldPreferPrimaryTarget(url: URL): boolean {
	const path = url.pathname.toLowerCase();

	// Prefer the primary target for endpoints that may require a legacy domain or specific handling
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

/**
 * Fetch with CORS handling
 */
export async function fetchWithCORS(url: string, options?: RequestInit): Promise<Response> {
	const activeTargets = getActiveTargets();
	if (activeTargets.length === 0) {
		throw new Error('All API endpoints are currently unavailable. Please try again later.');
	}

	// Handles relative URLs like "/track/123" by giving them a dummy base
	const originUrl = new URL(url, 'http://dummybase');

	const attemptOrder: ApiClusterTarget[] = [];

	if (shouldPreferPrimaryTarget(originUrl)) {
		const primary = getPrimaryTarget();
		if (activeTargets.some((t) => t.name === primary.name)) {
			attemptOrder.push(primary);
		}
	}

	const weightedActiveTargets = buildWeightedTargets(activeTargets);
	const selected = selectFromWeightedTargets(weightedActiveTargets);
	if (!attemptOrder.some((candidate) => candidate.name === selected.name)) {
		attemptOrder.push(selected);
	}

	for (const target of activeTargets) {
		if (!attemptOrder.some((candidate) => candidate.name === target.name)) {
			attemptOrder.push(target);
		}
	}

	let lastError: unknown = null;
	let lastResponse: Response | null = null;
	let lastUnexpectedResponse: Response | null = null;

	for (const target of attemptOrder) {
		const targetUrl = new URL(originUrl.pathname + originUrl.search + originUrl.hash, target.baseUrl);
		const finalUrl = target.requiresProxy
			? getProxiedUrl(targetUrl.toString())
			: targetUrl.toString();

		try {
			const response = await fetch(finalUrl, options);
			if (response.ok) {
				const unexpected = await isUnexpectedProxyResponse(response);
				if (!unexpected) {
					return response; // This is a genuine success.
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
				'CORS error detected'
			);
		}
		throw lastError;
	}

	throw new Error('All API targets failed without response');
}