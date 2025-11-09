import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import crypto from 'crypto';

// Browser version for headers
const BROWSER_VERSION = '131';

// Common headers for Spotify requests
const COMMON_HEADERS = {
	'Content-Type': 'application/json',
	'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${BROWSER_VERSION}.0.0.0 Safari/537.36`,
	'Sec-Ch-Ua': `"Chromium";v="${BROWSER_VERSION}", "Not(A:Brand";v="24", "Google Chrome";v="${BROWSER_VERSION}"`
};

// Fallback secret (from SpotAPI code)
const FALLBACK_SECRET = [70, 60, 33, 57, 92, 120, 90, 33, 32, 62, 62, 55, 126, 93, 66, 35, 108, 68];

// Function to fetch latest secret
async function getLatestTotpSecret() {
	try {
		const response = await fetch('https://code.thetadev.de/ThetaDev/spotify-secrets/raw/branch/main/secrets/secretDict.json', {
			headers: COMMON_HEADERS
		});
		const secrets = await response.json();
		const version = Math.max(...Object.keys(secrets).map(Number));
		return { version, secret: secrets[version] };
	} catch (e) {
		console.error('Failed to fetch secrets, using fallback');
		return { version: 18, secret: FALLBACK_SECRET };
	}
}

// Generate TOTP
function generateTotp(secret: number[]) {
	const transformed = secret.map((e, t) => e ^ ((t % 33) + 9));
	const joined = transformed.map(num => num.toString()).join('');
	const hexStr = Buffer.from(joined, 'ascii').toString('hex');
	const base32Secret = Buffer.from(hexStr, 'hex').toString('base64').replace(/=/g, '');
	
	// Simple TOTP generation (using crypto for HMAC)
	const timeStep = Math.floor(Date.now() / 1000 / 30);
	const timeHex = timeStep.toString(16).padStart(16, '0');
	const hmac = crypto.createHmac('sha1', Buffer.from(base32Secret, 'base64'));
	hmac.update(Buffer.from(timeHex, 'hex'));
	const digest = hmac.digest();
	const offset = digest[19] & 0xf;
	const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
	return code.toString().padStart(6, '0');
}

// Extract all JavaScript links from HTML
function extractJsLinks(html: string): string[] {
	const jsLinks: string[] = [];
	const scriptTagRegex = /<script[^>]+src="([^"]+\.js)"[^>]*>/g;
	let match;
	
	while ((match = scriptTagRegex.exec(html)) !== null) {
		jsLinks.push(match[1]);
	}
	
	return jsLinks;
}

// Get session and extract data
async function getSessionData() {
	const response = await fetch('https://open.spotify.com', {
		headers: COMMON_HEADERS
	});
	const html = await response.text();
	const cookie = response.headers.get('set-cookie')?.match(/sp_t=([^;]+)/)?.[1] || '';
	
	// Extract base64-encoded appServerConfig
	const appServerConfigMatch = html.match(
		/<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/
	);
	
	let clientVersion = '';
	if (appServerConfigMatch) {
		try {
			const base64Config = appServerConfigMatch[1];
			const decodedConfig = Buffer.from(base64Config, 'base64').toString('utf-8');
			const serverConfig = JSON.parse(decodedConfig);
			clientVersion = serverConfig.clientVersion || '';
		} catch (e) {
			console.error('Failed to parse appServerConfig, falling back to regex');
			// Fallback to old method if parsing fails
			clientVersion = html.match(/"clientVersion":"([^"]+)"/)?.[1] || '';
		}
	} else {
		// Fallback to old method if appServerConfig not found
		clientVersion = html.match(/"clientVersion":"([^"]+)"/)?.[1] || '';
	}
	
	// Extract all JS links and find the web-player one
	const allJsLinks = extractJsLinks(html);
	const jsPackRelative = allJsLinks.find(
		link => link.includes('web-player/web-player') && link.endsWith('.js')
	) || '';
	const jsPack = jsPackRelative.startsWith('http') 
		? jsPackRelative 
		: `https://open.spotify.com${jsPackRelative}`;
	
	return { deviceId: cookie, clientVersion, jsPack };
}

