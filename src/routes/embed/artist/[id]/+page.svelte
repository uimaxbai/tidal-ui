<script lang="ts">
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import type { ArtistDetails, Track } from '$lib/types';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { playerStore } from '$lib/stores/player';
	import { LoaderCircle, Play, Pause, ExternalLink } from 'lucide-svelte';
	import { APP_VERSION } from '$lib/version';

	let artist = $state<ArtistDetails | null>(null);
    let tracks = $state<Track[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	const artistId = $derived($page.params.id);
    // Check if current playing track is from this artist's top tracks
    const isPlaying = $derived($playerStore.isPlaying && tracks.some(t => t.id === $playerStore.currentTrack?.id));
    const isCurrentContext = $derived(tracks.some(t => t.id === $playerStore.currentTrack?.id));
    const progress = $derived(
        isCurrentContext
            ? ($playerStore.currentTime / ($playerStore.duration || 1)) * 100 
            : 0
    );

	onMount(async () => {
		try {
            const referrer = document.referrer;
            const host = referrer ? new URL(referrer).hostname : 'direct';
            umami.track('embed_loaded', { host, type: 'artist' });
        } catch {}

		if (artistId) {
			await loadArtist(parseInt(artistId));
		}
	});

	async function loadArtist(id: number) {
		try {
			isLoading = true;
			error = null;
			const data = await losslessAPI.getArtist(id);
			artist = data;
            tracks = data.tracks;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load artist';
			if (typeof window !== 'undefined' && (window as any).umami) {
				try {
					const referrer = document.referrer;
					const host = referrer ? new URL(referrer).hostname : 'direct';
					(window as any).umami.track('embed_error', { 
						host, 
						error, 
						version: APP_VERSION,
						type: 'artist',
						page: window.location.href,
						id
					});
				} catch {}
			}
		} finally {
			isLoading = false;
		}
	}

    function togglePlay() {
        if (!artist || tracks.length === 0) return;
        
        if (isPlaying) {
            playerStore.pause();
        } else {
            // If not playing from this list, start from beginning
            if (!tracks.some(t => t.id === $playerStore.currentTrack?.id)) {
                playerStore.setQueue(tracks, 0);
            }
            playerStore.play();
        }
    }

    function playTrack(track: Track, index: number) {
        playerStore.setQueue(tracks, index);
        playerStore.play();
    }
</script>

<div class="embed-card">
    {#if isLoading}
        <div class="loading">
            <LoaderCircle class="animate-spin" size={32} />
        </div>
    {:else if error}
        <div class="error">
            <p>{error}</p>
        </div>
    {:else if artist}
        <div class="header">
            <div class="cover-art">
                {#if artist.picture}
                    <img src={losslessAPI.getArtistPictureUrl(artist.picture, '750')} alt={artist.name} />
                {:else}
                    <div class="placeholder-art"></div>
                {/if}
                <button class="play-button" onclick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                    {#if isPlaying}
                        <Pause size={24} fill="currentColor" />
                    {:else}
                        <Play size={24} fill="currentColor" class="ml-1" />
                    {/if}
                </button>
            </div>
            <div class="details">
                <h1 class="title" title={artist.name}>{artist.name}</h1>
                <p class="subtitle">Top Tracks</p>
                <a href="/artist/{artist.id}" target="_blank" class="open-link">
                    <span>Open Artist in BiniLossless</span>
                    <ExternalLink size={12} />
                </a>
            </div>
        </div>

        <div class="track-list">
            {#each tracks as track, i}
                <button class="track-item" onclick={() => playTrack(track, i)} class:active={$playerStore.currentTrack?.id === track.id}>
                    <span class="track-number">{i + 1}</span>
                    <div class="track-meta">
                        <span class="track-title">{track.title}</span>
                        <span class="track-duration">{losslessAPI.formatDuration(track.duration)}</span>
                    </div>
                </button>
            {/each}
        </div>
        
        <!-- Background blur -->
        {#if artist.picture}
            <div class="background" style="background-image: url({losslessAPI.getArtistPictureUrl(artist.picture, '750')})"></div>
        {:else}
            <div class="background" style="background-color: #1e293b"></div>
        {/if}
        
        <!-- Progress Bar -->
        {#if isCurrentContext}
            <div class="progress-container">
                <div class="progress-bar" style="width: {progress}%"></div>
            </div>
        {/if}

        {#if $playerStore.currentTrack}
            <div class="now-playing-bar" transition:slide={{ axis: 'y', duration: 200 }}>
                <img 
                    src={losslessAPI.getCoverUrl($playerStore.currentTrack.album.cover, '80')} 
                    alt={$playerStore.currentTrack.title} 
                    class="np-cover"
                />
                <div class="np-info">
                    <div class="np-title">{$playerStore.currentTrack.title}</div>
                    <div class="np-meta">
                        <span class="np-quality">
                            {$playerStore.quality === 'HI_RES_LOSSLESS' ? 'Hi-Res' : 
                             $playerStore.quality === 'LOSSLESS' ? 'CD' : $playerStore.quality}
                        </span>
                    </div>
                </div>
                <button class="np-play-button" onclick={() => playerStore.togglePlay()}>
                    {#if $playerStore.isPlaying}
                        <Pause size={20} fill="currentColor" />
                    {:else}
                        <Play size={20} fill="currentColor" />
                    {/if}
                </button>
            </div>
        {/if}
    {/if}
</div>

<style>
    :global(html), :global(body) {
        margin: 0;
        overflow: hidden;
        background: transparent;
    }

    .embed-card {
        position: relative;
        width: 100%;
        height: 100vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        color: white;
        font-family: 'Figtree', system-ui, -apple-system, sans-serif;
    }

    .background {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        filter: blur(20px) brightness(0.4);
        z-index: -1;
        transform: scale(1.1);
    }

    .progress-container {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        z-index: 10;
    }

    .progress-bar {
        height: 100%;
        background: #3b82f6;
        transition: width 0.1s linear;
    }

    .loading, .error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
    }

    .header {
        display: flex;
        align-items: center;
        padding: 1rem;
        gap: 1rem;
        flex-shrink: 0;
        background: rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(10px);
    }

    .cover-art {
        position: relative;
        width: 64px;
        height: 64px;
        border-radius: 50%; /* Circular for artist */
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        flex-shrink: 0;
    }

    .placeholder-art {
        width: 100%;
        height: 100%;
        background: #334155;
    }

    .cover-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .play-button {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        opacity: 0;
        transition: opacity 0.2s, background 0.2s;
        border: none;
        cursor: pointer;
    }

    .cover-art:hover .play-button {
        opacity: 1;
    }

    .play-button:hover {
        background: rgba(0,0,0,0.5);
    }

    .details {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .title {
        font-size: 1.125rem;
        font-weight: 700;
        margin: 0 0 0.25rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .subtitle {
        font-size: 0.875rem;
        color: rgba(255,255,255,0.8);
        margin: 0 0 0.5rem 0;
    }

    .open-link {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        color: rgba(255,255,255,0.6);
        text-decoration: none;
        transition: color 0.2s;
    }

    .open-link:hover {
        color: white;
    }

    .track-list {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem 0;
        background: rgba(0, 0, 0, 0.1);
    }

    .track-item {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 0.5rem 1rem;
        gap: 0.75rem;
        background: transparent;
        border: none;
        color: rgba(255, 255, 255, 0.8);
        cursor: pointer;
        text-align: left;
        transition: background 0.2s;
    }

    .track-item:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
    }

    .track-item.active {
        color: #3b82f6;
        background: rgba(59, 130, 246, 0.1);
    }

    .track-number {
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.5);
        width: 1.5rem;
        text-align: center;
    }

    .track-meta {
        flex: 1;
        min-width: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
    }

    .track-title {
        font-size: 0.875rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .track-duration {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .now-playing-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: #1e293b;
        border-top: 1px solid rgba(255,255,255,0.1);
        padding: 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        z-index: 50;
        box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.1), 0 -2px 4px -1px rgba(0, 0, 0, 0.06);
    }

    .np-cover {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.25rem;
        object-fit: cover;
    }

    .np-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .np-title {
        font-size: 0.875rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: white;
    }

    .np-meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .np-quality {
        font-size: 0.65rem;
        font-weight: 700;
        color: #fbbf24;
        background: rgba(251, 191, 36, 0.1);
        padding: 0.1rem 0.3rem;
        border-radius: 0.2rem;
    }

    .np-play-button {
        background: white;
        color: black;
        border: none;
        border-radius: 50%;
        width: 2.5rem;
        height: 2.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.1s;
    }

    .np-play-button:hover {
        transform: scale(1.05);
    }
    
    .track-list {
        padding-bottom: 4.5rem;
    }
</style>
