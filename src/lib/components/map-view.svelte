<script lang="ts">
	import { Effect } from "effect";
	import { onMount } from "svelte";
	import type {
		Map as MapLibreMap,
		MapOptions,
	} from "maplibre-gl";

	import {
		initMapStylePreference,
		mapStylePreference,
		syncSelectedBasemap,
	} from "$lib/map-style-settings.svelte";
	import {
		getMapLibreScaleUnit,
		initUnitPreference,
		unitPreference,
	} from "$lib/unit-settings.svelte";
	import type { MapCameraPreference } from "$lib/preferences/map-camera-preferences";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import { getBasemapStyleUrl } from "$lib/map/basemaps";
	import {
		attachMapCameraPreferenceListeners,
		readStoredMapCameraPreference,
		writeStoredMapCameraPreference,
	} from "$lib/map/map-view-camera-preferences";
	import {
		asLngLatBounds,
		defaultCenter,
		getBoundsKey,
		getCurrentMapCameraPreference,
		getFitBoundsOptions,
		mapCameraPreferenceDebounceMs,
		resolveMapBearing,
		resolveMapCenter,
		resolveMapPitch,
		resolveMapZoom,
		resolveRouteBounds,
		shouldPersistMapCameraPreference,
	} from "$lib/map/map-view-camera";
	import { createMapViewOverlayController } from "$lib/map/map-view-overlays";
	import {
		emptyMapScaleControlState,
		removeMapScaleControl,
		syncMapScaleControl,
	} from "$lib/map/map-view-scale-control";
	import {
		createSmoothMapResizer,
		layoutTransitionBufferMs,
	} from "$lib/map/map-view-resize";
	import {
		canCreateMapWebGLContext,
		isWebGLContextCreationError,
		webglUnavailableMessage,
	} from "$lib/map/map-view-webgl";
	import type { MapViewProps as Props } from "$lib/components/map-view-types";
	import {
		createRouteEditInteractions,
	} from "$lib/map/route-edit-interactions";

	let {
		initialCenter = defaultCenter,
		initialZoom = 10,
		ariaLabel = "Route map",
		routeOverlays = null,
		plannedRoute = null,
		routeMode = null,
		manualEditingEnabled = false,
		lockedSegmentOverlay = null,
		lockedSegmentIndexes = [],
		constraintOverlay = null,
		avoidanceOverlay = null,
		fitBounds = null,
		fitInitialBoundsWithRestoredCamera = false,
		manualRecenterBounds = null,
		manualRecenterRequestKey = 0,
		hoveredRouteCoordinate = null,
		focusedRouteCoordinate = null,
		focusedRouteCoordinateKey = 0,
		currentLocation = null,
		currentLocationFocusKey = 0,
		layoutState = null,
		onMapClick = null,
		onRouteStopDragEnd = null,
		onRouteSegmentDragEnd = null,
		onRouteSegmentSelection = null,
	}: Props = $props();

	let mapContainer = $state<HTMLDivElement | null>(null);
	let map = $state<MapLibreMap | null>(null);
	let maplibreglModule = $state<typeof import("maplibre-gl") | null>(null);
	let scaleControlState = emptyMapScaleControlState;
	let isLoaded = $state(false);
	let isStyleReady = $state(false);
	let loadError = $state<string | null>(null);
	let lastFittedBoundsKey: string | null = null;
	let lastManualRecenterRequestKey = 0;
	let currentStyleUrl: string | null = null;
	let detachStyleLoadListener = () => {};
	let detachCameraPreferenceListeners = () => {};
	let detachRouteEditingListeners = () => {};
	let routeEditInteractions: ReturnType<typeof createRouteEditInteractions> | null =
		null;
	let lastFocusedCurrentLocationKey: number | null = null;
	let lastFocusedRouteCoordinateKey: number | null = null;
	let pendingCameraPreferenceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastPersistedCameraPreference: MapCameraPreference | null = null;
	const smoothMapResizer = createSmoothMapResizer(() => {
		map?.resize();
		map?.triggerRepaint?.();
	});
	const overlayController = createMapViewOverlayController({
		getMap: () => map,
		getIsStyleReady: () => isStyleReady,
		clearProjectionCache: () => routeEditInteractions?.clearProjectionCache(),
	});

	function setWebGLUnavailableError() {
		loadError = webglUnavailableMessage;
		isLoaded = false;
		isStyleReady = false;
	}

	function setMapCursor(cursor: string) {
		if (mapContainer) {
			mapContainer.style.cursor = cursor;
		}
	}

	function removeScaleControl() {
		scaleControlState = removeMapScaleControl(map, scaleControlState);
	}

	function syncScaleControl() {
		scaleControlState = syncMapScaleControl({
			map,
			maplibreglModule,
			state: scaleControlState,
			unit: getMapLibreScaleUnit(),
		});
	}

	function scheduleSmoothResize(durationMs = layoutTransitionBufferMs) {
		if (!map) {
			return;
		}

		smoothMapResizer.schedule(durationMs);
	}

	function fitRouteBounds() {
		const nextFitBounds = resolveRouteBounds(fitBounds);

		if (!map || !isStyleReady || !nextFitBounds) {
			return;
		}

		const nextBoundsKey = nextFitBounds.join(",");

		if (nextBoundsKey === lastFittedBoundsKey) {
			return;
		}

		map.fitBounds(asLngLatBounds(nextFitBounds), getFitBoundsOptions());
		lastFittedBoundsKey = nextBoundsKey;
	}

	function fitManualRecenterBounds() {
		const nextRecenterBounds = resolveRouteBounds(manualRecenterBounds);

		if (!map || !isStyleReady || !nextRecenterBounds) {
			return;
		}

		map.fitBounds(asLngLatBounds(nextRecenterBounds), getFitBoundsOptions());
	}

	function flushCurrentMapCameraPersistence() {
		pendingCameraPreferenceTimer = null;

		if (!map) {
			return;
		}

		const currentCamera = getCurrentMapCameraPreference(map);

		if (
			!currentCamera ||
			!shouldPersistMapCameraPreference(
				lastPersistedCameraPreference,
				currentCamera,
			)
		) {
			return;
		}

		try {
			writeStoredMapCameraPreference(currentCamera);
			lastPersistedCameraPreference = currentCamera;
		} catch (error) {
			console.error("Failed to persist map camera preference", error);
		}
	}

	function scheduleCurrentMapCameraPersistence() {
		cancelPendingMapCameraPersistence();
		pendingCameraPreferenceTimer = setTimeout(
			flushCurrentMapCameraPersistence,
			mapCameraPreferenceDebounceMs,
		);
	}

	function cancelPendingMapCameraPersistence() {
		if (pendingCameraPreferenceTimer === null) {
			return;
		}

		clearTimeout(pendingCameraPreferenceTimer);
		pendingCameraPreferenceTimer = null;
	}

	function attachCameraPreferenceListeners() {
		const detach = attachMapCameraPreferenceListeners(
			map,
			scheduleCurrentMapCameraPersistence,
		);
		detachCameraPreferenceListeners = () => {
			detach();
			detachCameraPreferenceListeners = () => {};
		};
	}

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		overlayController.ensureRouteOverlays(routeOverlays);
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		overlayController.ensureConstraintOverlay(constraintOverlay);
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		overlayController.ensureRouteAvoidanceOverlay(avoidanceOverlay);
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		overlayController.ensureLockedSegmentOverlay(lockedSegmentOverlay);
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

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

		if (lastManualRecenterRequestKey === manualRecenterRequestKey) {
			return;
		}

		lastManualRecenterRequestKey = manualRecenterRequestKey;
		fitManualRecenterBounds();
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		overlayController.ensureHoveredRouteOverlay(hoveredRouteCoordinate);
	});

	$effect(() => {
		if (!map || !isStyleReady) {
			return;
		}

		overlayController.ensureCurrentLocationOverlay(currentLocation);
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
		if (!map || !isStyleReady || !focusedRouteCoordinate) {
			return;
		}

		if (lastFocusedRouteCoordinateKey === focusedRouteCoordinateKey) {
			return;
		}

		lastFocusedRouteCoordinateKey = focusedRouteCoordinateKey;
		map.easeTo?.({
			center: [focusedRouteCoordinate[0], focusedRouteCoordinate[1]],
			zoom: Math.max(map.getZoom?.() ?? 0, 13),
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
			currentStyleUrl = null;
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
		overlayController.removeRouteOverlays();
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

	$effect(() => {
		unitPreference.selectedDistanceUnit;
		syncScaleControl();
	});

	onMount(() => {
		let cancelled = false;
		let resizeObserver: ResizeObserver | undefined;

		try {
			Effect.runSync(initMapStylePreference());
		} catch (error) {
			console.error("Failed to initialize map style preference", error);
		}

		try {
			Effect.runSync(initUnitPreference());
		} catch (error) {
			console.error("Failed to initialize unit preference", error);
		}

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

				if (!canCreateMapWebGLContext()) {
					setWebGLUnavailableError();
					return;
				}

				const maplibregl = await import("maplibre-gl");

				if (cancelled || !mapContainer) return;

				maplibreglModule = maplibregl;
				currentStyleUrl = initialStyleUrl;
				let restoredCamera: MapCameraPreference | undefined;
				try {
					restoredCamera = readStoredMapCameraPreference();
				} catch (error) {
					console.error("Failed to restore map camera preference", error);
				}
				lastPersistedCameraPreference = restoredCamera ?? null;

				if (
					restoredCamera &&
					!fitInitialBoundsWithRestoredCamera &&
					resolveRouteBounds(fitBounds)
				) {
					lastFittedBoundsKey = getBoundsKey(fitBounds);
				}

				const options: MapOptions = {
					attributionControl: false,
					center: resolveMapCenter(restoredCamera?.center, initialCenter),
					container: mapContainer,
					bearing: resolveMapBearing(restoredCamera?.bearing),
					pitch: resolveMapPitch(restoredCamera?.pitch),
					style: initialStyleUrl,
					zoom: resolveMapZoom(restoredCamera?.zoom, initialZoom),
				};

				map = new maplibregl.Map(options);
				attachCameraPreferenceListeners();
				syncScaleControl();
				if (typeof map.on === "function" && typeof map.off === "function") {
					routeEditInteractions = createRouteEditInteractions({
						map,
						getRouteOverlays: () => routeOverlays,
						getPlannedRoute: () => plannedRoute,
						getRouteMode: () => routeMode,
						getManualEditingEnabled: () => manualEditingEnabled,
						getLockedSegmentIndexes: () => lockedSegmentIndexes,
						setCursor: setMapCursor,
						onMapClick: (detail) => onMapClick?.(detail),
						onRouteStopDragEnd: (detail) => onRouteStopDragEnd?.(detail),
						onRouteSegmentDragEnd: (detail) => onRouteSegmentDragEnd?.(detail),
						onRouteSegmentSelection: (detail) =>
							onRouteSegmentSelection?.(detail),
					});
					routeEditInteractions.attach();
					detachRouteEditingListeners = () => {
						routeEditInteractions?.detach();
						routeEditInteractions = null;
						detachRouteEditingListeners = () => {};
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

				if (isWebGLContextCreationError(error)) {
					setWebGLUnavailableError();
					return;
				}

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
			detachCameraPreferenceListeners();
			cancelPendingMapCameraPersistence();
			detachRouteEditingListeners();
			smoothMapResizer.cancel();
			resizeObserver?.disconnect();
			overlayController.removeRouteOverlays();
			overlayController.removeConstraintOverlay();
			overlayController.removeRouteAvoidanceOverlay();
			overlayController.removeLockedSegmentOverlay();
			overlayController.removeHoveredRouteOverlay();
			overlayController.removeCurrentLocationOverlay();
			removeScaleControl();
			map?.remove();
			map = null;
			maplibreglModule = null;
			currentStyleUrl = null;
			isStyleReady = false;
		};
	});
</script>

<div class="absolute inset-0 overflow-hidden bg-slate-100" data-slot="map-view">
	<!-- biome-ignore-start lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
	<!-- biome-ignore lint/a11y/useSemanticElements: MapLibre expects this bound map container element. -->
	<div
		bind:this={mapContainer}
		class="h-full w-full"
		role="region"
		aria-busy={!isLoaded && !loadError ? "true" : "false"}
		aria-label={ariaLabel}
	></div>
	<!-- biome-ignore-end lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
	<div
		class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.22),transparent_36%),linear-gradient(to_bottom,rgba(255,255,255,0.08),transparent_24%)]"
	></div>
	{#if !isLoaded && !loadError}
		<div
			class="pointer-events-none absolute inset-0 overflow-hidden bg-muted/80"
			aria-hidden="true"
			data-testid="map-loading-skeleton"
		>
			<Skeleton class="absolute left-[8%] top-[12%] h-3 w-[34%] rotate-[-8deg] rounded-full bg-secondary" />
			<Skeleton class="absolute right-[10%] top-[22%] h-3 w-[38%] rotate-[14deg] rounded-full bg-secondary" />
			<Skeleton class="absolute left-[18%] top-[46%] h-3 w-[52%] rotate-[4deg] rounded-full bg-secondary" />
			<Skeleton class="absolute bottom-[24%] right-[14%] h-3 w-[42%] rotate-[-16deg] rounded-full bg-secondary" />
			<Skeleton class="absolute bottom-[14%] left-[10%] h-24 w-32 rounded-lg bg-secondary/80" />
			<Skeleton class="absolute right-4 top-4 h-10 w-10 rounded-md bg-secondary/80" />
		</div>
	{/if}
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

<style>
	[data-slot="map-view"] :global(.maplibregl-ctrl-bottom-left) {
		bottom: calc(env(safe-area-inset-bottom, 0px) + 9rem);
		left: calc(env(safe-area-inset-left, 0px) + 1rem);
		position: fixed;
	}

	[data-slot="map-view"] :global(.maplibregl-ctrl-bottom-left .maplibregl-ctrl) {
		margin: 0;
	}

	[data-slot="map-view"] :global(.maplibregl-ctrl-scale) {
		min-width: 3rem;
		border: 1px solid rgba(15, 23, 42, 0.18);
		border-top: 0;
		background: rgba(255, 255, 255, 0.82);
		box-shadow: 0 8px 22px rgba(15, 23, 42, 0.14);
		color: rgb(15, 23, 42);
		font-size: 0.6875rem;
		font-weight: 650;
		line-height: 1;
		text-shadow: none;
		backdrop-filter: blur(12px) saturate(1.12);
	}

	@media (min-width: 768px) {
		[data-slot="map-view"] :global(.maplibregl-ctrl-bottom-left) {
			bottom: calc(env(safe-area-inset-bottom, 0px) + 7rem);
			left: calc(env(safe-area-inset-left, 0px) + 23rem);
		}
	}
</style>
