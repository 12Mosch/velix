<script lang="ts">
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import Page from "./+page.svelte";

	let sidebarOpen = $state(false);
</script>

<Sidebar.Provider bind:open={sidebarOpen}>
	<Page />
</Sidebar.Provider>
