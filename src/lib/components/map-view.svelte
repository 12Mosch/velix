<script lang="ts">
	import { onMount } from "svelte";
	import type { Map as MapLibreMap, MapOptions, StyleSpecification } from "maplibre-gl";

	type Props = {
		initialCenter?: [number, number];
		initialZoom?: number;
		ariaLabel?: string;
	};

	const defaultCenter = [11.394, 47.268] as [number, number];

	const rasterStyle: StyleSpecification = {
		version: 8,
		sources: {
			osm: {
				type: "raster",
				tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
				tileSize: 256,
				attribution: "© OpenStreetMap contributors",
			},
		},
		layers: [
			{
				id: "osm",
				type: "raster",
				source: "osm",
			},
		],
	};

	let {
		initialCenter = defaultCenter,
		initialZoom = 10,
		ariaLabel = "Route map",
	}: Props = $props();

	let mapContainer = $state<HTMLDivElement | null>(null);
	let isLoaded = $state(false);
	let loadError = $state<string | null>(null);

	onMount(() => {
		let cancelled = false;
		let map: MapLibreMap | undefined;
		let resizeObserver: ResizeObserver | undefined;

		async function setupMap() {
			if (!mapContainer) return;

			try {
				const maplibregl = await import("maplibre-gl");

				if (cancelled || !mapContainer) return;

				const options: MapOptions = {
					attributionControl: false,
					center: initialCenter,
					container: mapContainer,
					style: rasterStyle,
					zoom: initialZoom,
				};

				map = new maplibregl.Map(options);
				map.once("load", () => {
					if (cancelled) return;
					loadError = null;
					isLoaded = true;
				});

				resizeObserver = new ResizeObserver(() => {
					map?.resize();
				});
				resizeObserver.observe(mapContainer);
			} catch (error) {
				if (cancelled) return;
				loadError = "Map failed to load";
				isLoaded = false;
				console.error("Failed to initialize MapLibre map", error);
			}
		}

		void setupMap();

		return () => {
			cancelled = true;
			resizeObserver?.disconnect();
			map?.remove();
		};
	});
</script>

<div class="absolute inset-0 overflow-hidden bg-slate-100" data-slot="map-view">
	<div
		bind:this={mapContainer}
		class="h-full w-full"
		role="region"
		aria-busy={!isLoaded && !loadError}
		aria-label={ariaLabel}
	></div>
	<div
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.22),transparent_36%),linear-gradient(to_bottom,rgba(255,255,255,0.08),transparent_24%)]"
	></div>
</div>
