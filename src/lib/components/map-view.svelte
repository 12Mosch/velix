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
		mapStylePreference,
		syncSelectedBasemap,
	} from "$lib/map-style-settings.svelte";
	import { getBasemapStyleUrl } from "$lib/map/basemaps";
	import type { SidebarLayoutState } from "$lib/components/ui/sidebar/context.svelte.js";
	import type { RouteBounds, RouteCoordinate } from "$lib/route-planning";

	type Props = {
		initialCenter?: [number, number];
		initialZoom?: number;
		ariaLabel?: string;
		routeGeoJson?: FeatureCollection | null;
		routeBounds?: RouteBounds | null;
		hoveredRouteCoordinate?: RouteCoordinate | null;
		layoutState?: SidebarLayoutState | null;
	};

	const defaultCenter = [11.394, 47.268] as [number, number];
	const routeSourceId = "planned-route";
	const routeCasingLayerId = "planned-route-casing";
	const routeLineLayerId = "planned-route-line";
	const routeStartLayerId = "planned-route-start";
	const routeWaypointLayerId = "planned-route-waypoint";
	const routeDestinationLayerId = "planned-route-destination";
	const hoveredRouteSourceId = "planned-route-hover";
	const hoveredRouteLayerId = "planned-route-hover-point";
	// Matches the 200ms sidebar width transition plus a small buffer for interrupted toggles.
	const layoutTransitionBufferMs = 260;

	let {
		initialCenter = defaultCenter,
		initialZoom = 10,
		ariaLabel = "Route map",
		routeGeoJson = null,
		routeBounds = null,
		hoveredRouteCoordinate = null,
		layoutState = null,
	}: Props = $props();

	let mapContainer = $state<HTMLDivElement | null>(null);
	let map = $state<MapLibreMap | null>(null);
	let isLoaded = $state(false);
	let isStyleReady = $state(false);
	let loadError = $state<string | null>(null);
	let lastFittedBoundsKey = $state<string | null>(null);
	let currentStyleUrl = $state<string | null>(null);
	let detachStyleLoadListener = () => {};
	let resizeAnimationFrameId: number | null = null;
	let resizeLoopUntil = 0;

	function cancelSmoothResize() {
		resizeLoopUntil = 0;

		if (resizeAnimationFrameId === null || typeof window === "undefined") {
			return;
		}

		window.cancelAnimationFrame(resizeAnimationFrameId);
		resizeAnimationFrameId = null;
	}

	function resizeMap() {
		map?.resize();
	}

	function repaintMap() {
		map?.triggerRepaint?.();
	}

	function syncMapFrame() {
		resizeMap();
		repaintMap();
	}

	function keepMapResized() {
		if (typeof window === "undefined") {
			return;
		}

		syncMapFrame();

		if (resizeLoopUntil <= window.performance.now()) {
			resizeLoopUntil = 0;
			resizeAnimationFrameId = null;
			return;
		}

		resizeAnimationFrameId = window.requestAnimationFrame(() => {
			keepMapResized();
		});
	}

	function scheduleSmoothResize(durationMs = layoutTransitionBufferMs) {
		if (!map || typeof window === "undefined") {
			return;
		}

		const nextDeadline = window.performance.now() + durationMs;

		if (nextDeadline <= resizeLoopUntil) {
			return;
		}

		resizeLoopUntil = nextDeadline;

		if (resizeAnimationFrameId !== null) {
			return;
		}

		keepMapResized();
	}

	function getRouteSource() {
		return map?.getSource(routeSourceId) as GeoJSONSource | undefined;
	}

	function getHoveredRouteSource() {
		return map?.getSource(hoveredRouteSourceId) as GeoJSONSource | undefined;
	}

	function removeRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [
			routeDestinationLayerId,
			routeWaypointLayerId,
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

	function removeHoveredRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (map.getLayer(hoveredRouteLayerId)) {
			map.removeLayer(hoveredRouteLayerId);
		}

		if (map.getSource(hoveredRouteSourceId)) {
			map.removeSource(hoveredRouteSourceId);
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

		if (!map.getLayer(routeWaypointLayerId)) {
			map.addLayer({
				id: routeWaypointLayerId,
				type: "circle",
				source: routeSourceId,
				filter: ["==", ["get", "kind"], "waypoint"],
				paint: {
					"circle-color": "rgb(245, 158, 11)",
					"circle-radius": 6,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 2.5,
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

	function ensureHoveredRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!hoveredRouteCoordinate) {
			removeHoveredRouteOverlay();
			return;
		}

		const hoveredPointGeoJson: FeatureCollection = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: {
						kind: "hovered-route-point",
					},
					geometry: {
						type: "Point",
						coordinates: hoveredRouteCoordinate,
					},
				},
			],
		};
		const existingSource = getHoveredRouteSource();

		if (existingSource) {
			existingSource.setData(hoveredPointGeoJson);
		} else {
			map.addSource(hoveredRouteSourceId, {
				type: "geojson",
				data: hoveredPointGeoJson,
			});
		}

		if (!map.getLayer(hoveredRouteLayerId)) {
			map.addLayer({
				id: hoveredRouteLayerId,
				type: "circle",
				source: hoveredRouteSourceId,
				paint: {
					"circle-color": "rgb(16, 185, 129)",
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						5,
						12,
						7,
						16,
						9,
					],
					"circle-stroke-color": "rgba(255, 255, 255, 0.96)",
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
		ensureHoveredRouteOverlay();

		if (routeBounds) {
			fitRouteBounds();
		} else {
			lastFittedBoundsKey = null;
		}
	});

	$effect(() => {
		const nextLayoutState = layoutState;

		if (!nextLayoutState || !map || !isStyleReady) {
			return;
		}

		scheduleSmoothResize();
	});

	$effect(() => {
		const basemapId = mapStylePreference.selectedBasemapId;
		let cancelled = false;

		if (!map) {
			return;
		}

		const currentMap = map;
		const nextStyleUrl = basemapId ? getBasemapStyleUrl(basemapId) : null;

		if (!nextStyleUrl) {
			loadError = "No map styles configured";
			isLoaded = false;
			isStyleReady = false;
			return () => {
				cancelled = true;
			};
		}

		if (nextStyleUrl === currentStyleUrl) {
			return () => {
				cancelled = true;
			};
		}

		currentStyleUrl = nextStyleUrl;
		loadError = null;
		isLoaded = false;
		isStyleReady = false;
		const handleStyleLoad = () => {
			if (cancelled) {
				return;
			}

			loadError = null;
			isLoaded = true;
			isStyleReady = true;
			scheduleSmoothResize();
			ensureRouteOverlay();
			ensureHoveredRouteOverlay();
		};

		let detached = false;
		let detachCurrentStyleLoad = () => {
			if (detached) {
				return;
			}

			detached = true;
			detachStyleLoadListener = () => {};
		};

		if (typeof currentMap.on === "function" && typeof currentMap.off === "function") {
			currentMap.on("style.load", handleStyleLoad);
			detachCurrentStyleLoad = () => {
				if (detached) {
					return;
				}

				detached = true;
				detachStyleLoadListener = () => {};
				currentMap.off("style.load", handleStyleLoad);
			};
			detachStyleLoadListener = detachCurrentStyleLoad;
		} else {
			detachStyleLoadListener = detachCurrentStyleLoad;
			currentMap.once("style.load", handleStyleLoad);
		}

		currentMap.setStyle(nextStyleUrl);

		return () => {
			cancelled = true;
			detachCurrentStyleLoad();
		};
	});

	onMount(() => {
		let cancelled = false;
		let resizeObserver: ResizeObserver | undefined;

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
					scheduleSmoothResize();
					ensureRouteOverlay();
					ensureHoveredRouteOverlay();
					fitRouteBounds();
				});

				resizeObserver = new ResizeObserver(() => {
					scheduleSmoothResize();
				});
				resizeObserver.observe(mapContainer);
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
			detachStyleLoadListener();
			cancelSmoothResize();
			resizeObserver?.disconnect();
			map?.remove();
			map = null;
			currentStyleUrl = null;
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
