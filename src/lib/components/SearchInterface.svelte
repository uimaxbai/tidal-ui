<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import { hasRegionTargets } from '$lib/config';
	import { downloadAlbum, getExtensionForQuality } from '$lib/downloads';
	import { formatArtists } from '$lib/utils';
	import { playerStore } from '$lib/stores/player';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';
	import { regionStore, type RegionOption } from '$lib/stores/region';
	import { isTidalUrl } from '$lib/utils/urlParser';
	import {
		isSupportedStreamingUrl,
		convertToTidal,
		getPlatformName,
		isSpotifyPlaylistUrl,
		convertSpotifyPlaylist,
		fetchSonglinkData,
		extractTidalSongEntity
	} from '$lib/utils/songlink';
	import type { Track, Album, Artist, Playlist, AudioQuality, SonglinkTrack, PlayableTrack } from '$lib/types';
	import { isSonglinkTrack } from '$lib/types';
	import {
		Search,
		ChevronDown,
		Music,
		User,
		Disc,
		Download,
		Newspaper,
		ListPlus,
		ListVideo,
		LoaderCircle,
		X,
		Earth,
		Ban,
		Link2,
		MoreVertical,
		List,
		Play,
		Shuffle,
		Copy,
		Code
	} from 'lucide-svelte';

	import { searchStore, type SearchTab } from '$lib/stores/searchStore.svelte';
	import { page } from '$app/stores';

	function getLongLink(type: 'track' | 'album' | 'artist' | 'playlist', id: string | number) {
		return `${$page.url.protocol}://${$page.url.host}/${type}/${id}`;
	}

	function getShortLink(type: 'track' | 'album' | 'artist' | 'playlist', id: string | number) {
		const prefixMap = {
			track: 't',
			album: 'al',
			artist: 'ar',
			playlist: 'p'
		};
		return `https://okiw.me/${prefixMap[type]}/${id}`;
	}

	function getEmbedCode(type: 'track' | 'album' | 'artist' | 'playlist', id: string | number) {
		if (type === "track") return `<iframe src="https://music.binimum.org/embed/${type}/${id}" width="100%" height="150" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
		return `<iframe src="https://music.binimum.org/embed/${type}/${id}" width="100%" height="450" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
	}

	async function copyToClipboard(text: string) {
		try {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				// Fallback for non-secure contexts
				const textArea = document.createElement('textarea');
				textArea.value = text;
				textArea.style.position = 'fixed';
				textArea.style.left = '-9999px';
				textArea.style.top = '0';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				try {
					document.execCommand('copy');
				} catch (err) {
					console.error('Fallback: Oops, unable to copy', err);
					throw err;
				}
				document.body.removeChild(textArea);
			}
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	let downloadingIds = $state(new Set<number | string>());
	let downloadTaskIds = $state(new Map<number | string, string>());
	let cancelledIds = $state(new Set<number | string>());
	let activeMenuId = $state<number | string | null>(null);

	const albumDownloadQuality = $derived($userPreferencesStore.playbackQuality as AudioQuality);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);
	const downloadCoverSeperatelyPreference = $derived(
		$userPreferencesStore.downloadCoversSeperately
	);
	let selectedRegion = $state<RegionOption>('auto');
	let isRegionSelectorOpen = $state(false);
	// Playlist state moved to searchStore

	const regionAvailability: Record<RegionOption, boolean> = {
		auto: hasRegionTargets('auto'),
		us: hasRegionTargets('us'),
		eu: hasRegionTargets('eu')
	};

	const ensureSupportedRegion = (value: RegionOption): RegionOption => {
		if (value !== 'auto' && !regionAvailability[value]) {
			return 'auto';
		}
		return value;
	};

	const unsubscribeRegion = regionStore.subscribe((value) => {
		const nextRegion = ensureSupportedRegion(value);
		if (nextRegion !== value) {
			regionStore.setRegion(nextRegion);
		}
		selectedRegion = nextRegion;
	});

	onDestroy(unsubscribeRegion);

	// Computed property to check if current query is a Tidal URL
	const isQueryATidalUrl = $derived(searchStore.query.trim().length > 0 && isTidalUrl(searchStore.query.trim()));

	// Computed property to check if current query is a supported streaming platform URL
	const isQueryAStreamingUrl = $derived(
		searchStore.query.trim().length > 0 && isSupportedStreamingUrl(searchStore.query.trim())
	);

	// Computed property to check if current query is a Spotify playlist URL
	const isQueryASpotifyPlaylist = $derived(
		searchStore.query.trim().length > 0 && isSpotifyPlaylistUrl(searchStore.query.trim())
	);

	// Combined URL check
	const isQueryAUrl = $derived(isQueryATidalUrl || isQueryAStreamingUrl);

	type AlbumDownloadState = {
		downloading: boolean;
		completed: number;
		total: number;
		error: string | null;
	};

	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});

	const newsItems = [
		{
			title: 'Hi-Res downloading!!!',
			description:
				"You can finally download and stream in Hi-Res again because of a much better API. It should also be much faster - try it out for yourself!"
		},
		{
			title: 'Links support + QOLs!',
			description:
				"You can now paste links from supported streaming platforms (Spotify, YouTube, Apple Music, etc.) and the app will try to convert them to TIDAL equivalents for you to play or download. Only Spotify playlists work right now, but I'm working on fixing it."
		},
		{
			title: 'Redesign + QQDL',
			description:
				'Hi-Res downloading still a WIP but a cool redesign that I inspired off a very cool library called Color Thief is here - and the site is also now up at QQDL!'
		},
		{
			title: 'Hi-Res Audio',
			description:
				"Streaming for Hi-Res is now here. Stay tuned for Hi-Res downloading - I haven't gotten that one figured out yet. And video covers/lower quality streaming. Pretty cool."
		},
		{
			title: 'Even more changes!',
			description:
				"LYRICS!!! I've stabilised the API a bit and added a few more features such as ZIP download of albums, better error handling, etc. Stay tuned for word by word lyrics!"
		},
		{
			title: 'QOL changes',
			description:
				'This website is still very much in beta, but queue management and album/artist pages/downloads have been added as well as some bug squashing/QOL changes such as bigger album covers and download all for albums.'
		},
		{
			title: 'Initial release!',
			description:
				"Two APIs fetch lossless CD-quality 16/44.1kHz FLACs. No support for Hi-Res yet but I'm working on it haha. No playlist saving or logging in either but downloading and streaming work."
		}
	];

	const trackSkeletons = Array.from({ length: 6 }, (_, index) => index);
	const gridSkeletons = Array.from({ length: 8 }, (_, index) => index);

	interface Props {
		onTrackSelect?: (track: PlayableTrack) => void;
	}

	let { onTrackSelect }: Props = $props();

	// Close track menus when clicking outside
	onMount(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			// Check if click is outside any menu
			if (
				!target.closest('.track-menu-container') &&
				!target.closest('button[title="Queue actions"]')
			) {
				activeMenuId = null;
			}
		};

		document.addEventListener('click', handleClickOutside);

		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});

	async function fetchWithRetry<T>(
		action: () => Promise<T>,
		attempts = 3,
		delayMs = 250
	): Promise<T> {
		let lastError: unknown = null;
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				return await action();
			} catch (err) {
				lastError = err;
				if (attempt < attempts) {
					await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
				}
			}
		}
		throw lastError instanceof Error ? lastError : new Error('Request failed');
	}

	function markCancelled(trackId: number | string) {
		const next = new Set(cancelledIds);
		next.add(trackId);
		cancelledIds = next;
		setTimeout(() => {
			const updated = new Set(cancelledIds);
			updated.delete(trackId);
			cancelledIds = updated;
		}, 1500);
	}

	function handleCancelDownload(trackId: number | string, event: MouseEvent) {
		event.stopPropagation();
		const taskId = downloadTaskIds.get(trackId);
		if (taskId) {
			downloadUiStore.cancelTrackDownload(taskId);
		}
		const next = new Set(downloadingIds);
		next.delete(trackId);
		downloadingIds = next;
		const taskMap = new Map(downloadTaskIds);
		taskMap.delete(trackId);
		downloadTaskIds = taskMap;
		markCancelled(trackId);
	}

	async function handleDownload(track: PlayableTrack, event?: MouseEvent) {
		if (event) {
			event.stopPropagation();
		}

		let trackId: number;
		let artistName: string;
		let albumTitle: string | undefined;

		// Handle SonglinkTracks
		if (isSonglinkTrack(track)) {
			if (track.tidalId) {
				trackId = track.tidalId;
				artistName = track.artistName;
				albumTitle = undefined;
			} else {
				console.warn('Cannot download SonglinkTrack directly - play it first to convert to TIDAL');
				alert('This track needs to be played first before it can be downloaded. Click to play it, then download.');
				return;
			}
		} else {
			trackId = track.id;
			artistName = formatArtists(track.artists);
			albumTitle = track.album?.title;
		}

		// Guard against non-numeric IDs
		if (!Number.isFinite(trackId) || trackId <= 0) {
			console.error('Cannot download track with invalid ID:', track.id);
			alert('Cannot download this track - invalid track ID');
			return;
		}

		// Use the original ID for tracking active downloads in the UI to avoid confusion
		// (since the UI list might still be using the string ID)
		const uiTrackId = track.id;

		if (downloadingIds.has(uiTrackId)) {
			return;
		}
		const next = new Set(downloadingIds);
		next.add(uiTrackId);
		downloadingIds = next;

		const quality = $userPreferencesStore.playbackQuality;
		const extension = getExtensionForQuality(quality, convertAacToMp3Preference);
		
		// Format title with version if present
		let title = track.title;
		if ('version' in track && track.version) {
			title = `${title} (${track.version})`;
		}
		
		const filename = `${artistName} - ${title}.${extension}`;
		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: albumTitle ?? artistName
		});
		const taskMap = new Map(downloadTaskIds);
		taskMap.set(uiTrackId, taskId);
		downloadTaskIds = taskMap;
		downloadUiStore.skipFfmpegCountdown();

		try {
			await losslessAPI.downloadTrack(trackId, quality, filename, {
				signal: controller.signal,
				onProgress: (progress: TrackDownloadProgress) => {
					if (progress.stage === 'downloading') {
						downloadUiStore.updateTrackProgress(
							taskId,
							progress.receivedBytes,
							progress.totalBytes
						);
					} else {
						downloadUiStore.updateTrackStage(taskId, progress.progress);
					}
				},
				onFfmpegCountdown: ({ totalBytes }) => {
					if (typeof totalBytes === 'number') {
						downloadUiStore.startFfmpegCountdown(totalBytes, { autoTriggered: false });
					} else {
						downloadUiStore.startFfmpegCountdown(0, { autoTriggered: false });
					}
				},
				onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
				onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
				onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
				onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
				ffmpegAutoTriggered: false,
				convertAacToMp3: convertAacToMp3Preference,
				downloadCoverSeperately: downloadCoverSeperatelyPreference
			});

			downloadUiStore.completeTrackDownload(taskId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				downloadUiStore.completeTrackDownload(taskId);
			} else {
				console.error('Failed to download track:', error);
				const fallbackMessage = 'Failed to download track. Please try again.';
				const message = error instanceof Error && error.message ? error.message : fallbackMessage;
				downloadUiStore.errorTrackDownload(taskId, message);
				alert(message);
			}
		} finally {
			const next = new Set(downloadingIds);
			next.delete(uiTrackId);
			downloadingIds = next;
			const taskMap = new Map(downloadTaskIds);
			taskMap.delete(uiTrackId);
			downloadTaskIds = taskMap;
		}
	}

	function patchAlbumDownloadState(albumId: number, patch: Partial<AlbumDownloadState>) {
		const previous = albumDownloadStates[albumId] ?? {
			downloading: false,
			completed: 0,
			total: 0,
			error: null
		};
		albumDownloadStates = {
			...albumDownloadStates,
			[albumId]: { ...previous, ...patch }
		};
	}

	async function handleAlbumDownloadClick(album: Album, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();

		if (albumDownloadStates[album.id]?.downloading) {
			return;
		}

		patchAlbumDownloadState(album.id, {
			downloading: true,
			completed: 0,
			total: album.numberOfTracks ?? 0,
			error: null
		});

		const quality = albumDownloadQuality;

		try {
			await downloadAlbum(
				album,
				quality,
				{
					onTotalResolved: (total) => {
						patchAlbumDownloadState(album.id, { total });
					},
					onTrackDownloaded: (completed, total) => {
						patchAlbumDownloadState(album.id, { completed, total });
					}
				},
				album.artist?.name,
				{
					mode: albumDownloadMode,
					convertAacToMp3: convertAacToMp3Preference,
					downloadCoverSeperately: downloadCoverSeperatelyPreference
				}
			);
			const finalState = albumDownloadStates[album.id];
			patchAlbumDownloadState(album.id, {
				downloading: false,
				completed: finalState?.total ?? finalState?.completed ?? 0,
				error: null
			});
		} catch (err) {
			console.error('Failed to download album:', err);
			const message =
				err instanceof Error && err.message
					? err.message
					: 'Failed to download album. Please try again.';
			patchAlbumDownloadState(album.id, { downloading: false, error: message });
		}
	}

	function handleTrackActivation(track: PlayableTrack) {
		onTrackSelect?.(track);
	}

	function handleAddToQueue(track: PlayableTrack, event: MouseEvent) {
		event.stopPropagation();
		playerStore.enqueue(track);
	}

	function handlePlayNext(track: PlayableTrack, event: MouseEvent) {
		event.stopPropagation();
		playerStore.enqueueNext(track);
	}

	function handleTrackKeydown(event: KeyboardEvent, track: PlayableTrack) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleTrackActivation(track);
		}
	}

	$effect(() => {
		const activeIds = new Set(searchStore.albums.map((album) => album.id));
		let mutated = false;
		const nextState: Record<number, AlbumDownloadState> = {};
		for (const [albumId, state] of Object.entries(albumDownloadStates)) {
			const numericId = Number(albumId);
			if (activeIds.has(numericId)) {
				nextState[numericId] = state;
			} else {
				mutated = true;
			}
		}
		if (mutated) {
			albumDownloadStates = nextState;
		}
	});

	async function handleUrlImport() {
		if (!searchStore.query.trim()) return;

		searchStore.isLoading = true;
		searchStore.error = null;

		try {
			const result = await losslessAPI.importFromUrl(searchStore.query);

			// Clear previous results
			searchStore.tracks = [];
			searchStore.albums = [];
			searchStore.artists = [];
			searchStore.playlists = [];

			// Set results based on type
			switch (result.type) {
				case 'track':
					searchStore.tracks = [result.data as Track];
					searchStore.activeTab = 'tracks';
					break;
				case 'album':
					searchStore.albums = [result.data as Album];
					searchStore.activeTab = 'albums';
					break;
				case 'artist':
					searchStore.artists = [result.data as Artist];
					searchStore.activeTab = 'artists';
					break;
				case 'playlist': {
					const playlistData = result.data as { playlist: Playlist; tracks: Track[] };
					searchStore.playlists = [playlistData.playlist];
					searchStore.tracks = playlistData.tracks;
					searchStore.activeTab = 'playlists';
					break;
				}
			}
		} catch (err) {
			searchStore.error = err instanceof Error ? err.message : 'Failed to import from URL';
			console.error('URL import error:', err);
		} finally {
			searchStore.isLoading = false;
		}
	}

	async function handleSearch() {
		if (!searchStore.query.trim()) return;

		// Auto-detect: if query is a Tidal URL, import it directly
		if (isQueryATidalUrl) {
			await handleUrlImport();
			return;
		}

		// Auto-detect: if query is a Spotify playlist, convert it
		if (isQueryASpotifyPlaylist) {
			await handleSpotifyPlaylistConversion();
			return;
		}

		// Auto-detect: if query is a streaming platform URL, convert it first
		if (isQueryAStreamingUrl) {
			await handleStreamingUrlConversion();
			return;
		}

		searchStore.isLoading = true;
		searchStore.error = null;

		try {
			switch (searchStore.activeTab) {
				case 'tracks': {
					const response = await fetchWithRetry(() =>
						losslessAPI.searchTracks(searchStore.query, selectedRegion)
					);
					searchStore.tracks = Array.isArray(response?.items) ? response.items : [];
					break;
				}
				case 'albums': {
					const response = await losslessAPI.searchAlbums(searchStore.query, selectedRegion);
					searchStore.albums = Array.isArray(response?.items) ? response.items : [];
					break;
				}
				case 'artists': {
					const response = await losslessAPI.searchArtists(searchStore.query, selectedRegion);
					searchStore.artists = Array.isArray(response?.items) ? response.items : [];
					break;
				}
				case 'playlists': {
					const response = await losslessAPI.searchPlaylists(searchStore.query, selectedRegion);
					searchStore.playlists = Array.isArray(response?.items) ? response.items : [];
					break;
				}
			}
		} catch (err) {
			searchStore.error = err instanceof Error ? err.message : 'Search failed';
			console.error('Search error:', err);
		} finally {
			searchStore.isLoading = false;
		}
	}

	async function handleStreamingUrlConversion() {
		if (!searchStore.query.trim()) {
			return;
		}

		searchStore.isLoading = true;
		searchStore.error = null;

		try {
			const platformName = getPlatformName(searchStore.query.trim());
			console.log(`Converting ${platformName || 'streaming'} URL to TIDAL...`);

			const tidalInfo = await convertToTidal(searchStore.query.trim(), {
				userCountry: 'US',
				songIfSingle: true
			});

			if (!tidalInfo) {
				searchStore.error = `Could not find TIDAL equivalent for this ${platformName || 'streaming platform'} link. The content might not be available on TIDAL.`;
				searchStore.isLoading = false;
				return;
			}

			console.log('Converted to TIDAL:', tidalInfo);

			// Load the TIDAL content based on type
			switch (tidalInfo.type) {
				case 'track': {
					const trackLookup = await losslessAPI.getTrack(Number(tidalInfo.id));
					if (trackLookup?.track) {
						// Pre-cache the stream URL for this track
						try {
							const quality = $playerStore.quality;
							await losslessAPI.getStreamUrl(trackLookup.track.id, quality);
							console.log(`Cached stream for track ${trackLookup.track.id}`);
						} catch (cacheErr) {
							console.warn(`Failed to cache stream for track ${trackLookup.track.id}:`, cacheErr);
						}

						playerStore.setTrack(trackLookup.track);
						playerStore.play();
						searchStore.query = '';
					}
					break;
				}
				case 'album': {
					const albumData = await losslessAPI.getAlbum(Number(tidalInfo.id));
					if (albumData?.album) {
						searchStore.activeTab = 'albums';
						searchStore.albums = [albumData.album];
						searchStore.query = '';
					}
					break;
				}
				case 'playlist': {
					const playlistData = await losslessAPI.getPlaylist(tidalInfo.id);
					if (playlistData?.playlist) {
						searchStore.activeTab = 'playlists';
						searchStore.playlists = [playlistData.playlist];
						searchStore.query = '';
					}
					break;
				}
			}
		} catch (err) {
			searchStore.error = err instanceof Error ? err.message : 'Failed to convert URL';
			console.error('Streaming URL conversion error:', err);
		} finally {
			searchStore.isLoading = false;
		}
	}

	async function handleSpotifyPlaylistConversion() {
		if (!searchStore.query.trim()) {
			return;
		}

		searchStore.error = null;
		searchStore.playlistLoadingMessage = 'Loading playlist...';
		searchStore.isPlaylistConversionMode = true;
		searchStore.isLoading = true;

		try {
			console.log('Fetching Spotify playlist tracks...');

			// Step 1: Get all Spotify track URLs from the playlist
			const spotifyTrackUrls = await convertSpotifyPlaylist(searchStore.query.trim());

			if (!spotifyTrackUrls || spotifyTrackUrls.length === 0) {
				searchStore.error =
					'Could not fetch tracks from Spotify playlist. The playlist might be empty or private.';
				searchStore.playlistLoadingMessage = null;
				searchStore.isLoading = false;
				searchStore.isPlaylistConversionMode = false;
				return;
			}

			console.log(`Found ${spotifyTrackUrls.length} tracks in playlist`);
			searchStore.playlistConversionTotal = spotifyTrackUrls.length;
			searchStore.playlistLoadingMessage = `Loading ${spotifyTrackUrls.length} tracks...`;

			// Clear previous results and switch to tracks tab
			searchStore.activeTab = 'tracks';
			searchStore.tracks = [];

			// Set loading to false so tracks can be displayed as they're added
			searchStore.isLoading = false;

			// Step 2: Fetch Songlink data for all tracks (no TIDAL conversion yet!)
			const conversionPromises = spotifyTrackUrls.map(async (trackUrl, index) => {
				try {
					const songlinkData = await fetchSonglinkData(trackUrl, {
						userCountry: 'US',
						songIfSingle: true
					});

					// Extract TIDAL entity for display
					const tidalEntity = extractTidalSongEntity(songlinkData);

					if (tidalEntity) {
						// Create a SonglinkTrack object (no TIDAL API call!)
						const songlinkTrack: SonglinkTrack = {
							id: songlinkData.entityUniqueId,
							title: tidalEntity.title || 'Unknown Track',
							artistName: tidalEntity.artistName || 'Unknown Artist',
							duration: 180, // Placeholder duration (3 minutes)
							thumbnailUrl: tidalEntity.thumbnailUrl || '',
							sourceUrl: trackUrl,
							songlinkData,
							isSonglinkTrack: true,
							tidalId: tidalEntity.id ? Number(tidalEntity.id) : undefined,
							audioQuality: 'LOSSLESS'
						};

						return { success: true, track: songlinkTrack, url: trackUrl };
					}

					return { success: false, url: trackUrl };
				} catch (err) {
					console.warn(`Failed to fetch Songlink data for track ${index + 1}:`, err);
					return { success: false, url: trackUrl };
				}
			});

			// Wait for all Songlink fetches to complete
			const results = await Promise.allSettled(conversionPromises);

			// Process results and update UI
			const successfulTracks: SonglinkTrack[] = [];
			const failedTracks: string[] = [];

			results.forEach((result, index) => {
				if (result.status === 'fulfilled' && result.value.success && result.value.track) {
					successfulTracks.push(result.value.track);
				} else {
					failedTracks.push(spotifyTrackUrls[index]);
				}

				// Update progress message
				searchStore.playlistLoadingMessage = `Loaded ${index + 1}/${spotifyTrackUrls.length} tracks...`;
			});

			// Update tracks all at once for better performance
			searchStore.tracks = successfulTracks;

			console.log(`Successfully loaded ${searchStore.tracks.length}/${spotifyTrackUrls.length} tracks`);

			if (searchStore.tracks.length === 0) {
				searchStore.error = 'Could not find TIDAL equivalents for any tracks in this playlist.';
				searchStore.playlistLoadingMessage = null;
				searchStore.isPlaylistConversionMode = false;
				return;
			}

			// Show a message if some tracks failed
			if (failedTracks.length > 0) {
				console.warn(`${failedTracks.length} tracks could not be loaded`);
				searchStore.playlistLoadingMessage = `Loaded ${searchStore.tracks.length} tracks (${failedTracks.length} failed)`;
			} else {
				searchStore.playlistLoadingMessage = `Successfully loaded ${searchStore.tracks.length} tracks!`;
			}

			// Clear the query and hide loading message after a brief delay
			searchStore.query = '';
			setTimeout(() => {
				searchStore.playlistLoadingMessage = null;
			}, 3000);
		} catch (err) {
			searchStore.error = err instanceof Error ? err.message : 'Failed to load Spotify playlist';
			console.error('Spotify playlist loading error:', err);
			searchStore.playlistLoadingMessage = null;
			searchStore.isPlaylistConversionMode = false;
		}
	}

	function handlePlayAll() {
		if (searchStore.tracks.length > 0) {
			playerStore.setQueue(searchStore.tracks, 0);
			playerStore.play();
		}
	}

	function handleShuffleAll() {
		if (searchStore.tracks.length > 0) {
			// Shuffle the tracks
			const shuffled = [...searchStore.tracks].sort(() => Math.random() - 0.5);
			playerStore.setQueue(shuffled, 0);
			playerStore.play();
		}
	}

	async function handleDownloadAll() {
		if (searchStore.tracks.length === 0) return;

		const quality = $playerStore.quality;
		const convertAacToMp3Preference = $userPreferencesStore.convertAacToMp3;
		const downloadCoverSeperatelyPreference = $userPreferencesStore.downloadCoversSeperately;

		for (const track of searchStore.tracks) {
			try {
				// Use tidalId if available (for Songlink tracks), otherwise use id
				const trackId = 'tidalId' in track && track.tidalId ? track.tidalId : track.id;
				
				// Skip if we don't have a valid numeric ID (e.g. unconverted Songlink track)
				if (typeof trackId !== 'number') {
					console.warn(`Skipping download for track ${track.title}: No valid TIDAL ID`);
					continue;
				}

				const artistName = 'artistName' in track ? track.artistName : formatArtists(track.artists);
				const albumTitle = 'album' in track ? track.album?.title : undefined;
				
				let title = track.title;
				if ('version' in track && track.version) {
					title = `${title} (${track.version})`;
				}
				
				const filename = `${artistName} - ${title}.${getExtensionForQuality(quality)}`;
				
				const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
					subtitle: albumTitle ?? artistName
				});

				await losslessAPI.downloadTrack(trackId, quality, filename, {
					signal: controller.signal,
					onProgress: (progress: TrackDownloadProgress) => {
						if (progress.stage === 'downloading') {
							downloadUiStore.updateTrackProgress(
								taskId,
								progress.receivedBytes,
								progress.totalBytes
							);
						} else {
							downloadUiStore.updateTrackStage(taskId, progress.progress);
						}
					},
					onFfmpegCountdown: ({ totalBytes }) => {
						if (typeof totalBytes === 'number') {
							downloadUiStore.startFfmpegCountdown(totalBytes, { autoTriggered: false });
						} else {
							downloadUiStore.startFfmpegCountdown(0, { autoTriggered: false });
						}
					},
					onFfmpegStart: () => downloadUiStore.startFfmpegLoading(),
					onFfmpegProgress: (value) => downloadUiStore.updateFfmpegProgress(value),
					onFfmpegComplete: () => downloadUiStore.completeFfmpeg(),
					onFfmpegError: (error) => downloadUiStore.errorFfmpeg(error),
					ffmpegAutoTriggered: false,
					convertAacToMp3: convertAacToMp3Preference,
					downloadCoverSeperately: downloadCoverSeperatelyPreference
				});

				downloadUiStore.completeTrackDownload(taskId);
			} catch (error) {
				console.error(`Failed to download track ${track.title}:`, error);
			}
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSearch();
		}
	}

	function handleTabChange(tab: SearchTab) {
		searchStore.activeTab = tab;
		// Only trigger search if we have a query and it's not a URL
		if (searchStore.query.trim() && !isQueryAUrl) {
			handleSearch();
		}
	}

	function handleRegionChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement | null;
		if (!target) return;
		const value = ensureSupportedRegion(target.value as RegionOption);
		if (value !== selectedRegion) {
			regionStore.setRegion(value);
			// Only trigger search if we have a query and it's not a URL
			if (searchStore.query.trim() && !isQueryAUrl) {
				handleSearch();
			}
		}
		// Close the selector after selection
		isRegionSelectorOpen = false;
	}

	function handleRegionClick(event: MouseEvent) {
		const target = event.currentTarget as HTMLSelectElement | null;
		if (!target) return;
		// Toggle the open state when clicking
		isRegionSelectorOpen = !isRegionSelectorOpen;
	}

	function displayTrackTotal(total?: number | null): number {
		if (!Number.isFinite(total)) return 0;
		return total && total > 0 ? total : (total ?? 0);
	}

	function formatQualityLabel(quality?: string | null): string {
		if (!quality) return '—';
		const normalized = quality.toUpperCase();
		if (normalized === 'LOSSLESS') {
			return 'CD • 16-bit/44.1 kHz FLAC';
		}
		if (normalized === 'HI_RES_LOSSLESS') {
			return 'Hi-Res • up to 24-bit/192 kHz FLAC';
		}
		return quality;
	}

	function asTrack(track: PlayableTrack): Track {
		return track as Track;
	}
