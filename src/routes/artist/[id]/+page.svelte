<script lang="ts">
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import { downloadAlbum } from '$lib/downloads';
	import type { Album, ArtistDetails, AudioQuality } from '$lib/types';
	import TopTracksGrid from '$lib/components/TopTracksGrid.svelte';
	import { onMount } from 'svelte';
	import { ArrowLeft, User, Download, LoaderCircle } from 'lucide-svelte';
	import { playerStore } from '$lib/stores/player';
	import { downloadPreferencesStore } from '$lib/stores/downloadPreferences';
	import { userPreferencesStore } from '$lib/stores/userPreferences';

	let artist = $state<ArtistDetails | null>(null);
	let artistImage = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	const artistId = $derived($page.params.id);
	const topTracks = $derived(artist?.tracks ?? []);
	const discography = $derived(artist?.albums ?? []);
	const downloadQuality = $derived($userPreferencesStore.playbackQuality as AudioQuality);
	const downloadMode = $derived($downloadPreferencesStore.mode);
	const convertAacToMp3Preference = $derived($userPreferencesStore.convertAacToMp3);

	type AlbumDownloadState = {
		downloading: boolean;
		completed: number;
		total: number;
		error: string | null;
		failedTracks: number;
	};

	let isDownloadingDiscography = $state(false);
	let discographyProgress = $state({ completed: 0, total: 0 });
	let discographyError = $state<string | null>(null);
	let albumDownloadStates = $state<Record<number, AlbumDownloadState>>({});

	onMount(async () => {
		if (artistId) {
			await loadArtist(parseInt(artistId));
		}
	});

	function getReleaseYear(date?: string | null): string | null {
		if (!date) return null;
		const timestamp = Date.parse(date);
		if (Number.isNaN(timestamp)) return null;
		return new Date(timestamp).getFullYear().toString();
	}

	function formatAlbumMeta(album: Album): string | null {
		const parts: string[] = [];
		const year = getReleaseYear(album.releaseDate ?? null);
		if (year) parts.push(year);
		if (album.type) parts.push(album.type.replace(/_/g, ' '));
		if (album.numberOfTracks) parts.push(`${album.numberOfTracks} tracks`);
		if (parts.length === 0) return null;
		return parts.join(' • ');
	}

	function displayTrackTotal(total?: number | null): number {
		if (!Number.isFinite(total)) return 0;
		return total && total > 0 ? total + 1 : (total ?? 0);
	}

	function patchAlbumDownloadState(albumId: number, patch: Partial<AlbumDownloadState>) {
		const previous = albumDownloadStates[albumId] ?? {
			downloading: false,
			completed: 0,
			total: 0,
			error: null,
			failedTracks: 0
		};
		albumDownloadStates = {
			...albumDownloadStates,
			[albumId]: { ...previous, ...patch }
		};
	}

	async function handleAlbumDownload(album: Album, event?: MouseEvent) {
		event?.preventDefault();
		event?.stopPropagation();

		if (isDownloadingDiscography || albumDownloadStates[album.id]?.downloading) {
			return;
		}

		patchAlbumDownloadState(album.id, {
			downloading: true,
			completed: 0,
			total: album.numberOfTracks ?? 0,
			error: null
		});

		const quality = downloadQuality;

		try {
			let failedCount = 0;
			await downloadAlbum(
				album,
				quality,
				{
					onTotalResolved: (total) => {
						patchAlbumDownloadState(album.id, { total });
					},
					onTrackDownloaded: (completed, total) => {
						patchAlbumDownloadState(album.id, { completed, total });
					},
					onTrackFailed: (track, error, attempt) => {
						if (attempt >= 3) {
							failedCount++;
							patchAlbumDownloadState(album.id, { failedTracks: failedCount });
						}
					}
				},
				artist?.name,
				{ mode: downloadMode, convertAacToMp3: convertAacToMp3Preference }
			);
			const finalState = albumDownloadStates[album.id];
			patchAlbumDownloadState(album.id, {
				downloading: false,
				completed: finalState?.total ?? finalState?.completed ?? 0,
				error: failedCount > 0 
					? `${failedCount} track${failedCount > 1 ? 's' : ''} failed after 3 attempts`
					: null
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

	async function handleDownloadDiscography() {
		if (!artist || discography.length === 0 || isDownloadingDiscography) {
			return;
		}

		isDownloadingDiscography = true;
		discographyError = null;

		let estimatedTotal = discography.reduce((sum, album) => sum + (album.numberOfTracks ?? 0), 0);
		if (!Number.isFinite(estimatedTotal) || estimatedTotal < 0) {
			estimatedTotal = 0;
		}

		let completed = 0;
		let total = estimatedTotal;
		discographyProgress = { completed, total };
		const quality = downloadQuality;

		for (const album of discography) {
			let albumEstimate = album.numberOfTracks ?? 0;
			let albumFailedCount = 0;
			try {
				await downloadAlbum(
					album,
					quality,
					{
						onTotalResolved: (resolvedTotal) => {
							if (resolvedTotal !== albumEstimate) {
								total += resolvedTotal - albumEstimate;
								albumEstimate = resolvedTotal;
								discographyProgress = { completed, total };
							} else if (total === 0 && resolvedTotal > 0) {
								total += resolvedTotal;
								discographyProgress = { completed, total };
							}
						},
						onTrackDownloaded: () => {
							completed += 1;
							discographyProgress = { completed, total };
						},
						onTrackFailed: (track, error, attempt) => {
							if (attempt >= 3) {
								albumFailedCount++;
							}
						}
					},
					artist?.name,
					{ mode: downloadMode, convertAacToMp3: convertAacToMp3Preference }
				);
				if (albumFailedCount > 0) {
					console.warn(`[Discography] ${albumFailedCount} track(s) failed in album: ${album.title}`);
				}
			} catch (err) {
				console.error('Failed to download discography album:', err);
				const message =
					err instanceof Error && err.message
						? err.message
						: 'Failed to download part of the discography.';
				discographyError = message;
				break;
			}
		}

		isDownloadingDiscography = false;
	}

	async function loadArtist(id: number) {
		try {
			isLoading = true;
			error = null;
			isDownloadingDiscography = false;
			discographyProgress = { completed: 0, total: 0 };
			discographyError = null;
			albumDownloadStates = {};
			const data = await losslessAPI.getArtist(id);
			artist = data;

			// Get artist picture
			if (artist.picture) {
				artistImage = losslessAPI.getArtistPictureUrl(artist.picture);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load artist';
			console.error('Failed to load artist:', err);
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{artist?.name || 'Artist'} - TIDAL UI</title>
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-24">
		<LoaderCircle size={16} class="h-16 w-16 animate-spin text-blue-500" />
	</div>
{:else if error}
	<div class="mx-auto max-w-2xl py-12">
		<div class="rounded-lg border border-red-900 bg-red-900/20 p-6">
			<h2 class="mb-2 text-xl font-semibold text-red-400">Error Loading Artist</h2>
			<p class="text-red-300">{error}</p>
			<a
				href="/"
				class="mt-4 inline-flex rounded-lg bg-red-600 px-4 py-2 transition-colors hover:bg-red-700"
			>
				Go Home
			</a>
		</div>
	</div>
{:else if artist}
	<div class="space-y-6 pb-32 lg:pb-40">
		<!-- Back Button -->
		<button
			onclick={() => window.history.back()}
			class="flex items-center gap-2 text-gray-400 transition-colors hover:text-white"
		>
			<ArrowLeft size={20} />
			Back
		</button>

		<!-- Artist Header -->
		<div class="flex flex-col items-start gap-8 md:flex-row md:items-end">
			<!-- Artist Picture -->
			<div
				class="aspect-square w-full flex-shrink-0 overflow-hidden rounded-full bg-gray-800 shadow-2xl md:w-80"
			>
				{#if artistImage}
					<img src={artistImage} alt={artist.name} class="h-full w-full object-cover" />
				{:else}
					<div class="flex h-full w-full items-center justify-center">
						<User size={120} class="text-gray-600" />
					</div>
				{/if}
			</div>

			<!-- Artist Info -->
			<div class="flex-1">
				<p class="mb-2 text-sm text-gray-400">ARTIST</p>
				<h1 class="mb-4 text-4xl font-bold md:text-6xl">{artist.name}</h1>

				<div class="mb-6 flex flex-wrap items-center gap-4">
					{#if artist.popularity}
						<div class="text-sm text-gray-400">
							Popularity: <span class="font-semibold text-white">{artist.popularity}</span>
						</div>
					{/if}
					{#if artist.artistTypes && artist.artistTypes.length > 0}
						{#each artist.artistTypes as type}
							<div
								class="rounded-full bg-blue-900/30 px-3 py-1 text-xs font-semibold text-blue-400"
							>
								{type}
							</div>
						{/each}
					{/if}
				</div>

				{#if artist.artistRoles && artist.artistRoles.length > 0}
					<div class="mb-4">
						<h3 class="mb-2 text-sm font-semibold text-gray-400">Roles</h3>
						<div class="flex flex-wrap gap-2">
							{#each artist.artistRoles as role}
								<div class="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
									{role.category}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Music Overview -->
		<div class="space-y-12">
			<section>
				<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-2xl font-semibold text-white">Top Tracks</h2>
						<p class="text-sm text-gray-400">Best songs from {artist.name}.</p>
					</div>
				</div>
				{#if topTracks.length > 0}
					<div class="mt-6 overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
						<TopTracksGrid tracks={topTracks} />
					</div>
				{:else}
					<div
						class="mt-6 rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400"
					>
						<p>No top tracks available for this artist yet.</p>
					</div>
				{/if}
			</section>

			<section>
				<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-2xl font-semibold text-white">Discography</h2>
						<p class="text-sm text-gray-400">Albums, EPs, and more from {artist.name}.</p>
					</div>
					<div class="flex items-center gap-2">
						<button
							onclick={handleDownloadDiscography}
							type="button"
							class="inline-flex items-center gap-2 rounded-full border border-blue-600 bg-blue-600/10 px-4 py-2 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-600/20 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isDownloadingDiscography || discography.length === 0}
							aria-live="polite"
						>
							{#if isDownloadingDiscography}
								<LoaderCircle size={16} class="animate-spin" />
								<span class="whitespace-nowrap">
									Downloading
									{#if discographyProgress.total > 0}
										{discographyProgress.completed}/{displayTrackTotal(discographyProgress.total)}
									{:else}
										{discographyProgress.completed}
									{/if}
									tracks
								</span>
							{:else}
								<Download size={16} />
								<span class="whitespace-nowrap">Download Discography</span>
							{/if}
						</button>
					</div>
				</div>
				{#if discographyError}
					<p class="mt-2 text-sm text-red-400" role="alert">{discographyError}</p>
				{/if}
				{#if discography.length > 0}
					<div class="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
						{#each discography as album (album.id)}
							<div
								class="group relative flex h-full flex-col rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-center transition-colors hover:border-blue-700 hover:bg-gray-900"
							>
								<button
									onclick={(event) => handleAlbumDownload(album, event)}
									type="button"
									class="absolute top-3 right-3 z-40 flex items-center justify-center rounded-full bg-black/50 p-2 text-gray-200 backdrop-blur-md transition-colors hover:bg-blue-600/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
									disabled={isDownloadingDiscography || albumDownloadStates[album.id]?.downloading}
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
									class="flex flex-1 flex-col items-center gap-4 rounded-lg text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
								>
									<div
										class="mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-lg bg-gray-800"
									>
										{#if album.cover}
											<img
												src={losslessAPI.getCoverUrl(album.cover, '640')}
												alt={album.title}
												class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
											/>
										{:else}
											<div
												class="flex h-full w-full items-center justify-center text-sm text-gray-500"
											>
												No artwork
											</div>
										{/if}
									</div>
									<div class="w-full">
										<h3 class="truncate text-balance text-lg font-semibold text-white group-hover:text-blue-400">
											{album.title}
										</h3>
										{#if formatAlbumMeta(album)}
											<p class="mt-1 text-sm text-gray-400">{formatAlbumMeta(album)}</p>
										{/if}
									</div>
								</a>
								{#if albumDownloadStates[album.id]?.downloading}
									<p class="mt-3 text-xs text-blue-300">
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
									<p class="mt-3 text-xs text-red-400" role="alert">
										{albumDownloadStates[album.id]?.error}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="mt-6 rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-400"
					>
						<p>Discography information isn&apos;t available right now.</p>
					</div>
				{/if}
			</section>
		</div>

		{#if artist.url}
			<a
				href={artist.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-block text-sm text-blue-400 transition-colors hover:text-blue-300"
			>
				View profile →
			</a>
		{/if}
	</div>
{/if}
