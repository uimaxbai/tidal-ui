<script lang="ts">
	import { page } from '$app/stores';
	import { losslessAPI } from '$lib/api';
	import type { Track, TrackInfo } from '$lib/types';
	import { onMount } from 'svelte';
	import { playerStore } from '$lib/stores/player';
	import { LoaderCircle, Play, Pause, ExternalLink } from 'lucide-svelte';
	import { formatArtists } from '$lib/utils';
    import { fade } from 'svelte/transition';

	let track = $state<Track | null>(null);
    let trackInfo = $state<TrackInfo | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	const trackId = $derived($page.params.id);
    const isPlaying = $derived($playerStore.isPlaying && $playerStore.currentTrack?.id === track?.id);
    const isCurrentTrack = $derived($playerStore.currentTrack?.id === track?.id);
    const progress = $derived(
        isCurrentTrack
            ? ($playerStore.currentTime / ($playerStore.duration || 1)) * 100 
            : 0
    );

	onMount(async () => {
		if (trackId) {
			await loadTrack(parseInt(trackId));
		}
	});

	async function loadTrack(id: number) {
		try {
			isLoading = true;
			error = null;
			const data = await losslessAPI.getTrack(id);
			track = data.track;
            trackInfo = data.info;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load track';
		} finally {
			isLoading = false;
		}
	}

    function formatQuality(info: TrackInfo | null): string | null {
        if (!info) return null;
        if (info.bitDepth && info.sampleRate) {
            return `${info.bitDepth}-bit / ${info.sampleRate / 1000} kHz FLAC`;
        }
        if (info.audioQuality === 'HI_RES_LOSSLESS') return 'Hi-Res FLAC';
        if (info.audioQuality === 'LOSSLESS') return '16-bit / 44.1 kHz FLAC';
        if (info.audioQuality === 'HIGH') return '320 kbps AAC';
        if (info.audioQuality === 'LOW') return '96 kbps AAC';
        return null;
    }

    function togglePlay() {
        if (!track) return;
        
        if (isPlaying) {
            playerStore.pause();
        } else {
            if ($playerStore.currentTrack?.id !== track.id) {
                playerStore.setQueue([track], 0);
            }
            playerStore.play();
        }
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
    {:else if track}
        <div class="track-info">
            <div class="cover-art">
                <img src={losslessAPI.getCoverUrl(track.album.cover, '320')} alt={track.album.title} />
                <button class="play-button" onclick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                    {#if isPlaying}
                        <Pause size={24} fill="currentColor" />
                    {:else}
                        <Play size={24} fill="currentColor" class="ml-1" />
                    {/if}
                </button>
            </div>
            <div class="details">
                <h1 class="title" title={track.title}>{track.title}</h1>
                <p class="artist" title={formatArtists(track.artists)}>{formatArtists(track.artists)}</p>
                
                {#if trackInfo}
                    {@const qualityText = formatQuality(trackInfo)}
                    {#if qualityText}
                        <div class="quality-badge">{qualityText}</div>
                    {/if}
                {/if}

                <a href="/track/{track.id}" target="_blank" class="open-link">
                    <span>Open in BiniLossless</span>
                    <ExternalLink size={12} />
                </a>
            </div>
        </div>
        
        <!-- Background blur -->
        <div class="background" style="background-image: url({losslessAPI.getCoverUrl(track.album.cover, '320')})"></div>
        
        <!-- Progress Bar -->
        {#if isCurrentTrack}
            <div class="progress-container">
                <div class="progress-bar" style="width: {progress}%"></div>
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
    }

    .progress-bar {
        height: 100%;
        background: #3b82f6; /* Blue-500 */
        transition: width 0.1s linear;
    }

    .loading, .error {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
    }

    .track-info {
        display: flex;
        align-items: center;
        padding: 1rem;
        gap: 1rem;
        height: 100%;
    }

    .cover-art {
        position: relative;
        width: 80px;
        height: 80px;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        flex-shrink: 0;
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
        opacity: 1; /* Always visible for better UX on embeds */
        transition: background 0.2s;
        border: none;
        cursor: pointer;
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
        font-size: 1rem;
        font-weight: 700;
        margin: 0 0 0.25rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .artist {
        font-size: 0.875rem;
        color: rgba(255,255,255,0.8);
        margin: 0 0 0.5rem 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .quality-badge {
        display: inline-block;
        font-size: 0.75rem;
        color: #fbbf24; /* Amber-400 */
        background: rgba(251, 191, 36, 0.1);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        margin-bottom: 0.5rem;
        font-weight: 500;
        width: fit-content;
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
</style>