<script lang="ts">
	import { onDestroy, onMount } from "svelte";

	import MapView from "$lib/components/map-view.svelte";
	import MapClickMenu from "$lib/components/route-planner/map-click-menu.svelte";
	import PlannerMapControls from "$lib/components/route-planner/planner-map-controls.svelte";
	import RouteBuilderPanel from "$lib/components/route-planner/route-builder-panel.svelte";
	import RouteResultDock from "$lib/components/route-planner/route-result-dock.svelte";
	import { useSidebar } from "$lib/components/ui/sidebar/index.js";
	import { gpxFileAccept, maxWaypoints } from "$lib/route-planner/constants";
	import { createRoutePlannerPageController } from "$lib/route-planner/page/route-planner-page-controller.svelte";

	const sidebar = useSidebar();
	const controller = createRoutePlannerPageController();

	let gpxImportInput = $state<HTMLInputElement | null>(null);

	const activeRoute = $derived(controller.routes.activeRoute);
	const plannerMode = $derived(controller.form.plannerMode);
	const isOutAndBackMode = $derived(controller.form.isOutAndBackMode);
	const waypointStops = $derived(controller.form.waypointStops);
	const isRouting = $derived(controller.routes.isRouting);
	const routeNeedsRecalculation = $derived(
		controller.routes.routeNeedsRecalculation,
	);
	const mapClickSelection = $derived(controller.map.mapClickSelection);
	const isResolvingMapSelection = $derived(controller.map.isResolvingMapSelection);
	const routeOverlays = $derived(controller.overlays.routeOverlays);
	const lockedSegmentOverlay = $derived(controller.overlays.lockedSegmentOverlay);
	const sanitizedLockedSegmentIndexes = $derived(
		controller.overlays.sanitizedLockedSegmentIndexes,
	);
	const constraintOverlay = $derived(controller.overlays.constraintOverlay);
	const avoidanceOverlay = $derived(controller.overlays.avoidanceOverlay);
	const combinedRouteBounds = $derived(controller.overlays.combinedRouteBounds);
	const highlightedRouteCoordinate = $derived(
		controller.overlays.highlightedRouteCoordinate,
	);
	const fitInitialSavedRouteBounds = $derived(
		controller.routes.fitInitialSavedRouteBounds,
	);
	const recenterRouteRequestKey = $derived(controller.map.recenterRouteRequestKey);
	const currentLocation = $derived(controller.map.currentLocation);
	const currentLocationFocusKey = $derived(controller.map.currentLocationFocusKey);
	const selectedBasemap = $derived(controller.map.selectedBasemap);
	const selectedCue = $derived(controller.analysis.selectedCue);
	const selectedCueFocusKey = $derived(controller.analysis.selectedCueFocusKey);

	$effect(() => {
		controller.importExport.gpxImportInput = gpxImportInput;
	});

	onMount(() => {
		controller.mount(window);
	});

	onDestroy(() => {
		controller.destroy();
	});
</script>

<div class="relative flex h-full w-full flex-col overflow-hidden bg-background">
	<input
		bind:this={gpxImportInput}
		type="file"
		accept={gpxFileAccept}
		class="sr-only"
		aria-label="Import GPX file"
		onchange={controller.importExport.handleGpxImportSelection}
	/>

	<MapView
		layoutState={sidebar.state}
		onMapClick={controller.map.handleMapClick}
		onRouteStopDragEnd={controller.map.handleRouteStopDragEnd}
		onRouteSegmentDragEnd={controller.map.handleRouteSegmentDragEnd}
		{routeOverlays}
		plannedRoute={activeRoute}
		routeMode={activeRoute?.mode ?? plannerMode}
		manualEditingEnabled={!!activeRoute && !isRouting && !routeNeedsRecalculation}
		{lockedSegmentOverlay}
		lockedSegmentIndexes={sanitizedLockedSegmentIndexes}
		{constraintOverlay}
		{avoidanceOverlay}
		fitBounds={combinedRouteBounds}
		fitInitialBoundsWithRestoredCamera={fitInitialSavedRouteBounds}
		manualRecenterBounds={activeRoute?.bounds ?? null}
		manualRecenterRequestKey={recenterRouteRequestKey}
		hoveredRouteCoordinate={highlightedRouteCoordinate}
		focusedRouteCoordinate={selectedCue?.coordinate ?? null}
		focusedRouteCoordinateKey={selectedCueFocusKey}
		{currentLocation}
		{currentLocationFocusKey}
	/>

	<div class="pointer-events-none absolute inset-0 z-20">
		<PlannerMapControls
			{sidebar}
			overlay={controller.overlays}
			map={controller.map}
			hasActiveRoute={!!activeRoute && !routeNeedsRecalculation}
		/>

		{#if mapClickSelection}
			<MapClickMenu
				selection={mapClickSelection}
				{plannerMode}
				{isOutAndBackMode}
				waypointCount={waypointStops.length}
				{maxWaypoints}
				isResolving={isResolvingMapSelection}
				title={controller.map.getMapClickMenuTitle(mapClickSelection)}
				subtitle={controller.map.getMapClickMenuSubtitle(mapClickSelection)}
				removeActionLabel={controller.map.getRemoveActionLabel}
				isWaypointInsertionLocked={controller.map.isMapWaypointInsertionLocked}
				isSegmentLocked={controller.map.isMapSelectionSegmentLocked}
				isSegmentAvoided={controller.map.isMapSelectionRoadAvoided}
				onApplyAsStart={() =>
					controller.map.applyMapPointAsStop({ kind: "startQuery" })}
				onApplyAsWaypoint={() =>
					controller.map.applyMapPointAsStop({ kind: "waypoint" })}
				onApplyAsDestination={() =>
					controller.map.applyMapPointAsStop({ kind: "destinationQuery" })}
				onToggleSegmentLock={() =>
					mapClickSelection &&
					controller.map.toggleMapSelectionSegmentLock(mapClickSelection)}
				onToggleRoadAvoidance={() =>
					mapClickSelection &&
					void controller.map.toggleMapSelectionRoadAvoidance(mapClickSelection)}
				onRemoveStop={controller.map.removeSelectedMapStop}
				onClose={controller.map.closeMapClickMenu}
			/>
		{/if}
	</div>

	<div
		class="pointer-events-none relative z-10 flex h-full min-h-0 w-full flex-col gap-3 p-4 md:p-5"
	>
		<div class="flex min-h-0 min-w-0 flex-1 gap-5 md:gap-6">
			<RouteBuilderPanel
				form={controller.form}
				routes={controller.routes}
				map={controller.map}
				importExport={controller.importExport}
				analysis={controller.analysis}
			/>
		</div>

		<div class="pointer-events-auto relative w-full shrink-0">
			{#if selectedBasemap}
				<div
					class="absolute bottom-[calc(100%+0.5rem)] right-0 z-20 max-w-[23rem] rounded-md border border-white/10 bg-black/42 px-2 py-1 text-[10px] leading-none text-white/58 shadow-sm backdrop-blur-[6px] supports-[backdrop-filter]:bg-black/34 md:text-[11px]"
				>
					<span class="mr-1 uppercase tracking-wide text-white/42">Basemap</span>
					{@html selectedBasemap.attributionHtml}
				</div>
			{/if}

			<RouteResultDock
				form={controller.form}
				routes={controller.routes}
				analysis={controller.analysis}
				save={controller.save}
				sharing={controller.sharing}
				importExport={controller.importExport}
			/>
		</div>
	</div>
</div>