// Get access token
async function getAccessToken(totp: string, totpVer: number) {
	const params = new URLSearchParams({
		reason: 'init',
		productType: 'web-player',
		totp,
		totpVer: totpVer.toString(),
		totpServer: totp
	});
	const response = await fetch(`https://open.spotify.com/api/token?${params}`, {
		headers: COMMON_HEADERS
	});
	const data = await response.json();
	return { accessToken: data.accessToken, clientId: data.clientId };
}

// Get client token
async function getClientToken(clientVersion: string, clientId: string, deviceId: string) {
	const payload = {
		client_data: {
			client_version: clientVersion,
			client_id: clientId,
			js_sdk_data: {
				device_brand: 'unknown',
				device_model: 'unknown',
				os: 'windows',
				os_version: 'NT 10.0',
				device_id: deviceId,
				device_type: 'computer'
			}
		}
	};
	const response = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
		method: 'POST',
		headers: {
			...COMMON_HEADERS,
            "Authority": "clienttoken.spotify.com",
			'Accept': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	const data = await response.json();
	return data.granted_token.token;
}

// Extract mappings from JS code
function extractMappings(jsCode: string): [Record<string, string>, Record<string, string>] {
	// Pattern to match objects like: {123:"value",456:"another"}
	const pattern = /\{\d+:"[^"]+"(?:,\d+:"[^"]+")*\}/g;
	const matches = jsCode.match(pattern);
	
	if (!matches || matches.length < 5) {
		console.warn(`Found only ${matches?.length || 0} mappings, need at least 5`);
		return [{}, {}];
	}
	
	// Parse the 4th match (index 3) as mapping1 (chunk names)
	const mapping1: Record<string, string> = {};
	const match3 = matches[3];
	const entries3 = match3.slice(1, -1).split(/,(?=\d+:)/);
	
	for (const entry of entries3) {
		const colonIndex = entry.indexOf(':');
		if (colonIndex === -1) continue;
		
		const key = entry.substring(0, colonIndex).trim();
		const value = entry.substring(colonIndex + 1).trim().replace(/^"|"$/g, '');
		mapping1[key] = value;
	}
	
	// Parse the 5th match (index 4) as mapping2 (chunk hashes)
	const mapping2: Record<string, string> = {};
	const match4 = matches[4];
	const entries4 = match4.slice(1, -1).split(/,(?=\d+:)/);
	
	for (const entry of entries4) {
		const colonIndex = entry.indexOf(':');
		if (colonIndex === -1) continue;
		
		const key = entry.substring(0, colonIndex).trim();
		const value = entry.substring(colonIndex + 1).trim().replace(/^"|"$/g, '');
		mapping2[key] = value;
	}
	
	return [mapping1, mapping2];
}

// Combine chunks from mappings
function combineChunks(strMapping: Record<string, string>, hashMapping: Record<string, string>): string[] {
	const chunks: string[] = [];
	for (const [key, str] of Object.entries(strMapping)) {
		const hash = hashMapping[key];
		if (hash) {
			chunks.push(`${str}.${hash}.js`);
		}
	}
	return chunks;
}

