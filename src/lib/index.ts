// place files you want to import through the `$lib` alias in this folder.

// Export API and types
export { losslessAPI as tidalAPI } from './api';
export * from './types';

// Export stores
export {
	playerStore,
	currentTrack,
	isPlaying,
	currentTime,
	duration,
	volume,
	progress
} from './stores/player';

// Export components
export { default as AudioPlayer } from './components/AudioPlayer.svelte';
export { default as SearchInterface } from './components/SearchInterface.svelte';
export { default as TrackList } from './components/TrackList.svelte';
export { default as QualitySelector } from './components/QualitySelector.svelte';
