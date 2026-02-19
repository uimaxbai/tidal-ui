<script lang="ts">
	import { Share2, Link, Copy, Check, Code } from 'lucide-svelte';
	import { fade, scale } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';

	interface Props {
		type: 'track' | 'album' | 'artist' | 'playlist';
		id: string | number;
		title?: string;
		size?: number;
		iconOnly?: boolean;
		variant?: 'ghost' | 'primary' | 'secondary' | 'minimal';
		dropdownPosition?: 'above' | 'below';
		noRound?: boolean;
	}

	let { 
		type, 
		id, 
		title = 'Share', 
		size = 20, 
		iconOnly = false,
		variant = 'ghost',
		dropdownPosition = 'below',
		noRound = false
	}: Props = $props();

	let showMenu = $state(false);
	let copied = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);
	let buttonRef = $state<HTMLButtonElement | null>(null);

	function getLongLink() {
		return `${$page.url.protocol}://${$page.url.host}/${type}/${id}`;
	}

	function getEmbedUrl() {
		return `${$page.url.protocol}://${$page.url.host}/embed/${type}/${id}`;
	}

	function getShortLink() {
		const prefixMap = {
			track: 't',
			album: 'al',
			artist: 'ar',
			playlist: 'p'
		};
		return `https://okiw.me/${prefixMap[type]}/${id}`;
	}

	function getEmbedCode() {
        if (type === "track") return `<iframe src="${getEmbedUrl()}" width="100%" height="150" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
		return `<iframe src="${getEmbedUrl()}" width="100%" height="450" style="border:none; overflow:hidden; border-radius: 0.5em;" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`;
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
			copied = true;
			showMenu = false;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}

	function handleClickOutside(event: MouseEvent) {
		if (showMenu && 
			menuRef && 
			!menuRef.contains(event.target as Node) && 
			buttonRef && 
			!buttonRef.contains(event.target as Node)) {
			showMenu = false;
		}
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});

	const variantClasses = {
		ghost: 'text-gray-400 hover:text-white hover:bg-white/10',
		primary: 'bg-blue-600 text-white hover:bg-blue-700',
		secondary: 'border border-white/30 text-white hover:bg-white/10 hover:border-white/50 bg-white/5 backdrop-blur-sm',
		minimal: 'text-gray-400'
	};
</script>

<div class="relative inline-block">
	<button
		bind:this={buttonRef}
		class="flex items-center gap-2 transition-colors {!noRound ? 'rounded-full' : ''} {variantClasses[variant]} {iconOnly ? 'p-2' : 'px-4 py-2'} touch-target"
		onclick={(e) => {
			e.stopPropagation();
			showMenu = !showMenu;
		}}
		{title}
		aria-label={title}
		aria-haspopup="true"
		aria-expanded={showMenu}
	>
		{#if copied && iconOnly}
			<Check size={size} class="text-green-500" />
		{:else}
			<Share2 size={size} />
		{/if}
		{#if !iconOnly}
			<span>{copied ? 'Copied!' : 'Share'}</span>
		{/if}
	</button>

	{#if showMenu}
		<div
			bind:this={menuRef}
			transition:scale={{ duration: 100, start: 0.95 }}
			class="absolute right-0 z-50 w-48 rounded-lg border border-white/10 bg-gray-900 p-1 shadow-xl backdrop-blur-xl {dropdownPosition === 'above' ? 'bottom-full mb-2 origin-bottom-right' : 'top-full mt-2 origin-top-right'}"
		>
			<button
				class="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
				onclick={(e) => {
					e.stopPropagation();
					copyToClipboard(getLongLink());
				}}
			>
				<Link size={16} />
				Copy Link
			</button>
			<button
				class="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
				onclick={(e) => {
					e.stopPropagation();
					copyToClipboard(getShortLink());
				}}
			>
				<Copy size={16} />
				Copy Short Link
			</button>
			<button
				class="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
				onclick={(e) => {
					e.stopPropagation();
					copyToClipboard(getEmbedCode());
				}}
			>
				<Code size={16} />
				Copy Embed Code
			</button>
		</div>
	{/if}
</div>
