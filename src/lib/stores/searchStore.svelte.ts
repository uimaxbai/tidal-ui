import { browser } from '$app/environment';
import type { Track, Album, Artist, Playlist, SonglinkTrack } from '$lib/types';

export type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';

class SearchStore {
	query = $state('');
	activeTab = $state<SearchTab>('tracks');
	isLoading = $state(false);
	tracks = $state<(Track | SonglinkTrack)[]>([]);
	albums = $state<Album[]>([]);
	artists = $state<Artist[]>([]);
	playlists = $state<Playlist[]>([]);
	error = $state<string | null>(null);
	
	// Playlist conversion state
	isPlaylistConversionMode = $state(false);
	playlistConversionTotal = $state(0);
	playlistLoadingMessage = $state<string | null>(null);

	constructor() {
		if (browser) {
			const stored = sessionStorage.getItem('tidal-ui-search-store');
			if (stored) {
				try {
					const data = JSON.parse(stored);
					this.query = data.query ?? '';
					this.activeTab = data.activeTab ?? 'tracks';
					this.tracks = data.tracks ?? [];
					this.albums = data.albums ?? [];
					this.artists = data.artists ?? [];
					this.playlists = data.playlists ?? [];
					this.isPlaylistConversionMode = data.isPlaylistConversionMode ?? false;
					this.playlistConversionTotal = data.playlistConversionTotal ?? 0;
				} catch (e) {
					console.error('Failed to restore search state:', e);
				}
			}

			$effect.root(() => {
				$effect(() => {
					const data = {
						query: this.query,
						activeTab: this.activeTab,
						tracks: this.tracks,
						albums: this.albums,
						artists: this.artists,
						playlists: this.playlists,
						isPlaylistConversionMode: this.isPlaylistConversionMode,
						playlistConversionTotal: this.playlistConversionTotal
					};
					try {
						sessionStorage.setItem('tidal-ui-search-store', JSON.stringify(data));
					} catch (e) {
						console.warn('Failed to save search state to sessionStorage:', e);
					}
				});
			});
		}
	}

	reset() {
		this.query = '';
		this.activeTab = 'tracks';
		this.isLoading = false;
		this.tracks = [];
		this.albums = [];
		this.artists = [];
		this.playlists = [];
		this.error = null;
		this.isPlaylistConversionMode = false;
		this.playlistConversionTotal = 0;
		this.playlistLoadingMessage = null;
	}
}

export const searchStore = new SearchStore();
