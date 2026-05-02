<script lang="ts">
	import { onMount } from "svelte";
	import type { FeatureCollection } from "geojson";
	import type {
		ControlPosition,
		IControl,
		LngLatBoundsLike,
		Map as MapLibreMap,
		MapOptions,
		ScaleControlOptions,
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
	import { getBasemapStyleUrl } from "$lib/map/basemaps";
	import type { SidebarLayoutState } from "$lib/components/ui/sidebar/context.svelte.js";
	import type {
		PlannedRoute,
		RouteBounds,
		RouteCoordinate,
		RouteMapOverlay,
		RouteMode,
	} from "$lib/route-planning";
	import {
		removeConstraintOverlay as removeRenderedConstraintOverlay,
		removeCurrentLocationOverlay as removeRenderedCurrentLocationOverlay,
		removeHoveredRouteOverlay as removeRenderedHoveredRouteOverlay,
		removeLockedSegmentOverlay as removeRenderedLockedSegmentOverlay,
		removeRouteOverlays as removeRenderedRouteOverlays,
		syncConstraintOverlay,
		syncCurrentLocationOverlay,
		syncHoveredRouteOverlay,
		syncLockedSegmentOverlay,
		syncRouteOverlays,
	} from "$lib/map/map-view-renderer";
	import {
		createRouteEditInteractions,
		type RouteSegmentDetail,
		type RouteStopDragEndDetail,
		type SelectedRouteStop,
	} from "$lib/map/route-edit-interactions";

	type Props = {
		initialCenter?: [number, number];
		initialZoom?: number;
		ariaLabel?: string;
		routeOverlays?: RouteMapOverlay[] | null;
		plannedRoute?: PlannedRoute | null;
		routeMode?: RouteMode | null;
		manualEditingEnabled?: boolean;
		lockedSegmentOverlay?: FeatureCollection | null;
		lockedSegmentIndexes?: number[];
		constraintOverlay?: FeatureCollection | null;
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
			selectedStop?: SelectedRouteStop;
			selectedSegment?: {
				coordinateSegmentIndex: number;
				segmentIndex: number;
			};
		}) => void) | null;
		onRouteStopDragEnd?: ((detail: RouteStopDragEndDetail) => void) | null;
		onRouteSegmentDragEnd?: ((detail: RouteSegmentDetail) => void) | null;
		onRouteSegmentSelection?: ((detail: RouteSegmentDetail) => void) | null;
	};

	const defaultCenter = [11.394, 47.268] as [number, number];
	// Matches the 200ms sidebar width transition plus a small buffer for interrupted toggles.
	const layoutTransitionBufferMs = 260;
	const scaleControlPosition: ControlPosition = "bottom-left";
	const webglUnavailableMessage =
		"Map cannot be shown because this browser or device could not create a WebGL context.";
	const mapCanvasContextAttributes: WebGLContextAttributes = {
		antialias: false,
		depth: true,
		failIfMajorPerformanceCaveat: false,
		powerPreference: "high-performance",
		preserveDrawingBuffer: false,
		stencil: true,
	};

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
		fitBounds = null,
		hoveredRouteCoordinate = null,
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
	let scaleControl = $state<IControl | null>(null);
	let currentScaleControlUnit: "metric" | "imperial" | null = null;
	let isLoaded = $state(false);
	let isStyleReady = $state(false);
	let loadError = $state<string | null>(null);
	let lastFittedBoundsKey: string | null = null;
	let currentStyleUrl: string | null = null;
	let detachStyleLoadListener = () => {};
	let detachRouteEditingListeners = () => {};
	let resizeAnimationFrameId: number | null = null;
	let resizeLoopUntil = 0;
	let renderedRouteOverlayIds: string[] = [];
	let lastFocusedCurrentLocationKey: number | null = null;

	function canCreateMapWebGLContext() {
		if (typeof document === "undefined") {
			return false;
		}

		const canvas = document.createElement("canvas");

		try {
			const gl =
				canvas.getContext("webgl2", mapCanvasContextAttributes) ??
				canvas.getContext("webgl", mapCanvasContextAttributes);
			gl?.getExtension("WEBGL_lose_context")?.loseContext();

			return gl !== null;
		} catch {
			return false;
		}
	}

	function parseErrorMessageJson(error: unknown): Record<string, unknown> | null {
		if (!(error instanceof Error)) {
			return null;
		}

		try {
			const parsed = JSON.parse(error.message) as unknown;

			return parsed && typeof parsed === "object"
				? (parsed as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	}

	function isWebGLContextCreationError(error: unknown) {
		const parsedError = parseErrorMessageJson(error);

		if (parsedError?.type === "webglcontextcreationerror") {
			return true;
		}

		const messageParts = [
			error instanceof Error ? error.message : null,
			typeof parsedError?.message === "string" ? parsedError.message : null,
			typeof parsedError?.statusMessage === "string"
				? parsedError.statusMessage
				: null,
		].filter((message): message is string => typeof message === "string");

		return messageParts.some((message) => /webgl/i.test(message));
	}

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

	function removeScaleControl() {
		if (map && scaleControl) {
			map.removeControl(scaleControl);
		}

		scaleControl = null;
		currentScaleControlUnit = null;
	}

	function syncScaleControl() {
		if (!map || !maplibreglModule) {
			return;
		}

		const nextScaleControlUnit = getMapLibreScaleUnit();
		if (scaleControl && currentScaleControlUnit === nextScaleControlUnit) {
			return;
		}

		removeScaleControl();
		scaleControl = new maplibreglModule.ScaleControl({
			maxWidth: 96,
			unit: nextScaleControlUnit,
		} satisfies ScaleControlOptions);
		currentScaleControlUnit = nextScaleControlUnit;
		map.addControl(scaleControl, scaleControlPosition);
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

	function removeRouteOverlays() {
		if (map && isStyleReady) {
			removeRenderedRouteOverlays(map, renderedRouteOverlayIds);
		}

		renderedRouteOverlayIds = [];
	}

	function removeConstraintOverlay() {
		if (map && isStyleReady) {
			removeRenderedConstraintOverlay(map);
		}
	}

	function removeLockedSegmentOverlay() {
		if (map && isStyleReady) {
			removeRenderedLockedSegmentOverlay(map);
		}
	}

	function removeHoveredRouteOverlay() {
		if (map && isStyleReady) {
			removeRenderedHoveredRouteOverlay(map);
		}
	}

	function removeCurrentLocationOverlay() {
		if (map && isStyleReady) {
			removeRenderedCurrentLocationOverlay(map);
		}
	}

	function ensureRouteOverlays() {
		if (!map || !isStyleReady) {
			return;
		}

		renderedRouteOverlayIds = syncRouteOverlays(
			map,
			routeOverlays,
			renderedRouteOverlayIds,
		);
	}

	function ensureConstraintOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		syncConstraintOverlay(map, constraintOverlay);
	}

	function ensureLockedSegmentOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		syncLockedSegmentOverlay(map, lockedSegmentOverlay);
	}

	function ensureHoveredRouteOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		syncHoveredRouteOverlay(map, hoveredRouteCoordinate);
	}

	function ensureCurrentLocationOverlay() {
		if (!map || !isStyleReady) {
			return;
		}

		syncCurrentLocationOverlay(map, currentLocation);
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

		ensureConstraintOverlay();
		ensureRouteOverlays();
		ensureLockedSegmentOverlay();

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

	$effect(() => {
		unitPreference.selectedDistanceUnit;
		syncScaleControl();
	});

	onMount(() => {
		let cancelled = false;
		let resizeObserver: ResizeObserver | undefined;

		initMapStylePreference();
		initUnitPreference();

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

				const options: MapOptions = {
					attributionControl: false,
					center: initialCenter,
					container: mapContainer,
					style: initialStyleUrl,
					zoom: initialZoom,
				};

				map = new maplibregl.Map(options);
				syncScaleControl();
				if (typeof map.on === "function" && typeof map.off === "function") {
					const routeEditInteractions = createRouteEditInteractions({
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
						routeEditInteractions.detach();
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
			detachRouteEditingListeners();
			cancelSmoothResize();
			resizeObserver?.disconnect();
			removeRouteOverlays();
			removeConstraintOverlay();
			removeLockedSegmentOverlay();
			removeHoveredRouteOverlay();
			removeCurrentLocationOverlay();
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
