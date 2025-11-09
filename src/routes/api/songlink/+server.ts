import { json, type RequestHandler } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { getRedisClient } from '$lib/server/redis';
import type Redis from 'ioredis';

const CACHE_NAMESPACE = 'songlink:v1:';
const CACHE_TTL_SECONDS = 2_592_000; // 30 days
const SONGLINK_API_BASE = 'https://api.song.link/v1-alpha.1/links';
const SONGLINK_BACKUP_API_BASE = 'https://tracks.monochrome.tf/api/links';

interface SonglinkQuery {
	url: string;
	userCountry?: string;
	songIfSingle?: boolean;
	platform?: string;
	type?: string;
	id?: string;
	key?: string;
}

interface CachedEntry {
	data: unknown;
	timestamp: number;
}

function createCacheKey(params: SonglinkQuery): string {
	const keyMaterial = JSON.stringify(params);
	const hash = createHash('sha256').update(keyMaterial).digest('hex');
	return `${CACHE_NAMESPACE}${hash}`;
}

function buildSonglinkUrl(params: SonglinkQuery, useBackup: boolean = false): string {
	const url = new URL(useBackup ? SONGLINK_BACKUP_API_BASE : SONGLINK_API_BASE);
	url.searchParams.set('url', params.url);

	if (params.userCountry) {
		url.searchParams.set('userCountry', params.userCountry);
	}
	if (params.songIfSingle !== undefined) {
		url.searchParams.set('songIfSingle', params.songIfSingle.toString());
	}
	if (params.platform) {
		url.searchParams.set('platform', params.platform);
	}
	if (params.type) {
		url.searchParams.set('type', params.type);
	}
	if (params.id) {
		url.searchParams.set('id', params.id);
	}
	if (params.key) {
		url.searchParams.set('key', params.key);
	}

	return url.toString();
}

async function readCachedEntry(redis: Redis, key: string): Promise<unknown | null> {
	try {
		const raw = await redis.get(key);
		if (!raw) return null;

		const parsed = JSON.parse(raw) as CachedEntry;
		const age = Date.now() - parsed.timestamp;

		// Check if cache entry is still valid (within TTL)
		if (age > CACHE_TTL_SECONDS * 1000) {
			await redis.del(key); // Clean up expired entry
			return null;
		}

		return parsed.data;
	} catch (error) {
		console.error('Failed to read Songlink cache entry:', error);
		return null;
	}
}

async function writeCachedEntry(redis: Redis, key: string, data: unknown): Promise<void> {
	try {
		const entry: CachedEntry = {
			data,
			timestamp: Date.now()
		};
		await redis.set(key, JSON.stringify(entry), 'EX', CACHE_TTL_SECONDS);
	} catch (error) {
		console.error('Failed to store Songlink cache entry:', error);
	}
}

export const GET: RequestHandler = async ({ url, request, fetch }) => {
	const origin = request.headers.get('origin');

	// Build query params
	const params: SonglinkQuery = {
		url: url.searchParams.get('url') || '',
		userCountry: url.searchParams.get('userCountry') || undefined,
		songIfSingle: url.searchParams.get('songIfSingle') === 'true' ? true : undefined,
		platform: url.searchParams.get('platform') || undefined,
		type: url.searchParams.get('type') || undefined,
		id: url.searchParams.get('id') || undefined,
		key: url.searchParams.get('key') || undefined
	};

	// Validate required parameter
	if (!params.url) {
		return json(
			{ error: 'Missing required parameter: url' },
			{
				status: 400,
				headers: {
					'Access-Control-Allow-Origin': origin || '*',
					'Cache-Control': 'no-cache'
				}
			}
		);
	}

	// Check cache first
	const redis = getRedisClient();
	const cacheKey = createCacheKey(params);

	if (redis) {
		const cached = await readCachedEntry(redis, cacheKey);
		if (cached) {
			return json(cached, {
				headers: {
					'Access-Control-Allow-Origin': origin || '*',
					'Cache-Control': 'public, max-age=2592000',
					'X-Cache': 'HIT'
				}
			});
		}
	}

	// Fetch from Songlink API
	const songlinkUrl = buildSonglinkUrl(params);

	try {
		const response = await fetch(songlinkUrl, {
			headers: {
				'User-Agent': 'BiniTidal/1.0',
				Accept: 'application/json'
			}
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.warn('Primary Songlink API failed:', response.status, errorText);
			
			// Try backup API
			console.log('Attempting backup Songlink API...');
			const backupUrl = buildSonglinkUrl(params, true);
			
			const backupResponse = await fetch(backupUrl, {
				headers: {
					'User-Agent': 'BiniTidal/1.0',
					Accept: 'application/json'
				}
			});
			
			if (!backupResponse.ok) {
				const backupErrorText = await backupResponse.text();
				console.error('Backup Songlink API also failed:', backupResponse.status, backupErrorText);
				
				return json(
					{
						error: 'Both Songlink APIs failed',
						primaryStatus: response.status,
						backupStatus: backupResponse.status,
						message: backupErrorText
					},
					{
						status: backupResponse.status,
						headers: {
							'Access-Control-Allow-Origin': origin || '*',
							'Cache-Control': 'no-cache'
						}
					}
				);
			}
			
			const backupData = await backupResponse.json();
			
			// Cache the successful backup response
			if (redis) {
				await writeCachedEntry(redis, cacheKey, backupData);
			}
			
			return json(backupData, {
				headers: {
					'Access-Control-Allow-Origin': origin || '*',
					'Cache-Control': 'public, max-age=2592000',
					'X-Cache': 'MISS',
					'X-Songlink-Source': 'backup'
				}
			});
		}

		const data = await response.json();

		// Cache the successful response
		if (redis) {
			await writeCachedEntry(redis, cacheKey, data);
		}

		return json(data, {
			headers: {
				'Access-Control-Allow-Origin': origin || '*',
				'Cache-Control': 'public, max-age=2592000',
				'X-Cache': 'MISS',
				'X-Songlink-Source': 'primary'
			}
		});
	} catch (error) {
		console.error('Songlink API fetch error:', error);
		
		// Try backup API as last resort
		try {
			console.log('Primary API threw exception, trying backup...');
			const backupUrl = buildSonglinkUrl(params, true);
			
			const backupResponse = await fetch(backupUrl, {
				headers: {
					'User-Agent': 'BiniTidal/1.0',
					Accept: 'application/json'
				}
			});
			
			if (!backupResponse.ok) {
				throw new Error(`Backup API returned ${backupResponse.status}`);
			}
			
			const backupData = await backupResponse.json();
			
			// Cache the successful backup response
			if (redis) {
				await writeCachedEntry(redis, cacheKey, backupData);
			}
			
			return json(backupData, {
				headers: {
					'Access-Control-Allow-Origin': origin || '*',
					'Cache-Control': 'public, max-age=2592000',
					'X-Cache': 'MISS',
					'X-Songlink-Source': 'backup-fallback'
				}
			});
		} catch (backupError) {
			console.error('Backup Songlink API also failed:', backupError);
			
			return json(
				{
					error: 'Failed to fetch from both Songlink APIs',
					primaryError: error instanceof Error ? error.message : 'Unknown error',
					backupError: backupError instanceof Error ? backupError.message : 'Unknown error'
				},
				{
					status: 502,
					headers: {
						'Access-Control-Allow-Origin': origin || '*',
						'Cache-Control': 'no-cache'
					}
				}
			);
		}
	}
};

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');

	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': origin || '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Max-Age': '86400'
		}
	});
};
