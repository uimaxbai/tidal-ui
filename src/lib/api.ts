// API service for HIFI API
import { API_CONFIG, fetchWithCORS } from './config';
import type {
	Track,
	Artist,
	Album,
	Playlist,
	SearchResponse,
	AudioQuality,
	StreamData,
	CoverImage,
	Lyrics,
	TrackInfo,
	TrackLookup,
	ArtistDetails
} from './types';

const API_BASE = API_CONFIG.baseUrl;
const RATE_LIMIT_ERROR_MESSAGE = 'Too Many Requests. Please wait a moment and try again.';

class LosslessAPI {
	public baseUrl: string;
	private metadataQueue: Promise<void> = Promise.resolve();

	constructor(baseUrl: string = API_BASE) {
		this.baseUrl = baseUrl;
	}

	private normalizeSearchResponse<T>(
		data: unknown,
		key: 'tracks' | 'albums' | 'artists' | 'playlists'
	): SearchResponse<T> {
		const section = this.findSearchSection<T>(data, key, new Set());
		return this.buildSearchResponse<T>(section);
	}

	private buildSearchResponse<T>(
		section: Partial<SearchResponse<T>> | undefined
	): SearchResponse<T> {
		const items = section?.items;
		const list = Array.isArray(items) ? (items as T[]) : [];
		const limit = typeof section?.limit === 'number' ? section.limit : list.length;
		const offset = typeof section?.offset === 'number' ? section.offset : 0;
		const total =
			typeof section?.totalNumberOfItems === 'number' ? section.totalNumberOfItems : list.length;

		return {
			items: list,
			limit,
			offset,
			totalNumberOfItems: total
		};
	}

	private findSearchSection<T>(
		source: unknown,
		key: 'tracks' | 'albums' | 'artists' | 'playlists',
		visited: Set<object>
	): Partial<SearchResponse<T>> | undefined {
		if (!source) {
			return undefined;
		}

		if (Array.isArray(source)) {
			for (const entry of source) {
				const found = this.findSearchSection<T>(entry, key, visited);
				if (found) {
					return found;
				}
			}
			return undefined;
		}

		if (typeof source !== 'object') {
			return undefined;
		}

		const objectRef = source as Record<string, unknown>;
		if (visited.has(objectRef)) {
			return undefined;
		}
		visited.add(objectRef);

		if (!Array.isArray(source) && 'items' in objectRef && Array.isArray(objectRef.items)) {
			return objectRef as Partial<SearchResponse<T>>;
		}

		if (key in objectRef) {
			const nested = objectRef[key];
			const fromKey = this.findSearchSection<T>(nested, key, visited);
			if (fromKey) {
				return fromKey;
			}
		}

		for (const value of Object.values(objectRef)) {
			const found = this.findSearchSection<T>(value, key, visited);
			if (found) {
				return found;
			}
		}

		return undefined;
	}

	private prepareTrack(track: Track): Track {
		if (!track.artist && Array.isArray(track.artists) && track.artists.length > 0) {
			return { ...track, artist: track.artists[0]! };
		}
		return track;
	}

	private prepareAlbum(album: Album): Album {
		if (!album.artist && Array.isArray(album.artists) && album.artists.length > 0) {
			return { ...album, artist: album.artists[0]! };
		}
		return album;
	}

	private prepareArtist(artist: Artist): Artist {
		if (!artist.type && Array.isArray(artist.artistTypes) && artist.artistTypes.length > 0) {
			return { ...artist, type: artist.artistTypes[0]! } as Artist;
		}
		return artist;
	}

	private ensureNotRateLimited(response: Response): void {
		if (response.status === 429) {
			throw new Error(RATE_LIMIT_ERROR_MESSAGE);
		}
	}

