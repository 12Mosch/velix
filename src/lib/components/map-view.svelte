<script lang="ts">
	import { onMount } from "svelte";
	import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";

	import {
		initMapStylePreference,
		selectedBasemapId,
		syncSelectedBasemap,
	} from "$lib/map-style-settings.svelte";
	import { getBasemapStyleUrl } from "$lib/map/basemaps";

	type Props = {
		initialCenter?: [number, number];
		initialZoom?: number;
		ariaLabel?: string;
	};

	const defaultCenter = [11.394, 47.268] as [number, number];

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
		let currentStyleUrl: string | null = null;
		let unsubscribe = () => {};

		initMapStylePreference();

		async function setupMap() {
			if (!mapContainer) return;

			try {
				const initialBasemapId = syncSelectedBasemap();
				const initialStyleUrl = initialBasemapId
					? getBasemapStyleUrl(initialBasemapId)
					: null;

				if (!initialStyleUrl) {
					loadError = "No map styles configured";
					isLoaded = false;
					return;
				}

				const maplibregl = await import("maplibre-gl");

				if (cancelled || !mapContainer) return;

				currentStyleUrl = initialStyleUrl;

				const options: MapOptions = {
					attributionControl: false,
					center: initialCenter,
					container: mapContainer,
					style: initialStyleUrl,
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

				unsubscribe = selectedBasemapId.subscribe((basemapId) => {
					const nextStyleUrl = basemapId ? getBasemapStyleUrl(basemapId) : null;

					if (!nextStyleUrl) {
						loadError = "No map styles configured";
						isLoaded = false;
						return;
					}

					if (!map || nextStyleUrl === currentStyleUrl) {
						return;
					}

					currentStyleUrl = nextStyleUrl;
					loadError = null;
					isLoaded = false;
					map.once("style.load", () => {
						if (cancelled) return;
						loadError = null;
						isLoaded = true;
					});
					map.setStyle(nextStyleUrl);
				});
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
			unsubscribe();
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
	{#if loadError}
		<div class="pointer-events-none absolute inset-0 flex items-start justify-center p-4">
			<div
				class="max-w-sm rounded-xl border border-border/70 bg-background/92 px-4 py-3 text-sm font-medium text-foreground shadow-lg backdrop-blur-sm"
				role="status"
			>
				{loadError}
			</div>
		</div>
	{/if}
</div>
