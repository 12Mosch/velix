<script lang="ts">
	import { onMount } from "svelte";
	import type { Map as MapLibreMap } from "maplibre-gl";
	import { getBasemapStyleUrl } from "$lib/map/basemaps";
	import type { BasemapId } from "$lib/map/basemaps";

	type Props = {
		basemapId: BasemapId;
		center?: [number, number];
		zoom?: number;
	};

	let {
		basemapId,
		center = [11.394, 47.268] as [number, number],
		zoom = 10,
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);

	onMount(() => {
		let cancelled = false;
		let map: MapLibreMap | undefined;

		async function setup() {
			if (!container) return;

			try {
				const styleUrl = getBasemapStyleUrl(basemapId);
				if (!styleUrl) return;

				const maplibregl = await import("maplibre-gl");
				if (cancelled || !container) return;

				map = new maplibregl.Map({
					attributionControl: false,
					center,
					container,
					interactive: false,
					style: styleUrl,
					zoom,
				});
			} catch (error) {
				if (cancelled) return;
				console.error("Failed to initialize basemap preview", error);
			}
		}

		void setup();

		return () => {
			cancelled = true;
			map?.remove();
		};
	});
</script>

<div
	bind:this={container}
	class="h-full w-full overflow-hidden bg-muted"
	role="img"
	aria-label="Basemap preview"
></div>
