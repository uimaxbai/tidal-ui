<script lang="ts">
	import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
	import { downloadAlbum } from '$lib/downloads';
	import { playerStore } from '$lib/stores/player';
	import { downloadUiStore } from '$lib/stores/downloadUi';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import type { Track, Album, Artist, Playlist, AudioQuality } from '$lib/types';
	import {
		Search,
		Music,
		User,
		Disc,
		Download,
		Newspaper,
		ListPlus,
		ListVideo,
		LoaderCircle,
		X
	} from 'lucide-svelte';

	type SearchTab = 'tracks' | 'albums' | 'artists' | 'playlists';

	let query = $state('');
	let activeTab = $state<SearchTab>('tracks');
	let isLoading = $state(false);
	let tracks = $state<Track[]>([]);
	let albums = $state<Album[]>([]);
	let artists = $state<Artist[]>([]);
	let playlists = $state<Playlist[]>([]);
	let downloadingIds = $state(new Set<number>());
	let downloadTaskIds = $state(new Map<number, string>());
	let cancelledIds = $state(new Set<number>());
	let error = $state<string | null>(null);
	const albumDownloadQuality = $derived($playerStore.quality as AudioQuality);
	const albumDownloadMode = $derived($downloadPreferencesStore.mode);

	type AlbumDownloadState = {
		downloading: boolean;
		completed: number;
		total: number;
		error: string | null;
	};

	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});

	const newsItems = [
		{
			title: 'Hi-Res Audio',
			description: 'Streaming for Hi-Res is now here. Stay tuned for Hi-Res downloading - I haven\'t gotten that one figured out yet. And video covers. Pretty cool.'
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
		onTrackSelect?: (track: Track) => void;
		onAlbumSelect?: (album: Album) => void;
		onArtistSelect?: (artist: Artist) => void;
		onPlaylistSelect?: (playlist: Playlist) => void;
	}

	let { onTrackSelect, onAlbumSelect, onArtistSelect, onPlaylistSelect }: Props = $props();

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

	function markCancelled(trackId: number) {
		const next = new Set(cancelledIds);
		next.add(trackId);
		cancelledIds = next;
		setTimeout(() => {
			const updated = new Set(cancelledIds);
			updated.delete(trackId);
			cancelledIds = updated;
		}, 1500);
	}

	function handleCancelDownload(trackId: number, event: MouseEvent) {
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

	async function handleDownload(track: Track, event: MouseEvent) {
		event.stopPropagation();
		const next = new Set(downloadingIds);
		next.add(track.id);
		downloadingIds = next;

		const filename = `${track.artist.name} - ${track.title}.flac`;
		const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename, {
			subtitle: track.album?.title ?? track.artist?.name
		});
		const taskMap = new Map(downloadTaskIds);
		taskMap.set(track.id, taskId);
		downloadTaskIds = taskMap;
		downloadUiStore.skipFfmpegCountdown();

		try {
			await losslessAPI.downloadTrack(track.id, $playerStore.quality, filename, {
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
				ffmpegAutoTriggered: false
			});
			downloadUiStore.completeTrackDownload(taskId);
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				downloadUiStore.completeTrackDownload(taskId);
				markCancelled(track.id);
			} else {
				console.error('Failed to download track:', err);
				const fallbackMessage = 'Failed to download track. Please try again.';
				const message = err instanceof Error && err.message ? err.message : fallbackMessage;
				downloadUiStore.errorTrackDownload(taskId, message);
				alert(message);
			}
		} finally {
			const updated = new Set(downloadingIds);
			updated.delete(track.id);
			downloadingIds = updated;
			const ids = new Map(downloadTaskIds);
			ids.delete(track.id);
			downloadTaskIds = ids;
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
				{ mode: albumDownloadMode }
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

	function handleTrackActivation(track: Track) {
		onTrackSelect?.(track);
	}

	function handleAddToQueue(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playerStore.enqueue(track);
	}

	function handlePlayNext(track: Track, event: MouseEvent) {
		event.stopPropagation();
		playerStore.enqueueNext(track);
	}

	function handleTrackKeydown(event: KeyboardEvent, track: Track) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleTrackActivation(track);
		}
	}

	$effect(() => {
		const activeIds = new Set(albums.map((album) => album.id));
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

	async function handleSearch() {
		if (!query.trim()) return;

		isLoading = true;
		error = null;

		try {
			switch (activeTab) {
				case 'tracks': {
					const response = await fetchWithRetry(() => losslessAPI.searchTracks(query));
					tracks = Array.isArray(response?.items) ? response.items : [];
					break;
				}
				case 'albums': {
					const response = await losslessAPI.searchAlbums(query);
					albums = Array.isArray(response?.items) ? response.items : [];
					break;
				}
				case 'artists': {
					const response = await losslessAPI.searchArtists(query);
					artists = Array.isArray(response?.items) ? response.items : [];
					break;
				}
				case 'playlists': {
					const response = await losslessAPI.searchPlaylists(query);
					playlists = Array.isArray(response?.items) ? response.items : [];
					break;
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Search failed';
			console.error('Search error:', err);
		} finally {
			isLoading = false;
		}
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			handleSearch();
		}
	}

	function handleTabChange(tab: SearchTab) {
		activeTab = tab;
		if (query.trim()) {
			handleSearch();
		}
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
</script>

<div class="w-full">
	<!-- Search Input -->
	<div class="relative mb-6">
		<input
			type="text"
			bind:value={query}
			onkeypress={handleKeyPress}
			placeholder="Search for anything..."
			class="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 pl-12 text-white transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
		/>
		<Search class="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400" size={20} />
		<button
			onclick={handleSearch}
			disabled={isLoading || !query.trim()}
			class="absolute top-1/2 right-2 -translate-y-1/2 rounded-md bg-blue-600 px-4 py-1.5 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{isLoading ? 'Searching...' : 'Search'}
		</button>
	</div>

	<!-- Tabs -->
	<div class="mb-6 flex gap-2 overflow-auto border-b border-gray-700">
		<button
			onclick={() => handleTabChange('tracks')}
			class="flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2 transition-colors {activeTab ===
			'tracks'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<Music size={18} />
			Tracks
		</button>
		<button
			onclick={() => handleTabChange('albums')}
			class="flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2 transition-colors {activeTab ===
			'albums'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<Disc size={18} />
			Albums
		</button>
		<button
			onclick={() => handleTabChange('artists')}
			class="flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2 transition-colors {activeTab ===
			'artists'
				? 'border-blue-500 text-blue-500'
				: 'border-transparent text-gray-400 hover:text-white'}"
		>
			<User size={18} />
			Artists
		</button>
	</div>

	<!-- Loading State -->
	{#if isLoading}
		{#if activeTab === 'tracks'}
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
		{:else if activeTab === 'albums' || activeTab === 'playlists'}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each gridSkeletons as _}
					<div class="space-y-3">
						<div class="aspect-square w-full animate-pulse rounded-lg bg-gray-800/70"></div>
						<div class="h-4 w-3/4 animate-pulse rounded bg-gray-700/80"></div>
						<div class="h-3 w-1/2 animate-pulse rounded bg-gray-700/60"></div>
					</div>
				{/each}
			</div>
		{:else if activeTab === 'artists'}
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
	{#if error}
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-4 text-red-400">
			{error}
		</div>
	{/if}

	<!-- Results -->
	{#if !isLoading && !error}
		{#if activeTab === 'tracks' && tracks.length > 0}
			<div class="space-y-2">
				{#each tracks as track}
					<div
						role="button"
						tabindex="0"
						onclick={() => handleTrackActivation(track)}
						onkeydown={(event) => handleTrackKeydown(event, track)}
						class="hover:bg-gray-750 group flex w-full cursor-pointer items-center gap-3 rounded-lg bg-gray-800 p-3 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
					>
						{#if track.album.cover}
							<img
								src={losslessAPI.getCoverUrl(track.album.cover, '160')}
								alt={track.title}
								class="h-12 w-12 rounded object-cover"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							<h3 class="truncate font-semibold text-white group-hover:text-blue-400">
								{track.title}
								{#if track.explicit}
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
							<p class="truncate text-sm text-gray-400">{track.artist.name}</p>
							<p class="text-xs text-gray-500">
								{track.album.title} • {formatQualityLabel(track.audioQuality)}
							</p>
						</div>
						<div class="flex items-center gap-2 text-sm text-gray-400">
							<button
								onclick={(event) => handlePlayNext(track, event)}
								class="rounded-full p-2 text-gray-400 transition-colors hover:text-white"
								title="Play next"
								aria-label={`Play ${track.title} next`}
							>
								<ListVideo size={18} />
							</button>
							<button
								onclick={(event) => handleAddToQueue(track, event)}
								class="rounded-full p-2 text-gray-400 transition-colors hover:text-white"
								title="Add to queue"
								aria-label={`Add ${track.title} to queue`}
							>
								<ListPlus size={18} />
							</button>
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
							<span>{losslessAPI.formatDuration(track.duration)}</span>
						</div>
					</div>
				{/each}
			</div>
		{:else if activeTab === 'albums' && albums.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each albums as album}
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
						<button
							onclick={() => onAlbumSelect?.(album)}
							type="button"
							class="flex w-full flex-col text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
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
						</button>
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
		{:else if activeTab === 'artists' && artists.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
				{#each artists as artist}
					<button onclick={() => onArtistSelect?.(artist)} class="group text-center">
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
					</button>
				{/each}
			</div>
		{:else if activeTab === 'playlists' && playlists.length > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each playlists as playlist}
					<button onclick={() => onPlaylistSelect?.(playlist)} class="group text-left">
						<div class="relative mb-2 aspect-square overflow-hidden rounded-lg">
							{#if playlist.image}
								<img
									src={losslessAPI.getCoverUrl(playlist.image, '640')}
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
					</button>
				{/each}
			</div>
			<!-- News Section -->
		{:else if !query.trim()}
			<div class="rounded-lg border border-gray-800 p-4">
				<h2 class="mb-4 text-3xl font-bold">News</h2>
				<section class="grid gap-4 text-left shadow-lg sm:grid-cols-2">
					{#each newsItems as item}
						<article
							class="flex flex-col gap-3 rounded-lg border border-gray-800/80 bg-gray-900/70 p-4 transition-transform hover:-translate-y-0.5"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-900/40 text-blue-300"
								>
									<Newspaper size={20} />
								</div>
								<h3 class="text-lg font-semibold text-white">{item.title}</h3>
							</div>
							<p class="text-sm text-gray-400">{item.description}</p>
						</article>
					{/each}
				</section>
			</div>
		{:else if query.trim() && !isLoading}
			<div class="py-12 text-center text-gray-400">
				<p>No results found...</p>
			</div>
		{/if}
	{/if}
</div>
