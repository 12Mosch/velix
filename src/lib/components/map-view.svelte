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
	import type {
		RouteBounds,
		RouteCoordinate,
		RouteMapOverlay,
	} from "$lib/route-planning";

	type Props = {
		initialCenter?: [number, number];
		initialZoom?: number;
		ariaLabel?: string;
		routeOverlays?: RouteMapOverlay[] | null;
		fitBounds?: RouteBounds | null;
		hoveredRouteCoordinate?: RouteCoordinate | null;
		currentLocation?: {
			point: [number, number];
			accuracyMeters?: number;
		} | null;
		currentLocationFocusKey?: number;
		layoutState?: SidebarLayoutState | null;
		onMapClick?: ((detail: {
			point: [number, number];
			screenPoint: {
				x: number;
				y: number;
			};
			selectedStop?:
				| {
						kind: "start" | "destination";
						label?: string;
				  }
				| {
						kind: "waypoint";
						label?: string;
						index: number;
				  };
		}) => void) | null;
	};

	const defaultCenter = [11.394, 47.268] as [number, number];
	const routeSourcePrefix = "planned-route";
	const hoveredRouteSourceId = "planned-route-hover";
	const hoveredRouteLayerId = "planned-route-hover-point";
	const currentLocationSourceId = "current-location";
	const currentLocationAccuracyLayerId = "current-location-accuracy";
	const currentLocationPointLayerId = "current-location-point";
	const alternativeRoutePalette = [
		"rgba(15, 23, 42, 0.34)",
		"rgba(71, 85, 105, 0.34)",
		"rgba(100, 116, 139, 0.34)",
	] as const;
	// Matches the 200ms sidebar width transition plus a small buffer for interrupted toggles.
	const layoutTransitionBufferMs = 260;

	let {
		initialCenter = defaultCenter,
		initialZoom = 10,
		ariaLabel = "Route map",
		routeOverlays = null,
		fitBounds = null,
		hoveredRouteCoordinate = null,
		currentLocation = null,
		currentLocationFocusKey = 0,
		layoutState = null,
		onMapClick = null,
	}: Props = $props();

	let mapContainer = $state<HTMLDivElement | null>(null);
	let map = $state<MapLibreMap | null>(null);
	let isLoaded = $state(false);
	let isStyleReady = $state(false);
	let loadError = $state<string | null>(null);
	let lastFittedBoundsKey: string | null = null;
	let currentStyleUrl: string | null = null;
	let detachStyleLoadListener = () => {};
	let detachMapClickListener = () => {};
	let resizeAnimationFrameId: number | null = null;
	let resizeLoopUntil = 0;
	let renderedRouteOverlayIds: string[] = [];
	let lastFocusedCurrentLocationKey: number | null = null;

	function getRouteSourceId(overlayId: string) {
		return `${routeSourcePrefix}-${overlayId}`;
	}

	function getRouteLineLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-line`;
	}

	function getRouteCasingLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-casing`;
	}

	function getRouteStartLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-start`;
	}

	function getRouteWaypointLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-waypoint`;
	}

	function getRouteDestinationLayerId(overlayId: string) {
		return `${getRouteSourceId(overlayId)}-destination`;
	}

	function getSelectedOverlay() {
		if (!routeOverlays || routeOverlays.length === 0) {
			return null;
		}

		return routeOverlays.find((overlay) => overlay.isSelected) ?? routeOverlays[0];
	}

	function getSelectedStopAtPoint(screenPoint: { x: number; y: number }) {
		if (!map || typeof map.queryRenderedFeatures !== "function") {
			return undefined;
		}

		const selectedOverlay = getSelectedOverlay();

		if (!selectedOverlay) {
			return undefined;
		}

		const matchingFeature = map
			.queryRenderedFeatures([screenPoint.x, screenPoint.y], {
				layers: [
					getRouteStartLayerId(selectedOverlay.id),
					getRouteWaypointLayerId(selectedOverlay.id),
					getRouteDestinationLayerId(selectedOverlay.id),
				],
			})
			.find((feature) => {
				const kind = feature.properties?.kind;
				return (
					kind === "start" || kind === "waypoint" || kind === "destination"
				);
			});

		if (!matchingFeature) {
			return undefined;
		}

		const kind = matchingFeature?.properties?.kind;

		if (kind === "start" || kind === "destination") {
			return {
				kind,
				label:
					typeof matchingFeature.properties?.label === "string"
						? matchingFeature.properties.label
						: undefined,
			};
		}

		if (kind === "waypoint") {
			const order = Number(matchingFeature.properties?.order);

			if (!Number.isFinite(order) || order < 1) {
				return undefined;
			}

			return {
				kind,
				label:
					typeof matchingFeature.properties?.label === "string"
						? matchingFeature.properties.label
						: undefined,
				index: order - 1,
			};
		}

		return undefined;
	}

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

	function getHoveredRouteSource() {
		return map?.getSource(hoveredRouteSourceId) as GeoJSONSource | undefined;
	}

	function getCurrentLocationSource() {
		return map?.getSource(currentLocationSourceId) as GeoJSONSource | undefined;
	}

	function removeRouteOverlayById(overlayId: string) {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [
			getRouteDestinationLayerId(overlayId),
			getRouteWaypointLayerId(overlayId),
			getRouteStartLayerId(overlayId),
			getRouteLineLayerId(overlayId),
			getRouteCasingLayerId(overlayId),
		]) {
			if (map.getLayer(layerId)) {
				map.removeLayer(layerId);
			}
		}

		const sourceId = getRouteSourceId(overlayId);

		if (map.getSource(sourceId)) {
			map.removeSource(sourceId);
		}
	}

	function removeRouteOverlays() {
		for (const overlayId of renderedRouteOverlayIds) {
			removeRouteOverlayById(overlayId);
		}

		renderedRouteOverlayIds = [];
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

	function removeCurrentLocationOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		for (const layerId of [
			currentLocationPointLayerId,
			currentLocationAccuracyLayerId,
		]) {
			if (map.getLayer(layerId)) {
				map.removeLayer(layerId);
			}
		}

		if (map.getSource(currentLocationSourceId)) {
			map.removeSource(currentLocationSourceId);
		}
	}

	function ensureRouteOverlays() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!routeOverlays || routeOverlays.length === 0) {
			removeRouteOverlays();
			return;
		}

		removeRouteOverlays();

		for (const [index, overlay] of routeOverlays.entries()) {
			const sourceId = getRouteSourceId(overlay.id);
			const casingLayerId = getRouteCasingLayerId(overlay.id);
			const lineLayerId = getRouteLineLayerId(overlay.id);
			const startLayerId = getRouteStartLayerId(overlay.id);
			const waypointLayerId = getRouteWaypointLayerId(overlay.id);
			const destinationLayerId = getRouteDestinationLayerId(overlay.id);
			const alternativeColor =
				alternativeRoutePalette[index % alternativeRoutePalette.length];

			map.addSource(sourceId, {
				type: "geojson",
				data: overlay.geoJson,
			});

			map.addLayer({
				id: casingLayerId,
				type: "line",
				source: sourceId,
				filter: ["==", ["get", "kind"], "route"],
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: overlay.isSelected
					? {
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
						}
					: {
							"line-color": "rgba(255, 255, 255, 0.32)",
							"line-width": [
								"interpolate",
								["linear"],
								["zoom"],
								6,
								2.5,
								12,
								4,
								16,
								5.5,
							],
							"line-opacity": 0.55,
						},
			});
			map.addLayer({
				id: lineLayerId,
				type: "line",
				source: sourceId,
				filter: ["==", ["get", "kind"], "route"],
				layout: {
					"line-cap": "round",
					"line-join": "round",
				},
				paint: overlay.isSelected
					? {
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
						}
					: {
							"line-color": alternativeColor,
							"line-width": [
								"interpolate",
								["linear"],
								["zoom"],
								6,
								1.5,
								12,
								2.5,
								16,
								3.5,
							],
						},
			});

			if (!overlay.isSelected) {
				continue;
			}

			map.addLayer({
				id: startLayerId,
				type: "circle",
				source: sourceId,
				filter: ["==", ["get", "kind"], "start"],
				paint: {
					"circle-color": "rgb(15, 118, 110)",
					"circle-radius": 7,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 3,
				},
			});
			map.addLayer({
				id: waypointLayerId,
				type: "circle",
				source: sourceId,
				filter: ["==", ["get", "kind"], "waypoint"],
				paint: {
					"circle-color": "rgb(245, 158, 11)",
					"circle-radius": 6,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 2.5,
				},
			});
			map.addLayer({
				id: destinationLayerId,
				type: "circle",
				source: sourceId,
				filter: ["==", ["get", "kind"], "destination"],
				paint: {
					"circle-color": "rgb(37, 99, 235)",
					"circle-radius": 7,
					"circle-stroke-color": "rgba(255, 255, 255, 0.95)",
					"circle-stroke-width": 3,
				},
			});
		}

		renderedRouteOverlayIds = routeOverlays.map((overlay) => overlay.id);
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

	function buildCurrentLocationGeoJson(): FeatureCollection {
		const accuracyMeters =
			currentLocation &&
			typeof currentLocation.accuracyMeters === "number" &&
			Number.isFinite(currentLocation.accuracyMeters) &&
			currentLocation.accuracyMeters > 0
				? currentLocation.accuracyMeters
				: null;

		return {
			type: "FeatureCollection",
			features: [
				...(currentLocation && accuracyMeters
					? [
							{
								type: "Feature" as const,
								properties: {
									kind: "accuracy",
									accuracyMeters,
								},
								geometry: {
									type: "Point" as const,
									coordinates: currentLocation.point,
								},
							},
						]
					: []),
				...(currentLocation
					? [
							{
								type: "Feature" as const,
								properties: {
									kind: "current-location",
								},
								geometry: {
									type: "Point" as const,
									coordinates: currentLocation.point,
								},
							},
						]
					: []),
			],
		};
	}

	function ensureCurrentLocationOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		if (!currentLocation) {
			removeCurrentLocationOverlay();
			return;
		}

		const locationGeoJson = buildCurrentLocationGeoJson();
		const existingSource = getCurrentLocationSource();

		if (existingSource) {
			existingSource.setData(locationGeoJson);
		} else {
			map.addSource(currentLocationSourceId, {
				type: "geojson",
				data: locationGeoJson,
			});
		}

		if (!map.getLayer(currentLocationAccuracyLayerId)) {
			map.addLayer({
				id: currentLocationAccuracyLayerId,
				type: "circle",
				source: currentLocationSourceId,
				filter: ["==", ["get", "kind"], "accuracy"],
				paint: {
					"circle-color": "rgba(14, 165, 233, 0.16)",
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						8,
						["max", 10, ["/", ["get", "accuracyMeters"], 18]],
						14,
						["max", 18, ["/", ["get", "accuracyMeters"], 3]],
						17,
						["max", 28, ["/", ["get", "accuracyMeters"], 0.85]],
					],
					"circle-stroke-color": "rgba(14, 165, 233, 0.35)",
					"circle-stroke-width": 1.5,
				},
			});
		}

		if (!map.getLayer(currentLocationPointLayerId)) {
			map.addLayer({
				id: currentLocationPointLayerId,
				type: "circle",
				source: currentLocationSourceId,
				filter: ["==", ["get", "kind"], "current-location"],
				paint: {
					"circle-color": "rgb(14, 165, 233)",
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						6,
						6,
						12,
						8,
						16,
						10,
					],
					"circle-stroke-color": "rgba(255, 255, 255, 0.98)",
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
		if (!map || !isStyleReady || !fitBounds) {
			return;
		}

		const nextBoundsKey = fitBounds.join(",");

		if (nextBoundsKey === lastFittedBoundsKey) {
			return;
		}

		map.fitBounds(fitBounds as LngLatBoundsLike, {
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

		ensureRouteOverlays();

		if (fitBounds) {
			fitRouteBounds();
		} else {
			lastFittedBoundsKey = null;
		}
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		ensureHoveredRouteOverlay();
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		ensureCurrentLocationOverlay();
	});

	$effect(() => {
		if (!map || !isStyleReady || !currentLocation) {
			return;
		}

		if (lastFocusedCurrentLocationKey === currentLocationFocusKey) {
			return;
		}

		lastFocusedCurrentLocationKey = currentLocationFocusKey;
		map.easeTo?.({
			center: currentLocation.point,
			zoom: 14,
			duration: 600,
		});
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
				if (typeof map.on === "function" && typeof map.off === "function") {
					const handleMapClick = (event: {
						lngLat?: { lng?: number; lat?: number };
						point?: { x?: number; y?: number };
					}) => {
						const longitude = event.lngLat?.lng;
						const latitude = event.lngLat?.lat;
						const clickX = event.point?.x;
						const clickY = event.point?.y;

						if (
							typeof longitude !== "number" ||
							typeof latitude !== "number" ||
							typeof clickX !== "number" ||
							typeof clickY !== "number"
						) {
							return;
						}

						onMapClick?.({
							point: [longitude, latitude],
							screenPoint: {
								x: clickX,
								y: clickY,
							},
							selectedStop: getSelectedStopAtPoint({
								x: clickX,
								y: clickY,
							}),
						});
					};

					map.on("click", handleMapClick);
					detachMapClickListener = () => {
						map?.off("click", handleMapClick);
						detachMapClickListener = () => {};
					};
				}
				map.once("load", () => {
					if (cancelled) return;
					loadError = null;
					isLoaded = true;
					isStyleReady = true;
					scheduleSmoothResize();
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
			detachMapClickListener();
			cancelSmoothResize();
			resizeObserver?.disconnect();
			removeRouteOverlays();
			removeHoveredRouteOverlay();
			removeCurrentLocationOverlay();
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