// Get sha256 hash
async function getSha256Hash(jsPack: string): Promise<string> {
	if (!jsPack) {
		console.warn('No JS pack URL, using fallback hash');
		return 'a67612f8c59f4cb4a9723d8e0e0e7b7cb8c5c3d45e3d8c4f5e6f7e8f9a0b1c2d';
	}
	
	try {
		// Fetch the main JS pack
		const response = await fetch(jsPack, {
			headers: COMMON_HEADERS
		});
		let rawHashes = await response.text();
		
		// Extract mappings and combine chunks
		const [strMapping, hashMapping] = extractMappings(rawHashes);
		const chunks = combineChunks(strMapping, hashMapping);
		
		// Fetch additional chunks
		for (const chunk of chunks) {
			const chunkUrl = `https://open.spotifycdn.com/cdn/build/web-player/${chunk}`;
			try {
				const chunkResponse = await fetch(chunkUrl, {
					headers: COMMON_HEADERS
				});
				rawHashes += await chunkResponse.text();
			} catch (e) {
				console.warn(`Failed to fetch chunk ${chunk}:`, e);
			}
		}
		
		// Extract the fetchPlaylist hash
		let hash = '';
		try {
			// Try as query first
			hash = rawHashes.split('"fetchPlaylist","query","')[1].split('"')[0];
		} catch (e) {
			try {
				// Try as mutation
				hash = rawHashes.split('"fetchPlaylist","mutation","')[1].split('"')[0];
			} catch (e2) {
				console.warn('Failed to extract fetchPlaylist hash, using fallback');
				hash = 'a67612f8c59f4cb4a9723d8e0e0e7b7cb8c5c3d45e3d8c4f5e6f7e8f9a0b1c2d';
			}
		}
		return hash;
	} catch (error) {
		console.error('Failed to get sha256 hash:', error);
		return 'a67612f8c59f4cb4a9723d8e0e0e7b7cb8c5c3d45e3d8c4f5e6f7e8f9a0b1c2d';
	}
}

// Fetch playlist data
async function fetchPlaylist(
	accessToken: string,
	clientToken: string,
	clientVersion: string,
	playlistId: string,
	jsPack: string,
	offset = 0,
	limit = 25
) {
	const sha256Hash = await getSha256Hash(jsPack);
	const variables = {
		uri: `spotify:playlist:${playlistId}`,
		offset,
		limit,
		enableWatchFeedEntrypoint: false
	};
	const extensions = {
		persistedQuery: {
			version: 1,
			sha256Hash
		}
	};
	const params = JSON.stringify({
		operationName: 'fetchPlaylist',
		variables,
		extensions
	});
	console.log(params);
	const response = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', {
		method: 'POST',
		headers: {
			'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${BROWSER_VERSION}.0.0.0 Safari/537.36`,
			'Sec-Ch-Ua': `"Chromium";v="${BROWSER_VERSION}", "Not(A:Brand";v="24", "Google Chrome";v="${BROWSER_VERSION}"`,
			'Authorization': `Bearer ${accessToken}`,
			'Client-Token': clientToken,
			'Spotify-App-Version': clientVersion,
			'Content-Type': 'application/json;charset=UTF-8'
		},
		body: params
	});
	const data = await response.json();
    console.log(data);
	return data;
}

// Paginate playlist
async function getAllTracks(
	accessToken: string,
	clientToken: string,
	clientVersion: string,
	playlistId: string,
	jsPack: string
) {
	const tracks = [];
	let offset = 0;
	const limit = 343; // Upper limit
	while (true) {
		const data = await fetchPlaylist(accessToken, clientToken, clientVersion, playlistId, jsPack, offset, limit);
		const content = data?.data?.playlistV2?.content;
		if (!content) break;
		tracks.push(...content.items);
		if (content.totalCount <= offset + limit) break;
		offset += limit;
	}
	return tracks;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { playlistUrl } = await request.json();
		
		// Extract playlist ID from URL
		const playlistId = playlistUrl.includes('playlist/')
			? playlistUrl.split('playlist/')[1].split('?')[0]
			: playlistUrl;

		// Get session
		const { deviceId, clientVersion, jsPack } = await getSessionData();

		// Get TOTP
		const { secret, version } = await getLatestTotpSecret();
		const totp = generateTotp(secret);

		// Get tokens
		const { accessToken, clientId } = await getAccessToken(totp, version);
		const clientToken = await getClientToken(clientVersion, clientId, deviceId);

		// Get tracks
		const tracks = await getAllTracks(accessToken, clientToken, clientVersion, playlistId, jsPack);

		// Extract song links (track URIs in the format spotify:track:id)
		const songLinks = tracks
			.filter(item => item?.itemV2?.data?.uri)
			.map(item => {
				const uri = item.itemV2.data.uri;
				const trackId = uri.split(':')[2];
				return `https://open.spotify.com/track/${trackId}`;
			});

		return json({ songLinks, totalTracks: songLinks.length });
	} catch (error) {
		console.error('Spotify playlist fetch error:', error);
		return json(
			{ error: 'Failed to fetch playlist', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};