	private async delay(ms: number): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, ms));
	}

	private parseTrackLookup(data: unknown): TrackLookup {
		const entries = Array.isArray(data) ? data : [data];
		let track: Track | undefined;
		let info: TrackInfo | undefined;
		let originalTrackUrl: string | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;
			if (!track && 'album' in entry && 'artist' in entry && 'duration' in entry) {
				track = entry as Track;
				continue;
			}
			if (!info && 'manifest' in entry) {
				info = entry as TrackInfo;
				continue;
			}
			if (!originalTrackUrl && 'OriginalTrackUrl' in entry) {
				const candidate = (entry as { OriginalTrackUrl?: unknown }).OriginalTrackUrl;
				if (typeof candidate === 'string') {
					originalTrackUrl = candidate;
				}
			}
		}

		if (!track || !info) {
			throw new Error('Malformed track response');
		}

		return { track, info, originalTrackUrl };
	}

	private extractStreamUrlFromManifest(manifest: string): string | null {
		try {
			const decoded = atob(manifest);
			try {
				const parsed = JSON.parse(decoded) as { urls?: string[] };
				if (parsed && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
					return parsed.urls[0] ?? null;
				}
			} catch (jsonError) {
				// Ignore JSON parse failure and fall back to regex search
				console.debug('Manifest JSON parse failed, falling back to pattern match', jsonError);
			}

			const match = decoded.match(/https?:\/\/[\w\-.~:?#[\]@!$&'()*+,;=%/]+/);
			return match ? match[0] : null;
		} catch (error) {
			console.error('Failed to decode manifest:', error);
			return null;
		}
	}

	/**
	 * Fetch wrapper with CORS handling
	 */
	private async fetch(url: string, options?: RequestInit): Promise<Response> {
		return fetchWithCORS(url, options);
	}

	/**
	 * Search for tracks
	 */
	async searchTracks(query: string): Promise<SearchResponse<Track>> {
		const response = await this.fetch(`${this.baseUrl}/search/?s=${encodeURIComponent(query)}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search tracks');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Track>(data, 'tracks');
		return {
			...normalized,
			items: normalized.items.map((track) => this.prepareTrack(track))
		};
	}

	/**
	 * Search for artists
	 */
	async searchArtists(query: string): Promise<SearchResponse<Artist>> {
		const response = await this.fetch(`${this.baseUrl}/search/?a=${encodeURIComponent(query)}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search artists');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Artist>(data, 'artists');
		return {
			...normalized,
			items: normalized.items.map((artist) => this.prepareArtist(artist))
		};
	}

	/**
	 * Search for albums
	 */
	async searchAlbums(query: string): Promise<SearchResponse<Album>> {
		const response = await this.fetch(`${this.baseUrl}/search/?al=${encodeURIComponent(query)}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search albums');
		const data = await response.json();
		const normalized = this.normalizeSearchResponse<Album>(data, 'albums');
		return {
			...normalized,
			items: normalized.items.map((album) => this.prepareAlbum(album))
		};
	}

	/**
	 * Search for playlists
	 */
	async searchPlaylists(query: string): Promise<SearchResponse<Playlist>> {
		const response = await this.fetch(`${this.baseUrl}/search/?p=${encodeURIComponent(query)}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to search playlists');
		const data = await response.json();
		return this.normalizeSearchResponse<Playlist>(data, 'playlists');
	}

	/**
	 * Get track info and stream URL (with retries for quality fallback)
	 */
	async getTrack(id: number, quality: AudioQuality = 'LOSSLESS'): Promise<TrackLookup> {
		const url = `${this.baseUrl}/track/?id=${id}&quality=${quality}`;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const response = await this.fetch(url);
			this.ensureNotRateLimited(response);
			if (response.ok) {
				const data = await response.json();
				return this.parseTrackLookup(data);
			}

			let detail: string | undefined;
			let userMessage: string | undefined;
			let subStatus: number | undefined;
			try {
				const errorData = (await response.json()) as {
					detail?: unknown;
					subStatus?: unknown;
					userMessage?: unknown;
				};
				if (typeof errorData?.detail === 'string') {
					detail = errorData.detail;
				}
				if (typeof errorData?.userMessage === 'string') {
					userMessage = errorData.userMessage;
					if (!detail) {
						detail = errorData.userMessage;
					}
				}
				if (typeof errorData?.subStatus === 'number') {
					subStatus = errorData.subStatus;
				}
			} catch {
				// Ignore JSON parse errors
			}

			const isTokenRetry = response.status === 401 && subStatus === 11002;
			const message = detail ?? `Failed to get track (status ${response.status})`;
			lastError = new Error(isTokenRetry ? (userMessage ?? message) : message);
			const shouldRetry =
				isTokenRetry || (detail ? /quality not found/i.test(detail) : response.status >= 500);

			if (attempt === 3 || !shouldRetry) {
				throw lastError;
			}

			await this.delay(200 * attempt);
		}

		throw lastError ?? new Error('Failed to get track');
	}

	/**
	 * Get song with stream info
	 */
	async getSong(query: string, quality: AudioQuality = 'LOSSLESS'): Promise<StreamData> {
		const response = await this.fetch(
			`${this.baseUrl}/song/?q=${encodeURIComponent(query)}&quality=${quality}`
		);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get song');
		return response.json();
	}

	/**
	 * Get album details with track listing
	 */
	async getAlbum(id: number): Promise<{ album: Album; tracks: Track[] }> {
		const response = await this.fetch(`${this.baseUrl}/album/?id=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get album');
		const data = await response.json();
		const entries = Array.isArray(data) ? data : [data];

		let albumEntry: Album | undefined;
		let trackCollection: { items?: unknown[] } | undefined;

		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;

			if (!albumEntry && 'title' in entry && 'id' in entry && 'cover' in entry) {
				albumEntry = this.prepareAlbum(entry as Album);
				continue;
			}

			if (
				!trackCollection &&
				'items' in entry &&
				Array.isArray((entry as { items?: unknown[] }).items)
			) {
				trackCollection = entry as { items?: unknown[] };
			}
		}

		if (!albumEntry) {
			throw new Error('Album not found');
		}

		const tracks: Track[] = [];
		if (trackCollection?.items) {
			for (const rawItem of trackCollection.items) {
				if (!rawItem || typeof rawItem !== 'object') continue;

				let trackCandidate: Track | undefined;
				if ('item' in rawItem && rawItem.item && typeof rawItem.item === 'object') {
					trackCandidate = rawItem.item as Track;
				} else {
					trackCandidate = rawItem as Track;
				}

				if (!trackCandidate) continue;

				const candidateWithAlbum = trackCandidate.album
					? trackCandidate
					: ({ ...trackCandidate, album: albumEntry } as Track);
				tracks.push(this.prepareTrack(candidateWithAlbum));
			}
		}

		return { album: albumEntry, tracks };
	}

	/**
	 * Get playlist details
	 */
	async getPlaylist(uuid: string): Promise<{ playlist: Playlist; items: Array<{ item: Track }> }> {
		const response = await this.fetch(`${this.baseUrl}/playlist/?id=${uuid}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get playlist');
		const data = await response.json();
		return {
			playlist: Array.isArray(data) ? data[0] : data,
			items: Array.isArray(data) && data[1] ? data[1].items : []
		};
	}

	/**
	 * Get artist overview, including discography modules and top tracks
	 */
	async getArtist(id: number): Promise<ArtistDetails> {
		const response = await this.fetch(`${this.baseUrl}/artist/?f=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get artist');
		const data = await response.json();
		const entries = Array.isArray(data) ? data : [data];

		const visited = new Set<object>();
		const albumMap = new Map<number, Album>();
		const trackMap = new Map<number, Track>();
		let artist: Artist | undefined;

		const isTrackLike = (value: unknown): value is Track => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			const albumCandidate = candidate.album as unknown;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.title === 'string' &&
				typeof candidate.duration === 'number' &&
				'trackNumber' in candidate &&
				albumCandidate !== undefined &&
				albumCandidate !== null &&
				typeof albumCandidate === 'object'
			);
		};

		const isAlbumLike = (value: unknown): value is Album => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.title === 'string' &&
				'cover' in candidate
			);
		};

		const isArtistLike = (value: unknown): value is Artist => {
			if (!value || typeof value !== 'object') return false;
			const candidate = value as Record<string, unknown>;
			return (
				typeof candidate.id === 'number' &&
				typeof candidate.name === 'string' &&
				typeof candidate.type === 'string' &&
				('artistRoles' in candidate || 'artistTypes' in candidate || 'url' in candidate)
			);
		};

		const recordArtist = (candidate: Artist | undefined) => {
			if (!candidate) return;
			const normalized = this.prepareArtist(candidate);
			if (!artist || artist.id === normalized.id) {
				artist = normalized;
			}
		};

		const addAlbum = (candidate: Album | undefined) => {
			if (!candidate || typeof candidate.id !== 'number') return;
			const normalized = this.prepareAlbum({ ...candidate });
			albumMap.set(normalized.id, normalized);
			recordArtist(normalized.artist ?? normalized.artists?.[0]);
		};

		const addTrack = (candidate: Track | undefined) => {
			if (!candidate || typeof candidate.id !== 'number') return;
			const normalized = this.prepareTrack({ ...candidate });
			if (!normalized.album) {
				return;
			}
			addAlbum(normalized.album);
			const knownAlbum = albumMap.get(normalized.album.id);
			if (knownAlbum) {
				normalized.album = knownAlbum;
			}
			trackMap.set(normalized.id, normalized);
			recordArtist(normalized.artist);
		};

		const parseModuleItems = (items: unknown) => {
			if (!Array.isArray(items)) return;
			for (const entry of items) {
				if (!entry || typeof entry !== 'object') {
					continue;
				}

				const candidate = 'item' in entry ? (entry as { item?: unknown }).item : entry;
				if (isAlbumLike(candidate)) {
					addAlbum(candidate as Album);
					const normalizedAlbum = albumMap.get((candidate as Album).id);
					recordArtist(normalizedAlbum?.artist ?? normalizedAlbum?.artists?.[0]);
					continue;
				}
				if (isTrackLike(candidate)) {
					addTrack(candidate as Track);
					continue;
				}

				scanValue(candidate);
			}
		};

		const scanValue = (value: unknown) => {
			if (!value) return;
			if (Array.isArray(value)) {
				const trackCandidates = value.filter(isTrackLike);
				if (trackCandidates.length > 0) {
					for (const track of trackCandidates) {
						addTrack(track);
					}
					return;
				}
				for (const entry of value) {
					scanValue(entry);
				}
				return;
			}

			if (typeof value !== 'object') {
				return;
			}

			const objectRef = value as Record<string, unknown>;
			if (visited.has(objectRef)) {
				return;
			}
			visited.add(objectRef);

			if (isArtistLike(objectRef)) {
				recordArtist(objectRef as Artist);
			}

			if ('modules' in objectRef && Array.isArray(objectRef.modules)) {
				for (const moduleEntry of objectRef.modules) {
					scanValue(moduleEntry);
				}
			}

			if (
				'pagedList' in objectRef &&
				objectRef.pagedList &&
				typeof objectRef.pagedList === 'object'
			) {
				const pagedList = objectRef.pagedList as { items?: unknown };
				parseModuleItems(pagedList.items);
			}

			if ('items' in objectRef && Array.isArray(objectRef.items)) {
				parseModuleItems(objectRef.items);
			}

			if ('rows' in objectRef && Array.isArray(objectRef.rows)) {
				parseModuleItems(objectRef.rows);
			}

			if ('listItems' in objectRef && Array.isArray(objectRef.listItems)) {
				parseModuleItems(objectRef.listItems);
			}

			for (const nested of Object.values(objectRef)) {
				scanValue(nested);
			}
		};

		for (const entry of entries) {
			scanValue(entry);
		}

		if (!artist) {
			const trackPrimaryArtist = Array.from(trackMap.values())
				.map((track) => track.artist ?? track.artists?.[0])
				.find(Boolean);
			const albumPrimaryArtist = Array.from(albumMap.values())
				.map((album) => album.artist ?? album.artists?.[0])
				.find(Boolean);
			recordArtist(trackPrimaryArtist ?? albumPrimaryArtist);
		}

		if (!artist) {
			try {
				const fallbackResponse = await this.fetch(`${this.baseUrl}/artist/?id=${id}`);
				this.ensureNotRateLimited(fallbackResponse);
				if (fallbackResponse.ok) {
					const fallbackData = await fallbackResponse.json();
					const baseArtist = Array.isArray(fallbackData) ? fallbackData[0] : fallbackData;
					if (baseArtist && typeof baseArtist === 'object') {
						recordArtist(baseArtist as Artist);
					}
				}
			} catch (fallbackError) {
				console.warn('Failed to fetch base artist details:', fallbackError);
			}
		}

		if (!artist) {
			throw new Error('Artist not found');
		}

		const albums = Array.from(albumMap.values()).map((album) => {
			if (!album.artist && artist) {
				return { ...album, artist };
			}
			return album;
		});

		const albumById = new Map(albums.map((album) => [album.id, album] as const));

		const tracks = Array.from(trackMap.values()).map((track) => {
			const enrichedArtist = track.artist ?? artist;
			const album = track.album;
			const enrichedAlbum = album
				? (albumById.get(album.id) ?? (artist && !album.artist ? { ...album, artist } : album))
				: undefined;
			return {
				...track,
				artist: enrichedArtist ?? track.artist,
				album: enrichedAlbum ?? album
			};
		});

		const parseDate = (value?: string): number => {
			if (!value) return Number.NaN;
			const timestamp = Date.parse(value);
			return Number.isFinite(timestamp) ? timestamp : Number.NaN;
		};

		const sortedAlbums = albums.sort((a, b) => {
			const timeA = parseDate(a.releaseDate);
			const timeB = parseDate(b.releaseDate);
			if (Number.isNaN(timeA) && Number.isNaN(timeB)) {
				return (b.popularity ?? 0) - (a.popularity ?? 0);
			}
			if (Number.isNaN(timeA)) return 1;
			if (Number.isNaN(timeB)) return -1;
			return timeB - timeA;
		});

		const sortedTracks = tracks
			.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
			.slice(0, 100);

		return {
			...artist,
			albums: sortedAlbums,
			tracks: sortedTracks
		};
	}

	/**
	 * Get cover image
	 */
	async getCover(id?: number, query?: string): Promise<CoverImage[]> {
		let url = `${this.baseUrl}/cover/?`;
		if (id) url += `id=${id}`;
		if (query) url += `q=${encodeURIComponent(query)}`;
		const response = await this.fetch(url);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get cover');
		return response.json();
	}

	/**
	 * Get lyrics for a track
	 */
	async getLyrics(id: number): Promise<Lyrics> {
		const response = await this.fetch(`${this.baseUrl}/lyrics/?id=${id}`);
		this.ensureNotRateLimited(response);
		if (!response.ok) throw new Error('Failed to get lyrics');
		const data = await response.json();
		return Array.isArray(data) ? data[0] : data;
	}

	/**
	 * Get stream URL for a track
	 */
	async getStreamUrl(trackId: number, quality: AudioQuality = 'LOSSLESS'): Promise<string> {
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= 3; attempt += 1) {
			try {
				const lookup = await this.getTrack(trackId, quality);
				if (lookup.originalTrackUrl) {
					return lookup.originalTrackUrl;
				}

				const manifestUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
				if (manifestUrl) {
					return manifestUrl;
				}

				lastError = new Error('Unable to resolve stream URL for track');
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}

			if (attempt < 3) {
				await this.delay(200 * attempt);
			}
		}

		throw lastError ?? new Error('Unable to resolve stream URL for track');
	}

	/**
	 * Attempt to embed metadata into a downloaded track using FFmpeg WASM
	 */
	private async embedMetadataIntoBlob(
		blob: Blob,
		lookup: TrackLookup,
		filename: string,
		contentType?: string | null
	): Promise<Blob | null> {
		const job = this.metadataQueue.then(() =>
			this.runMetadataEmbedding(blob, lookup, filename, contentType ?? undefined)
		);
		this.metadataQueue = job.then(
			() => undefined,
			() => undefined
		);

		try {
			return await job;
		} catch (error) {
			console.warn('Metadata embedding failed', error);
			return null;
		}
	}

	private inferExtensionFromFilename(filename: string): string | null {
		const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(filename);
		return match ? match[1]!.toLowerCase() : null;
	}

	private inferExtensionFromMime(mime?: string | null): string | null {
		if (!mime) return null;
		const normalized = mime.split(';')[0]?.trim().toLowerCase();
		switch (normalized) {
			case 'audio/flac':
				return 'flac';
			case 'audio/x-flac':
				return 'flac';
			case 'audio/mpeg':
				return 'mp3';
			case 'audio/mp3':
				return 'mp3';
			case 'audio/mp4':
			case 'audio/aac':
			case 'audio/x-m4a':
				return 'm4a';
			case 'audio/wav':
			case 'audio/x-wav':
				return 'wav';
			case 'audio/ogg':
				return 'ogg';
			default:
				return null;
		}
	}

	private inferMimeFromExtension(
		ext: string | null | undefined,
		fallbackType?: string
	): string | undefined {
		switch (ext) {
			case 'flac':
				return 'audio/flac';
			case 'mp3':
				return 'audio/mpeg';
			case 'm4a':
			case 'aac':
				return 'audio/mp4';
			case 'wav':
				return 'audio/wav';
			case 'ogg':
				return 'audio/ogg';
			default:
				return fallbackType;
		}
	}

	private buildMetadataEntries(lookup: TrackLookup): Array<[string, string]> {
		const entries: Array<[string, string]> = [];
		const { track } = lookup;
		const album = track.album;
		const mainArtist = track.artist?.name ?? track.artists?.[0]?.name;
		const albumArtist =
			album?.artist?.name ??
			(album?.artists && album.artists.length > 0 ? album.artists[0]?.name : undefined) ??
			mainArtist;

		if (track.title) entries.push(['title', track.title]);
		if (mainArtist) entries.push(['artist', mainArtist]);
		if (albumArtist) entries.push(['album_artist', albumArtist]);
		if (album?.title) entries.push(['album', album.title]);

		const trackNumber = Number(track.trackNumber);
		const totalTracks = Number(album?.numberOfTracks);
		if (Number.isFinite(trackNumber) && trackNumber > 0) {
			const value =
				Number.isFinite(totalTracks) && totalTracks > 0
					? `${trackNumber}/${totalTracks}`
					: `${trackNumber}`;
			entries.push(['track', value]);
		}

		const discNumber = Number(track.volumeNumber);
		const totalDiscs = Number(album?.numberOfVolumes);
		if (Number.isFinite(discNumber) && discNumber > 0) {
			const value =
				Number.isFinite(totalDiscs) && totalDiscs > 0
					? `${discNumber}/${totalDiscs}`
					: `${discNumber}`;
			entries.push(['disc', value]);
		}

		const releaseDate = album?.releaseDate ?? track.streamStartDate;
		if (releaseDate) {
			const yearMatch = /^(\d{4})/.exec(releaseDate);
			if (yearMatch?.[1]) {
				entries.push(['date', yearMatch[1]]);
				entries.push(['year', yearMatch[1]]);
			}
		}

		// API does not include genre
		/*
		const tags = track.mediaMetadata?.tags ?? album?.mediaMetadata?.tags;
		if (tags && tags.length > 0) {
			entries.push(['genre', tags.join('; ')]);
		}
		*/

		if (track.isrc) {
			entries.push(['ISRC', track.isrc]);
		}

		if (album?.copyright) {
			entries.push(['copyright', album.copyright]);
		}

		entries.push(['comment', 'Downloaded from music.binimum.org/tidal.squid.wtf']);

		return entries;
	}

	private async runMetadataEmbedding(
		blob: Blob,
		lookup: TrackLookup,
		filename: string,
		contentType?: string
	): Promise<Blob | null> {
		if (typeof window === 'undefined') {
			return null;
		}

		const extension =
			this.inferExtensionFromFilename(filename) ?? this.inferExtensionFromMime(contentType);

		if (!extension) {
			return null;
		}

		const supportedExtensions = new Set(['flac', 'mp3', 'm4a', 'aac', 'wav', 'ogg']);
		if (!supportedExtensions.has(extension)) {
			return null;
		}

		let ffmpegModule: typeof import('./ffmpegClient') | null = null;
		try {
			ffmpegModule = await import('./ffmpegClient');
		} catch (error) {
			console.warn('Unable to load FFmpeg client module', error);
			return null;
		}

		if (!ffmpegModule.isFFmpegSupported()) {
			return null;
		}

		const ffmpeg = await ffmpegModule.getFFmpegWithCountdown(true); // Skip countdown during download
		const uniqueSuffix =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
		const inputName = `source-${uniqueSuffix}.${extension}`;
		const outputName = `output-${uniqueSuffix}.${extension}`;
		const coverName = `cover-${uniqueSuffix}.jpg`;

		let coverWritten = false;

		try {
			await ffmpeg.writeFile(inputName, await ffmpegModule.fetchFile(blob));

			const artworkId = lookup.track.album?.cover;
			if (artworkId) {
				const coverUrl = this.getCoverUrl(artworkId, '640');
				try {
					const coverResponse = await fetch(coverUrl);
					if (coverResponse.ok) {
						const coverBlob = await coverResponse.blob();
						await ffmpeg.writeFile(coverName, await ffmpegModule.fetchFile(coverBlob));
						coverWritten = true;
					}
				} catch (artworkError) {
					console.warn('Failed to fetch cover art for metadata embedding', artworkError);
				}
			}

			const args: string[] = ['-i', inputName];
			if (coverWritten) {
				args.push('-i', coverName);
			}

			for (const [key, value] of this.buildMetadataEntries(lookup)) {
				args.push('-metadata', `${key}=${value}`);
			}

			if (coverWritten) {
				args.push('-map', '0:a:0');
				args.push('-map', '1:v:0');
				args.push('-c:a', 'copy');
				args.push('-c:v', 'mjpeg');
				args.push('-metadata:s:v', 'title=Album cover');
				args.push('-metadata:s:v', 'comment=Cover (front)');
				args.push('-disposition:v', 'attached_pic');
			} else {
				args.push('-c', 'copy');
			}

			args.push(outputName);

			await ffmpeg.exec(args);
			const outputData = await ffmpeg.readFile(outputName);
			let outputArray: Uint8Array;
			if (outputData instanceof Uint8Array) {
				outputArray = outputData;
			} else if (typeof outputData === 'string') {
				outputArray = new TextEncoder().encode(outputData);
			} else {
				outputArray = new Uint8Array((outputData as unknown as ArrayBuffer) ?? new ArrayBuffer(0));
			}
			const blobArray = new Uint8Array(outputArray);
			const mimeType = this.inferMimeFromExtension(
				extension,
				contentType ?? (blob.type && blob.type.length > 0 ? blob.type : undefined)
			);
			return new Blob([blobArray], { type: mimeType });
		} catch (error) {
			console.warn('FFmpeg execution failed', error);
			return null;
		} finally {
			try {
				await ffmpeg.deleteFile(inputName);
			} catch (cleanupErr) {
				console.debug('Failed to delete FFmpeg input file', cleanupErr);
			}
			try {
				await ffmpeg.deleteFile(outputName);
			} catch (cleanupErr) {
				console.debug('Failed to delete FFmpeg output file', cleanupErr);
			}
			if (coverWritten) {
				try {
					await ffmpeg.deleteFile(coverName);
				} catch (cleanupErr) {
					console.debug('Failed to delete FFmpeg cover file', cleanupErr);
				}
			}
		}
	}

	/**
	 * Download a track
	 * Fetches the audio stream and triggers a download
	 */
	async downloadTrack(
		trackId: number,
		quality: AudioQuality = 'LOSSLESS',
		filename: string,
		options?: {
			onProgress?: (progress: number) => void;
			abortSignal?: AbortSignal;
		}
	): Promise<void> {
		try {
			const lookup = await this.getTrack(trackId, quality);
			let streamUrl = lookup.originalTrackUrl || null;
			let response: Response | null = null;

			if (streamUrl) {
				response = await fetch(streamUrl, { signal: options?.abortSignal });
				if (response.status === 429) {
					throw new Error(RATE_LIMIT_ERROR_MESSAGE);
				}
				if (!response.ok) {
					console.warn('OriginalTrackUrl download failed, falling back to manifest', {
						status: response.status
					});
					response = null;
				}
			}

			if (!response) {
				const fallbackUrl = this.extractStreamUrlFromManifest(lookup.info.manifest);
				if (!fallbackUrl) {
					throw new Error('Could not extract stream URL from manifest');
				}

				streamUrl = fallbackUrl;
				response = await fetch(streamUrl, { signal: options?.abortSignal });
				if (response.status === 429) {
					throw new Error(RATE_LIMIT_ERROR_MESSAGE);
				}
				if (!response.ok) {
					throw new Error('Failed to fetch audio stream');
				}
			}

			// Track download progress if supported
			const contentLength = response.headers.get('content-length');
			const total = contentLength ? parseInt(contentLength, 10) : 0;
			
			let blob: Blob;
			if (total > 0 && options?.onProgress && response.body) {
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let received = 0;

				while (true) {
					const { done, value } = await reader.read();
					
					if (done) break;
					
					chunks.push(value);
					received += value.length;
					
					const progress = Math.round((received / total) * 100);
					options.onProgress(Math.min(progress, 99)); // Reserve 100 for processing
				}

				blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') || undefined });
			} else {
				blob = await response.blob();
			}

			if (options?.onProgress) {
				options.onProgress(99); // Starting metadata processing
			}

			const processedBlob = await this.embedMetadataIntoBlob(
				blob,
				lookup,
				filename,
				response.headers.get('Content-Type')
			);
			const finalBlob = processedBlob ?? blob;
			
			if (options?.onProgress) {
				options.onProgress(100);
			}
			
			const url = URL.createObjectURL(finalBlob);

			// Trigger download
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Download failed:', error);
			
			// Check if it was aborted
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Download cancelled');
			}
			
			if (error instanceof Error && error.message === RATE_LIMIT_ERROR_MESSAGE) {
				throw error;
			}
			throw new Error(
				'Download failed. The stream URL may require a proxy. Please try streaming instead.'
			);
		}
	}

	/**
	 * Format duration from seconds to MM:SS
	 */
	formatDuration(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	/**
	 * Get cover URL
	 */
	getCoverUrl(coverId: string, size: '1280' | '640' | '320' | '160' | '80' = '640'): string {
		return `https://resources.tidal.com/images/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
	}

	/**
	 * Get artist picture URL
	 */
	getArtistPictureUrl(pictureId: string, size: '750' = '750'): string {
		return `https://resources.tidal.com/images/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
	}
}

export const losslessAPI = new LosslessAPI();
