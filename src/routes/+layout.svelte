<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import AppSidebar from '$lib/components/app-sidebar.svelte';

	let { children } = $props();

	/** Map-first: start with icon rail; user can expand to read labels */
	let sidebarOpen = $state(false);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Sidebar.Provider bind:open={sidebarOpen}>
	<AppSidebar />
	<main class="relative flex min-h-0 min-h-svh min-w-0 flex-1 flex-col">
		{@render children()}
	</main>
</Sidebar.Provider>
