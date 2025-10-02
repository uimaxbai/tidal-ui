<script lang="ts">
	import type { AudioQuality } from '$lib/types';
	import { playerStore } from '$lib/stores/player';
	import { Settings, Check } from 'lucide-svelte';

	let isOpen = $state(false);

	const qualities: { value: AudioQuality; label: string; description: string }[] = [
		{ value: 'HI_RES_LOSSLESS', label: 'Hi-Res Lossless', description: 'Up to 24-bit, 192 kHz' },
		{ value: 'HI_RES', label: 'Hi-Res', description: 'MQA, up to 96 kHz' },
		{ value: 'LOSSLESS', label: 'Lossless', description: 'FLAC, 16-bit, 44.1 kHz' },
		{ value: 'HIGH', label: 'High', description: 'AAC, 320 kbps' },
		{ value: 'LOW', label: 'Low', description: 'AAC, 96 kbps' }
	];

	function selectQuality(quality: AudioQuality) {
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
		class="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
		aria-label="Select audio quality"
	>
		<Settings size={18} />
		<span class="text-sm">
			{qualities.find((q) => q.value === $playerStore.quality)?.label || 'Quality'}
		</span>
	</button>

	{#if isOpen}
		<div
			class="absolute right-0 mt-2 w-64 bg-gray-800 rounded-lg shadow-lg border border-gray-700 z-50 overflow-hidden"
		>
			<div class="p-2 border-b border-gray-700">
				<h3 class="text-sm font-semibold text-white">Audio Quality</h3>
			</div>
			<div class="py-1">
				{#each qualities as quality}
					<button
						onclick={() => selectQuality(quality.value)}
						class="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-700 transition-colors text-left"
					>
						<div class="flex-shrink-0 w-5 h-5 flex items-center justify-center mt-0.5">
							{#if $playerStore.quality === quality.value}
								<Check size={18} class="text-blue-500" />
							{/if}
						</div>
						<div class="flex-1">
							<div class="text-white font-medium text-sm">{quality.label}</div>
							<div class="text-gray-400 text-xs">{quality.description}</div>
						</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
