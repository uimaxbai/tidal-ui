import { json, type RequestHandler } from '@sveltejs/kit';

const SONGLINK_API_BASE = 'https://api.song.link/v1-alpha.1/links';
const SONGLINK_BACKUP_API_BASE = 'https://tracks.monochrome.tf/api/links';

// We keep the browser cache high (30 days) to reduce load on your server
// since we no longer have a server-side Redis cache.
const BROWSER_CACHE_TTL = 2_592_000;

interface SonglinkQuery {
	url: string;
	userCountry?: string;
	songIfSingle?: boolean;
	platform?: string;
	type?: string;
	id?: string;
	key?: string;
	preferBackup?: boolean;
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
		key: url.searchParams.get('key') || undefined,
		preferBackup: url.searchParams.get('preferBackup') === 'true' ? true : undefined
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

	// Fetch from Songlink API
	// Default to 50/50 split for load balancing if no preference is specified
	const useRandomBackup = Math.random() < 0.5;

	// If preferBackup is explicitly true, try backup first.
	// Otherwise, rely on the 50/50 random split.
	const shouldTryBackupFirst = params.preferBackup === true ? true : useRandomBackup;

	const primaryUrl = buildSonglinkUrl(params, false);
	const backupUrl = buildSonglinkUrl(params, true);

	try {
		const firstUrl = shouldTryBackupFirst ? backupUrl : primaryUrl;
		const firstSource = shouldTryBackupFirst ? 'backup' : 'primary';

		const response = await fetch(firstUrl, {
			headers: {
				'User-Agent': 'BiniTidal/1.0',
				Accept: 'application/json'
			}
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.warn(`${firstSource} Songlink API failed:`, response.status, errorText);

			// Try the other API
			const secondUrl = shouldTryBackupFirst ? primaryUrl : backupUrl;
			const secondSource = shouldTryBackupFirst ? 'primary' : 'backup';
			console.log(`Attempting ${secondSource} Songlink API...`);

			const backupResponse = await fetch(secondUrl, {
				headers: {
					'User-Agent': 'BiniTidal/1.0',
					Accept: 'application/json'
				}
			});

			if (!backupResponse.ok) {
				const backupErrorText = await backupResponse.text();
				console.error(
					`${secondSource} Songlink API also failed:`,
					backupResponse.status,
					backupErrorText
				);

				return json(
					{
						error: 'Both Songlink APIs failed',
						primaryStatus: shouldTryBackupFirst ? backupResponse.status : response.status,
						backupStatus: shouldTryBackupFirst ? response.status : backupResponse.status,
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

			return json(backupData, {
				headers: {
					'Access-Control-Allow-Origin': origin || '*',
					'Cache-Control': `public, max-age=${BROWSER_CACHE_TTL}`,
					'X-Songlink-Source': secondSource
				}
			});
		}

		const data = await response.json();

		return json(data, {
			headers: {
				'Access-Control-Allow-Origin': origin || '*',
				'Cache-Control': `public, max-age=${BROWSER_CACHE_TTL}`,
				'X-Songlink-Source': firstSource
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

			return json(backupData, {
				headers: {
					'Access-Control-Allow-Origin': origin || '*',
					'Cache-Control': `public, max-age=${BROWSER_CACHE_TTL}`,
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
