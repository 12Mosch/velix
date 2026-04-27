<script lang="ts">
	import './layout.css';
	import { env } from '$env/dynamic/public';
	import { setupConvex } from 'convex-svelte';
	import { ClerkProvider } from 'svelte-clerk';
	import { ModeWatcher } from 'mode-watcher';
	import favicon from '$lib/assets/favicon.svg';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import SavedRoutesSync from '$lib/components/saved-routes-sync.svelte';

	let { children } = $props();

	/** Map-first: start with icon rail; user can expand to read labels */
	let sidebarOpen = $state(false);
	const PUBLIC_CONVEX_URL = env.PUBLIC_CONVEX_URL;

	if (PUBLIC_CONVEX_URL) {
		setupConvex(PUBLIC_CONVEX_URL);
	}
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<ModeWatcher />

<ClerkProvider>
	{#if PUBLIC_CONVEX_URL}
		<SavedRoutesSync />
	{/if}
	<Sidebar.Provider bind:open={sidebarOpen}>
		<AppSidebar />
		<main class="relative flex min-h-0 min-h-svh min-w-0 flex-1 flex-col">
			{@render children()}
		</main>
	</Sidebar.Provider>
</ClerkProvider>
