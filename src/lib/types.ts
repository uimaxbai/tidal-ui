// Type definitions based on HIFI API

export interface Track {
	id: number;
	title: string;
	duration: number;
	replayGain?: number;
	peak?: number;
	allowStreaming: boolean;
	streamReady: boolean;
	streamStartDate?: string;
	premiumStreamingOnly: boolean;
	trackNumber: number;
	volumeNumber: number;
	version: string | null;
	popularity: number;
	copyright?: string;
	url: string;
	isrc?: string;
	editable: boolean;
	explicit: boolean;
	audioQuality: string;
	audioModes: string[];
	artist: Artist;
	artists: Artist[];
	album: Album;
	mixes?: Record<string, string>;
	mediaMetadata?: {
		tags: string[];
	};
}

export interface Artist {
	id: number;
	name: string;
	type: string;
	picture?: string;
	url?: string;
	popularity?: number;
	artistTypes?: string[];
	artistRoles?: Array<{
		category: string;
		categoryId: number;
	}>;
	mixes?: Record<string, string>;
}

export interface ArtistDetails extends Artist {
	albums: Album[];
	tracks: Track[];
}

export interface Album {
	id: number;
	title: string;
	cover: string;
	videoCover: string | null;
	releaseDate?: string;
	duration?: number;
	numberOfTracks?: number;
	numberOfVideos?: number;
	numberOfVolumes?: number;
	explicit?: boolean;
	popularity?: number;
	type?: string;
	upc?: string;
	copyright?: string;
	artist?: Artist;
	artists?: Artist[];
	audioQuality?: string;
	audioModes?: string[];
	url?: string;
	vibrantColor?: string;
	streamReady?: boolean;
	allowStreaming?: boolean;
	mediaMetadata?: {
		tags: string[];
	};
}

export interface Playlist {
	uuid: string;
	title: string;
	description: string;
	image: string;
	squareImage?: string;
	duration: number;
	numberOfTracks: number;
	numberOfVideos: number;
	creator: {
		id: number;
		name: string;
		picture: string | null;
	};
	created: string;
	lastUpdated: string;
	type: string;
	publicPlaylist: boolean;
	url: string;
	popularity: number;
	promotedArtists?: Artist[];
}

export interface TrackInfo {
	trackId: number;
	audioQuality: string;
	audioMode: string;
	manifest: string;
	manifestMimeType: string;
	manifestHash?: string;
	assetPresentation: string;
	albumReplayGain?: number;
	albumPeakAmplitude?: number;
	trackReplayGain?: number;
	trackPeakAmplitude?: number;
	bitDepth?: number;
	sampleRate?: number;
}

export interface SearchResponse<T> {
	limit: number;
	offset: number;
	totalNumberOfItems: number;
	items: T[];
}

export interface CoverImage {
	id: number;
	name: string;
	'1280': string;
	'640': string;
	'80': string;
}

export interface Lyrics {
	trackId: number;
	lyricsProvider: string;
	providerCommontrackId: string;
	providerLyricsId: string;
	lyrics: string;
	subtitles: string;
	isRightToLeft: boolean;
}

export type AudioQuality = 'HI_RES_LOSSLESS' | 'LOSSLESS' | 'HIGH' | 'LOW';

export interface StreamData {
	originalTrack: string;
	trackInfo: TrackInfo;
	songInfo: Track;
}

export interface TrackLookup {
	track: Track;
	info: TrackInfo;
	originalTrackUrl?: string;
}

/**
 * Songlink API response types (copied to avoid circular dependency)
 */
export interface SonglinkEntity {
	id: string;
	type: 'song' | 'album';
	title?: string;
	artistName?: string;
	thumbnailUrl?: string;
	thumbnailWidth?: number;
	thumbnailHeight?: number;
	apiProvider: string;
	platforms: string[];
}

export interface SonglinkPlatformLink {
	country: string;
	url: string;
	nativeAppUriMobile?: string;
	nativeAppUriDesktop?: string;
	entityUniqueId: string;
}

export interface SonglinkResponse {
	entityUniqueId: string;
	userCountry: string;
	pageUrl: string;
	entitiesByUniqueId: Record<string, SonglinkEntity>;
	linksByPlatform: Record<string, SonglinkPlatformLink>;
}

/**
 * Represents a track from Songlink API that hasn't been converted to a full TIDAL track yet
 * Used to defer expensive TIDAL API calls until the track is actually played
 */
export interface SonglinkTrack {
	// Unique identifier (e.g., "spotify:track:3RiPr603aXAoi4GHyXx0uy")
	id: string;
	title: string;
	artistName: string;
	// Duration is unknown from Songlink, use placeholder
	duration: number;
	thumbnailUrl: string;
	// Store the original URL for later conversion
	sourceUrl: string;
	// Store Songlink response data
	songlinkData: SonglinkResponse;
	// Flag to identify this as a Songlink track
	isSonglinkTrack: true;
	// Optional Tidal ID if available
	tidalId?: number;
	// Assume CD quality for display purposes
	audioQuality: 'LOSSLESS';
}

/**
 * Union type for tracks that can be played
 */
export type PlayableTrack = Track | SonglinkTrack;

/**
 * Type guard to check if a track is a SonglinkTrack
 */
export function isSonglinkTrack(track: PlayableTrack): track is SonglinkTrack {
	return 'isSonglinkTrack' in track && track.isSonglinkTrack === true;
}
