<!-- Literally unused because it doesn't work -->

<script lang="ts">
	import type { AudioQuality } from '$lib/types';
	import { playerStore } from '$lib/stores/player';
	import { Settings, Check } from 'lucide-svelte';

	let isOpen = $state(false);
	const disabledQualities = new Set<AudioQuality>(['HI_RES_LOSSLESS', 'HI_RES']);

	const qualities: { value: AudioQuality; label: string; description: string }[] = [
		{ value: 'HI_RES_LOSSLESS', label: 'Hi-Res Lossless', description: '24/44.1kHz to 24/192kHz FLAC' },
		{ value: 'HI_RES', label: 'Hi-Res', description: 'up to 96 kHz MQA' },
		{ value: 'LOSSLESS', label: 'Lossless', description: '16-bit/44.1 kHz FLAC' },
		{ value: 'HIGH', label: 'High', description: '320k AAC' },
		{ value: 'LOW', label: 'Low', description: '96k AAC' }
	];

	function isQualityDisabled(quality: AudioQuality): boolean {
		return disabledQualities.has(quality);
	}

	function selectQuality(quality: AudioQuality) {
		if (isQualityDisabled(quality)) {
			return;
		}
		playerStore.setQuality(quality);
		isOpen = false;
	}

	function toggleDropdown() {
		isOpen = !isOpen;
	}

	function handleClickOutside(event: MouseEvent) {
		if (isOpen && !(event.target as Element).closest('.quality-selector')) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="quality-selector relative">
	<button
		onclick={toggleDropdown}
		class="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-white transition-colors hover:bg-gray-700"
		aria-label="Select audio quality"
	>
		<Settings size={18} />
		<span class="text-sm">
			{qualities.find((q) => q.value === $playerStore.quality)?.label || 'Quality'}
		</span>
	</button>

	{#if isOpen}
		<div
			class="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-lg"
		>
			<div class="border-b border-gray-700 p-2">
				<h3 class="text-sm font-semibold text-white">Audio Quality</h3>
			</div>
			<div class="py-1">
				{#each qualities as quality}
					<button
						onclick={() => selectQuality(quality.value)}
						class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:text-gray-500 disabled:hover:bg-gray-800"
						disabled={isQualityDisabled(quality.value)}
						aria-disabled={isQualityDisabled(quality.value)}
						title={isQualityDisabled(quality.value) ? 'Not available in this build' : undefined}
					>
						<div class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
							{#if $playerStore.quality === quality.value}
								<Check size={18} class="text-blue-500" />
							{/if}
						</div>
						<div class="flex-1">
							<div class="text-sm font-medium text-white">{quality.label}</div>
							<div
								class={`text-xs ${isQualityDisabled(quality.value) ? 'text-gray-500' : 'text-gray-400'}`}
							>
								{quality.description}
								{#if isQualityDisabled(quality.value)}
									<span class="ml-1 uppercase tracking-wide text-[10px] text-gray-500">Unavailable</span>
								{/if}
							</div>
						</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