</script>

<div class="w-full">
	<!-- Search Input -->
	<div class="mb-6">
		<div
			class="search-glass rounded-lg border px-3 py-2 pr-2 shadow-sm transition-colors focus-within:border-blue-500"
		>
			<div class="flex flex-row gap-2 sm:items-center sm:justify-between">
				<div class="flex min-w-0 flex-1 items-center gap-2">
					<input
						type="text"
						bind:value={searchStore.query}
						onkeypress={handleKeyPress}
						placeholder={isQueryATidalUrl
							? 'Tidal URL detected - press Enter to import'
							: isQueryASpotifyPlaylist
								? 'Spotify playlist detected - press Enter to convert'
								: isQueryAStreamingUrl
									? `${getPlatformName(searchStore.query)} URL detected - press Enter to convert`
									: 'Search for tracks, albums, artists... or paste a URL'}
						class="w-full min-w-0 flex-1 border-none bg-transparent p-0 pl-1 text-white ring-0 placeholder:text-gray-400 focus:outline-none"
					/>
				</div>
				<div class="flex w-auto flex-row items-center gap-2">
					{#if false} <!-- hide the region selector that doesn't even work lol -->
						<div class="relative w-auto">
							<label class="sr-only" for="region-select">Region</label>
							<Earth
								size={18}
								color="#ffffff"
								class="text0white pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
								style="color: #ffffff; z-index: 99;"
							/>
							<select
								id="region-select"
								class="region-selector w-[52px] cursor-pointer appearance-none rounded-md border py-2 pr-9 pl-9 text-sm font-medium text-white ring-0 transition-colors focus:outline-none sm:w-auto"
								value={selectedRegion}
								onchange={handleRegionChange}
								onmousedown={handleRegionClick}
								onblur={() => (isRegionSelectorOpen = false)}
								title="Change search region"
							>
								<option value="auto">Auto</option>
								<option
									value="us"
									disabled={!regionAvailability.us}
									class:opacity-50={!regionAvailability.us}
								>
									US
								</option>
								<option
									value="eu"
									disabled={!regionAvailability.eu}
									class:opacity-50={!regionAvailability.eu}
								>
									EU
								</option>
							</select>
							<span
								class={`region-chevron pointer-events-none absolute top-1/2 right-3 text-gray-400 ${isRegionSelectorOpen ? 'rotate-180' : ''}`}
							>
								<ChevronDown size={16} />
							</span>
						</div>
					{/if}
					<button
						onclick={handleSearch}
						disabled={searchStore.isLoading || !searchStore.query.trim()}
						class="search-button flex h-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
					>
						{#if isQueryASpotifyPlaylist}
							<Link2 size={16} class="text-white" />
							<span class="hidden sm:inline">{searchStore.isLoading ? 'Converting…' : 'Convert Playlist'}</span>
						{:else if isQueryAStreamingUrl}
							<Link2 size={16} class="text-white" />
							<span class="hidden sm:inline">{searchStore.isLoading ? 'Converting…' : 'Convert & Play'}</span>
						{:else if isQueryATidalUrl}
							<Link2 size={16} class="text-white" />
							<span class="hidden sm:inline">{searchStore.isLoading ? 'Importing…' : 'Import'}</span>
						{:else}
							<Search size={16} class="text-white" />
							<span class="hidden sm:inline">{searchStore.isLoading ? 'Searching…' : 'Search'}</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>

	<!-- Tabs (hidden when URL is detected) -->
	{#if !isQueryAUrl}
		<div class="scrollbar-hide mb-6 flex gap-2 overflow-x-auto border-b border-gray-700">
			<button
				onclick={() => handleTabChange('tracks')}
				class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 whitespace-nowrap transition-colors sm:px-4 {searchStore.activeTab ===
				'tracks'
					? 'border-blue-500 text-blue-500'
					: 'border-transparent text-gray-300 hover:text-white'}"
			>
				<Music size={18} />
				<span class="text-sm sm:text-base">Tracks</span>
			</button>
			<button
				onclick={() => handleTabChange('albums')}
				class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 whitespace-nowrap transition-colors sm:px-4 {searchStore.activeTab ===
				'albums'
					? 'border-blue-500 text-blue-500'
					: 'border-transparent text-gray-300 hover:text-white'}"
			>
				<Disc size={18} />
				<span class="text-sm sm:text-base">Albums</span>
			</button>
			<button
				onclick={() => handleTabChange('artists')}
				class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 whitespace-nowrap transition-colors sm:px-4 {searchStore.activeTab ===
				'artists'
					? 'border-blue-500 text-blue-500'
					: 'border-transparent text-gray-300 hover:text-white'}"
			>
				<User size={18} />
				<span class="text-sm sm:text-base">Artists</span>
			</button>
			<button
				onclick={() => handleTabChange('playlists')}
				class="flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 whitespace-nowrap transition-colors sm:px-4 {searchStore.activeTab ===
				'playlists'
					? 'border-blue-500 text-blue-500'
					: 'border-transparent text-gray-300 hover:text-white'}"
			>
				<List size={18} />
				<span class="text-sm sm:text-base">Playlists</span>
			</button>
		</div>
	{/if}

	<!-- Loading State -->
	{#if searchStore.isLoading}
		{#if searchStore.activeTab === 'tracks'}
			<div class="space-y-2">
				{#each trackSkeletons as _}
					<div class="flex w-full items-center gap-3 rounded-lg bg-gray-800/70 p-3">
						<div class="h-12 w-12 flex-shrink-0 animate-pulse rounded bg-gray-700/80"></div>
						<div class="flex-1 space-y-2">
							<div class="h-4 w-2/3 animate-pulse rounded bg-gray-700/80"></div>
							<div class="h-3 w-1/3 animate-pulse rounded bg-gray-700/60"></div>
							<div class="h-3 w-1/4 animate-pulse rounded bg-gray-700/40"></div>
						</div>
						<div class="h-6 w-12 animate-pulse rounded-full bg-gray-700/80"></div>
					</div>
				{/each}
			</div>
		{:else if searchStore.activeTab === 'albums' || searchStore.activeTab === 'playlists'}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each gridSkeletons as _}
					<div class="space-y-3">
						<div class="aspect-square w-full animate-pulse rounded-lg bg-gray-800/70"></div>
						<div class="h-4 w-3/4 animate-pulse rounded bg-gray-700/80"></div>
						<div class="h-3 w-1/2 animate-pulse rounded bg-gray-700/60"></div>
					</div>
				{/each}
			</div>
		{:else if searchStore.activeTab === 'artists'}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each gridSkeletons as _}
					<div class="flex flex-col items-center gap-3">
						<div class="aspect-square w-full animate-pulse rounded-full bg-gray-800/70"></div>
						<div class="h-4 w-3/4 animate-pulse rounded bg-gray-700/80"></div>
						<div class="h-3 w-1/2 animate-pulse rounded bg-gray-700/60"></div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex items-center justify-center py-12">
				<div class="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500"></div>
			</div>
		{/if}
	{/if}

	<!-- Error State -->
	{#if searchStore.error}
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-4 text-red-400">
			{searchStore.error}
		</div>
	{/if}

	<!-- Playlist Loading Progress -->
	{#if searchStore.playlistLoadingMessage}
		<div
			class="mb-4 flex items-center gap-3 rounded-lg border border-blue-900 bg-blue-900/20 p-4 text-blue-400"
		>
			<LoaderCircle class="animate-spin" size={20} />
			<span>{searchStore.playlistLoadingMessage}</span>
		</div>
	{/if}

	<!-- Results -->
	{#if (!searchStore.isLoading && !searchStore.error) || (searchStore.isPlaylistConversionMode && searchStore.tracks.length > 0)}
		{#if searchStore.activeTab === 'tracks' && searchStore.tracks.length > 0}
			<!-- Playlist Controls (shown when in playlist conversion mode) -->
			{#if searchStore.isPlaylistConversionMode}
				<div class="mb-6 flex flex-wrap items-center gap-3">
					<button
						onclick={handlePlayAll}
						class="flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-semibold transition-colors hover:bg-blue-700"
					>
						<Play size={20} fill="currentColor" />
						Play All
					</button>
					<button
						onclick={handleShuffleAll}
						class="flex items-center gap-2 rounded-full bg-purple-600 px-6 py-3 font-semibold transition-colors hover:bg-purple-700"
					>
						<Shuffle size={20} />
						Shuffle All
					</button>
					<button
						onclick={handleDownloadAll}
						class="flex items-center gap-2 rounded-full bg-green-600 px-6 py-3 font-semibold transition-colors hover:bg-green-700"
					>
						<Download size={20} />
						Download All
					</button>
					<div class="ml-auto text-sm text-gray-400">
						{searchStore.tracks.length} of {searchStore.playlistConversionTotal} tracks
					</div>
				</div>
			{/if}

			<div class="space-y-2">
				{#each searchStore.tracks as track}
					<div
						role="button"
						tabindex="0"
						onclick={(e) => {
							if (e.target instanceof Element && (e.target.closest('a') || e.target.closest('button'))) return;
							handleTrackActivation(track);
						}}
						onkeydown={(event) => handleTrackKeydown(event, track)}
						class="track-glass group flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors hover:brightness-110 focus:ring-2 focus:ring-blue-500 focus:outline-none {activeMenuId === track.id ? 'z-20 relative' : ''}"
					>
						{#if isSonglinkTrack(track)}
							<!-- Display for SonglinkTrack -->
							<img
								src={track.thumbnailUrl || '/placeholder-album.jpg'}
								alt={`${track.title} by ${track.artistName}`}
								class="h-12 w-12 flex-shrink-0 rounded object-cover"
							/>
							<div class="min-w-0 flex-1">
								<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
									{track.title}
								</h3>
								<p class="truncate text-sm text-gray-400">
									{track.artistName}
								</p>
								<p class="text-xs text-gray-500">
									{formatQualityLabel(track.audioQuality)}
								</p>
							</div>
							<!-- Queue actions for Songlink tracks -->
							<div class="flex items-center gap-2 text-sm text-gray-400">
								<div class="relative">
									<button
										onclick={(event) => {
											event.stopPropagation();
											activeMenuId = activeMenuId === track.id ? null : track.id;
										}}
										class="rounded-full p-2 text-gray-400 transition-colors hover:text-white"
										title="Queue actions"
										aria-label="Queue actions for {track.title}"
									>
										<MoreVertical size={18} />
									</button>
									<!-- Dropdown menu for queue actions -->
									{#if activeMenuId === track.id}
										<div
											class="track-menu-container absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-700 bg-gray-800 shadow-lg"
										>
											<button
												onclick={(event) => {
													handlePlayNext(track, event);
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<ListVideo size={16} />
												Play Next
											</button>
											<button
												onclick={(event) => {
													handleAddToQueue(track, event);
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<ListPlus size={16} />
												Add to Queue
											</button>
											<div class="my-1 border-t border-gray-700"></div>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getLongLink('track', track.id));
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<Link2 size={16} />
												Share Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getShortLink('track', track.id));
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<Copy size={16} />
												Share Short Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getEmbedCode('track', track.id));
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<Code size={16} />
												Copy Embed Code
											</button>
										</div>
									{/if}
								</div>
							</div>
						{:else}
							<!-- Display for regular Track -->
							{#if asTrack(track).album.cover}
								<img
									src={losslessAPI.getCoverUrl(asTrack(track).album.cover, '160')}
									alt={track.title}
									class="h-12 w-12 rounded object-cover"
								/>
							{/if}
							<div class="min-w-0 flex-1">
								<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
									{track.title}{asTrack(track).version ? ` (${asTrack(track).version})` : ''}
									{#if asTrack(track).explicit}
										<svg
											class="inline h-4 w-4 flex-shrink-0 align-middle"
											xmlns="http://www.w3.org/2000/svg"
											fill="currentColor"
											height="24"
											viewBox="0 0 24 24"
											width="24"
											focusable="false"
											aria-hidden="true"
											><path
												d="M20 2H4a2 2 0 00-2 2v16a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2ZM8 6h8a1 1 0 110 2H9v3h5a1 1 0 010 2H9v3h7a1 1 0 010 2H8a1 1 0 01-1-1V7a1 1 0 011-1Z"
											></path></svg
										>
									{/if}
								</h3>
								<a
									href={`/artist/${asTrack(track).artist.id}`}
									class="inline-block truncate text-sm text-gray-400 hover:text-blue-400 hover:underline"
									data-sveltekit-preload-data
								>
									{formatArtists(asTrack(track).artists)}
								</a>
								<p class="text-xs text-gray-500">
									<a
										href={`/album/${asTrack(track).album.id}`}
										class="hover:text-blue-400 hover:underline"
										data-sveltekit-preload-data
									>
										{asTrack(track).album.title}
									</a>
									• {formatQualityLabel(track.audioQuality)}
								</p>
							</div>
							<div class="flex items-center gap-2 text-sm text-gray-400">
								<button
									onclick={(event) =>
										downloadingIds.has(track.id)
											? handleCancelDownload(track.id, event)
											: handleDownload(track, event)}
									class="rounded-full p-2 text-gray-400 transition-colors hover:text-white"
									title={downloadingIds.has(track.id) ? 'Cancel download' : 'Download track'}
									aria-label={downloadingIds.has(track.id)
										? `Cancel download for ${track.title}`
										: `Download ${track.title}`}
									aria-busy={downloadingIds.has(track.id)}
									aria-pressed={downloadingIds.has(track.id)}
								>
									{#if downloadingIds.has(track.id)}
										<span class="flex h-4 w-4 items-center justify-center">
											{#if cancelledIds.has(track.id)}
												<X size={14} />
											{:else}
												<span
													class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
												></span>
											{/if}
										</span>
									{:else if cancelledIds.has(track.id)}
										<X size={18} />
									{:else}
										<Download size={18} />
									{/if}
								</button>
								<div class="relative">
									<button
										onclick={(event) => {
											event.stopPropagation();
											activeMenuId = activeMenuId === track.id ? null : track.id;
										}}
										class="rounded-full p-2 text-gray-400 transition-colors hover:text-white"
										title="Queue actions"
										aria-label="Queue actions for {track.title}"
									>
										<MoreVertical size={18} />
									</button>
									{#if activeMenuId === track.id}
										<div
											class="track-menu-container absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-700 bg-gray-800 shadow-lg"
										>
											<button
												onclick={(event) => {
													handlePlayNext(track, event);
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<ListVideo size={16} />
												Play Next
											</button>
											<button
												onclick={(event) => {
													handleAddToQueue(track, event);
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<ListPlus size={16} />
												Add to Queue
											</button>
											<div class="my-1 border-t border-gray-700"></div>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getLongLink('track', track.id));
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<Link2 size={16} />
												Share Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getShortLink('track', track.id));
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<Copy size={16} />
												Share Short Link
											</button>
											<button
												onclick={(event) => {
													event.stopPropagation();
													copyToClipboard(getEmbedCode('track', track.id));
													activeMenuId = null;
												}}
												class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
											>
												<Code size={16} />
												Copy Embed Code
											</button>
										</div>
									{/if}
								</div>
							</div>
						{/if}
						{#if !('isSonglinkTrack' in track && track.isSonglinkTrack)}
							<span>{losslessAPI.formatDuration(track.duration)}</span>
						{/if}
					</div>
				{/each}
			</div>
		{:else if searchStore.activeTab === 'albums' && searchStore.albums.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each searchStore.albums as album}
					<div class="group relative text-left">
						<button
							onclick={(event) => handleAlbumDownloadClick(album, event)}
							type="button"
							class="absolute top-3 right-3 z-40 flex items-center justify-center rounded-full bg-black/50 p-2 text-gray-200 backdrop-blur-md transition-colors hover:bg-blue-600/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
							disabled={albumDownloadStates[album.id]?.downloading}
							aria-label={`Download ${album.title}`}
						>
							{#if albumDownloadStates[album.id]?.downloading}
								<LoaderCircle size={16} class="animate-spin" />
							{:else}
								<Download size={16} />
							{/if}
						</button>
						<a
							href={`/album/${album.id}`}
							class="flex w-full flex-col text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
							data-sveltekit-preload-data
						>
							<div class="relative mb-2 aspect-square overflow-hidden rounded-lg">
								{#if album.videoCover}
									<video
										src={losslessAPI.getVideoCoverUrl(album.videoCover, '640')}
										poster={album.cover ? losslessAPI.getCoverUrl(album.cover, '640') : undefined}
										aria-label={album.title}
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
										autoplay
										loop
										muted
										playsinline
										preload="metadata"
									></video>
								{:else if album.cover}
									<img
										src={losslessAPI.getCoverUrl(album.cover, '640')}
										alt={album.title}
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
								{:else}
									<div
										class="flex h-full w-full items-center justify-center bg-gray-800 text-sm text-gray-500"
									>
										No artwork
									</div>
								{/if}
							</div>
							<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
								{album.title}
								{#if album.explicit}
									<svg
										class="inline h-4 w-4 flex-shrink-0 align-middle"
										xmlns="http://www.w3.org/2000/svg"
										fill="currentColor"
										height="24"
										viewBox="0 0 24 24"
										width="24"
										focusable="false"
										aria-hidden="true"
										><path
											d="M20 2H4a2 2 0 00-2 2v16a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2ZM8 6h8a1 1 0 110 2H9v3h5a1 1 0 010 2H9v3h7a1 1 0 010 2H8a1 1 0 01-1-1V7a1 1 0 011-1Z"
										></path></svg
									>
								{/if}
							</h3>
							{#if album.artist}
								<p class="truncate text-sm text-gray-400">{album.artist.name}</p>
							{/if}
							{#if album.releaseDate}
								<p class="text-xs text-gray-500">{album.releaseDate.split('-')[0]}</p>
							{/if}
						</a>
						{#if albumDownloadStates[album.id]?.downloading}
							<p class="mt-2 text-xs text-blue-300">
								Downloading
								{#if albumDownloadStates[album.id]?.total}
									{albumDownloadStates[album.id]?.completed ?? 0}/{displayTrackTotal(
										albumDownloadStates[album.id]?.total ?? 0
									)}
								{:else}
									{albumDownloadStates[album.id]?.completed ?? 0}
								{/if}
								tracks…
							</p>
						{:else if albumDownloadStates[album.id]?.error}
							<p class="mt-2 text-xs text-red-400" role="alert">
								{albumDownloadStates[album.id]?.error}
							</p>
						{/if}
					</div>
				{/each}
			</div>
		{:else if searchStore.activeTab === 'artists' && searchStore.artists.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each searchStore.artists as artist}
					<a href={`/artist/${artist.id}`} class="group text-center" data-sveltekit-preload-data>
						<div class="relative mb-2 aspect-square overflow-hidden rounded-full">
							{#if artist.picture}
								<img
									src={losslessAPI.getArtistPictureUrl(artist.picture)}
									alt={artist.name}
									class="h-full w-full object-cover transition-transform group-hover:scale-105"
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center bg-gray-800">
									<User size={48} class="text-gray-600" />
								</div>
							{/if}
						</div>
						<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
							{artist.name}
						</h3>
						<p class="text-xs text-gray-500">Artist</p>
					</a>
				{/each}
			</div>
		{:else if searchStore.activeTab === 'playlists' && searchStore.playlists.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each searchStore.playlists as playlist}
					<a
						href={`/playlist/${playlist.uuid}`}
						class="group text-left"
						data-sveltekit-preload-data
					>
						<div class="relative mb-2 aspect-square overflow-hidden rounded-lg">
							{#if playlist.squareImage || playlist.image}
								<img
									src={losslessAPI.getCoverUrl(playlist.squareImage || playlist.image, '640')}
									alt={playlist.title}
									class="h-full w-full object-cover transition-transform group-hover:scale-105"
								/>
							{/if}
						</div>
						<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
							{playlist.title}
						</h3>
						<p class="truncate text-sm text-gray-400">{playlist.creator.name}</p>
						<p class="text-xs text-gray-500">{playlist.numberOfTracks} tracks</p>
					</a>
			{/each}
			</div>
			<!-- News Section -->
		{:else if !searchStore.query.trim()}
			<div class="news-container rounded-lg border p-4">
				<h2 class="mb-4 text-3xl font-bold">News</h2>
				<section class="grid gap-4 text-left shadow-lg sm:grid-cols-2">
					{#each newsItems as item}
						<article
							class="news-card flex flex-col gap-3 rounded-lg border p-4 transition-transform hover:-translate-y-0.5"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-900/40 text-blue-300"
								>
									<Newspaper size={20} />
								</div>
								<h3 class="text-lg font-semibold text-white">{item.title}</h3>
							</div>
							<p class="text-sm text-gray-300">{item.description}</p>
						</article>
					{/each}
				</section>
			</div>
		{:else if isQueryATidalUrl && !searchStore.isLoading}
			<div class="py-12 text-center text-gray-400">
				<div class="flex flex-col items-center gap-4">
					<Link2 size={48} class="text-blue-400" />
					<p class="text-lg text-white">Tidal URL detected</p>
					<p class="text-sm">Press Enter or click Import to load this content</p>
				</div>
			</div>
		{:else if searchStore.query.trim() && !searchStore.isLoading && !isQueryATidalUrl}
			<div class="py-12 text-center text-gray-400">
				<p>No results found...</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.search-glass {
		background: transparent;
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 10px 30px rgba(2, 6, 23, 0.4),
			0 2px 8px rgba(15, 23, 42, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.track-glass {
		background: transparent;
		border: 1px solid rgba(148, 163, 184, 0.15);
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px))
			saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 4px 12px rgba(2, 6, 23, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease,
			filter 0.2s ease;
	}

	.region-selector {
		background: transparent;
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-high, 32px)) saturate(var(--perf-saturate, 160%));
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	.region-selector:hover {
		border-color: var(--bloom-accent, rgba(148, 163, 184, 0.3));
		box-shadow:
			0 6px 20px rgba(2, 6, 23, 0.4),
			0 2px 8px rgba(15, 23, 42, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.region-selector:focus {
		border-color: var(--bloom-accent, #3b82f6);
		box-shadow:
			0 6px 20px rgba(2, 6, 23, 0.4),
			0 2px 8px rgba(15, 23, 42, 0.3),
			0 0 0 3px color-mix(in srgb, var(--bloom-accent, #3b82f6) 15%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}

	.region-chevron {
		transition: transform 200ms ease;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transform: translateY(-50%);
	}

	.region-chevron.rotate-180 {
		transform: translateY(-50%) rotate(180deg);
	}

	/* Tab buttons dynamic styling */
	button.border-blue-500 {
		border-color: rgb(96, 165, 250) !important;
		color: rgb(96, 165, 250);
		transition:
			border-color 0.2s ease,
			color 0.2s ease;
	}

	/* Search button acrylic styling */
	.search-button {
		background: rgba(59, 130, 246, 0.85);
		border: 1px solid rgba(59, 130, 246, 0.4);
		backdrop-filter: blur(16px) saturate(140%);
		-webkit-backdrop-filter: blur(16px) saturate(140%);
		box-shadow:
			0 4px 12px rgba(59, 130, 246, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.1);
		transition:
			background 0.3s ease,
			border-color 0.3s ease,
			box-shadow 0.3s ease,
			opacity 0.2s ease;
	}

	.search-button:hover:not(:disabled) {
		background: rgba(59, 130, 246, 0.95);
		box-shadow:
			0 6px 18px rgba(59, 130, 246, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.15);
	}

	/* News container acrylic styling */
	.news-container {
		background: transparent;
		border-color: rgba(148, 163, 184, 0.2);
		backdrop-filter: blur(var(--perf-blur-medium, 28px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-medium, 28px))
			saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 8px 24px rgba(2, 6, 23, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease;
	}

	/* News card acrylic styling */
	.news-card {
		background: transparent;
		border-color: rgba(148, 163, 184, 0.18);
		backdrop-filter: blur(var(--perf-blur-low, 24px)) saturate(var(--perf-saturate, 160%));
		-webkit-backdrop-filter: blur(var(--perf-blur-low, 24px)) saturate(var(--perf-saturate, 160%));
		box-shadow:
			0 4px 12px rgba(2, 6, 23, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		transition:
			border-color 1.2s cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 0.3s ease,
			transform 0.2s ease;
	}

	.news-card:hover {
		border-color: rgba(148, 163, 184, 0.3);
		box-shadow:
			0 6px 18px rgba(2, 6, 23, 0.4),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
	}

	/* Improved contrast for grey text */
	:global(.text-gray-400) {
		color: rgb(156, 163, 175) !important;
	}

	:global(.text-gray-500) {
		color: rgb(115, 125, 140) !important;
	}

	/* Better placeholder contrast */
	input::placeholder {
		color: rgb(156, 163, 175) !important;
		opacity: 1;
	}

	/* Hide scrollbar for mobile tabs */
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}

	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
