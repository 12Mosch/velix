<script lang="ts">
	import { onMount } from "svelte";
	import type { FeatureCollection } from "geojson";
	import type {
		GeoJSONSource,
		LngLatBoundsLike,
		Map as MapLibreMap,
		MapOptions,
	} from "maplibre-gl";

	import {
		initMapStylePreference,
		selectedBasemapId,
		syncSelectedBasemap,
	} from "$lib/map-style-settings.svelte";
	import { getBasemapStyleUrl } from "$lib/map/basemaps";
	import type { RouteBounds } from "$lib/route-planning";

	type Props = {
		initialCenter?: [number, number];
		initialZoom?: number;
		ariaLabel?: string;
		routeGeoJson?: FeatureCollection | null;
		routeBounds?: RouteBounds | null;
	};

	const defaultCenter = [11.394, 47.268] as [number, number];
	const routeSourceId = "planned-route";
	const routeCasingLayerId = "planned-route-casing";
	const routeLineLayerId = "planned-route-line";
	const routeStartLayerId = "planned-route-start";
	const routeDestinationLayerId = "planned-route-destination";

	let {
		initialCenter = defaultCenter,
		initialZoom = 10,
		ariaLabel = "Route map",
		routeGeoJson = null,
		routeBounds = null,
	}: Props = $props();

	let mapContainer = $state<HTMLDivElement | null>(null);
	let map = $state<MapLibreMap | null>(null);
	let isLoaded = $state(false);
	let isStyleReady = $state(false);
	let loadError = $state<string | null>(null);
	let lastFittedBoundsKey = $state<string | null>(null);

	function getRouteSource() {
		return map?.getSource(routeSourceId) as GeoJSONSource | undefined;
	}

	function removeRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [
			routeDestinationLayerId,
			routeStartLayerId,
			routeLineLayerId,
			routeCasingLayerId,
		]) {
			if (map.getLayer(layerId)) {
				map.removeLayer(layerId);
			}
		}

		if (map.getSource(routeSourceId)) {
			map.removeSource(routeSourceId);
		}
	}

	function ensureRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!routeGeoJson) {
			removeRouteOverlay();
			return;
		}

		const existingSource = getRouteSource();

		if (existingSource) {
			existingSource.setData(routeGeoJson);
		} else {
			map.addSource(routeSourceId, {
				type: "geojson",
				data: routeGeoJson,
			});
		}

		if (!map.getLayer(routeCasingLayerId)) {
			map.addLayer({
				id: routeCasingLayerId,
				type: "line",
				source: routeSourceId,
				filter: ["==", ["get", "kind"], "route"],
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": "rgba(255, 255, 255, 0.88)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						5,
						12,
						8,
						16,
						11,
					],
					"line-opacity": 0.95,
				},
			});
		}

		if (!map.getLayer(routeLineLayerId)) {
			map.addLayer({
				id: routeLineLayerId,
				type: "line",
				source: routeSourceId,
				filter: ["==", ["get", "kind"], "route"],
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: {
					"line-color": "rgb(37, 99, 235)",
					"line-width": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						3,
						12,
						5,
						16,
						7,
					],
				},
			});
		}

		if (!map.getLayer(routeStartLayerId)) {
			map.addLayer({
				id: routeStartLayerId,
				type: "circle",
				source: routeSourceId,
				filter: ["==", ["get", "kind"], "start"],
				paint: {
					"circle-color": "rgb(15, 118, 110)",
					"circle-radius": 7,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 3,
				},
			});
		}

		if (!map.getLayer(routeDestinationLayerId)) {
			map.addLayer({
				id: routeDestinationLayerId,
				type: "circle",
				source: routeSourceId,
				filter: ["==", ["get", "kind"], "destination"],
				paint: {
					"circle-color": "rgb(37, 99, 235)",
					"circle-radius": 7,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 3,
				},
			});
		}
	}

	function getFitPadding() {
		if (typeof window === "undefined") {
			return 48;
		}

		if (window.innerWidth >= 768) {
			return {
				top: 84,
				right: 48,
				bottom: 232,
				left: 420,
			};
		}

		return {
			top: 88,
			right: 24,
			bottom: 280,
			left: 24,
		};
	}

	function fitRouteBounds() {
		if (!map || !isStyleReady || !routeBounds) {
			return;
		}

		const nextBoundsKey = routeBounds.join(",");

		if (nextBoundsKey === lastFittedBoundsKey) {
			return;
		}

		map.fitBounds(routeBounds as LngLatBoundsLike, {
			padding: getFitPadding(),
			duration: 700,
			maxZoom: 14,
		});
		lastFittedBoundsKey = nextBoundsKey;
	}

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		ensureRouteOverlay();

		if (routeBounds) {
			fitRouteBounds();
		} else {
			lastFittedBoundsKey = null;
		}
	});

	onMount(() => {
		let cancelled = false;
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
					isStyleReady = false;
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
					isStyleReady = true;
					ensureRouteOverlay();
					fitRouteBounds();
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
						isStyleReady = false;
						return;
					}

					if (!map || nextStyleUrl === currentStyleUrl) {
						return;
					}

					currentStyleUrl = nextStyleUrl;
					loadError = null;
					isLoaded = false;
					isStyleReady = false;
					map.once("style.load", () => {
						if (cancelled) return;
						loadError = null;
						isLoaded = true;
						isStyleReady = true;
						ensureRouteOverlay();
					});
					map.setStyle(nextStyleUrl);
				});
			} catch (error) {
				if (cancelled) return;
				loadError = "Map failed to load";
				isLoaded = false;
				isStyleReady = false;
				console.error("Failed to initialize MapLibre map", error);
			}
		}

		void setupMap();

		return () => {
			cancelled = true;
			unsubscribe();
			resizeObserver?.disconnect();
			map?.remove();
			map = null;
			isStyleReady = false;
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
