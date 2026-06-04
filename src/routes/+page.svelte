<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { Effect } from "effect";

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
		onchange={(event) =>
			Effect.runFork(controller.importExport.handleGpxImportSelection(event))}
	/>

	<MapView
		layoutState={sidebar.state}
		onMapClick={controller.map.handleMapClick}
		onRouteStopDragEnd={(detail) =>
			Effect.runFork(controller.map.handleRouteStopDragEnd(detail))}
		onRouteSegmentDragEnd={(detail) =>
			Effect.runFork(controller.map.handleRouteSegmentDragEnd(detail))}
		routeOverlays={controller.overlays.routeOverlays}
		plannedRoute={controller.routes.activeRoute}
		routeMode={controller.routes.activeRoute?.mode ?? controller.form.plannerMode}
		manualEditingEnabled={!!controller.routes.activeRoute &&
			!controller.routes.isRouting &&
			!controller.routes.routeNeedsRecalculation}
		lockedSegmentOverlay={controller.overlays.lockedSegmentOverlay}
		lockedSegmentIndexes={controller.overlays.sanitizedLockedSegmentIndexes}
		constraintOverlay={controller.overlays.constraintOverlay}
		avoidanceOverlay={controller.overlays.avoidanceOverlay}
		fitBounds={controller.overlays.combinedRouteBounds}
		fitInitialBoundsWithRestoredCamera={controller.routes.fitInitialSavedRouteBounds}
		manualRecenterBounds={controller.routes.activeRoute?.bounds ?? null}
		manualRecenterRequestKey={controller.map.recenterRouteRequestKey}
		hoveredRouteCoordinate={controller.overlays.highlightedRouteCoordinate}
		focusedRouteCoordinate={controller.analysis.selectedCue?.coordinate ?? null}
		focusedRouteCoordinateKey={controller.analysis.selectedCueFocusKey}
		currentLocation={controller.map.currentLocation}
		currentLocationFocusKey={controller.map.currentLocationFocusKey}
	/>

	<div class="pointer-events-none absolute inset-0 z-20">
		<PlannerMapControls
			{sidebar}
			overlay={controller.overlays}
			map={controller.map}
			hasActiveRoute={!!controller.routes.activeRoute &&
				!controller.routes.routeNeedsRecalculation}
			hasGeneratedRoute={!!controller.routes.activeRoute}
			routeNeedsRecalculation={controller.routes.routeNeedsRecalculation}
		/>

		{#if controller.map.mapClickSelection}
			<MapClickMenu
				selection={controller.map.mapClickSelection}
				plannerMode={controller.form.plannerMode}
				isOutAndBackMode={controller.form.isOutAndBackMode}
				waypointCount={controller.form.waypointStops.length}
				{maxWaypoints}
				isResolving={controller.map.isResolvingMapSelection}
				title={controller.map.getMapClickMenuTitle(
					controller.map.mapClickSelection,
				)}
				subtitle={controller.map.getMapClickMenuSubtitle(
					controller.map.mapClickSelection,
				)}
				removeActionLabel={controller.map.getRemoveActionLabel}
				isWaypointInsertionLocked={controller.map.isMapWaypointInsertionLocked}
				isSegmentLocked={controller.map.isMapSelectionSegmentLocked}
				isSegmentAvoided={controller.map.isMapSelectionRoadAvoided}
				onApplyAsStart={() =>
					Effect.runFork(
						controller.map.applyMapPointAsStop({ kind: "startQuery" }),
					)}
				onApplyAsWaypoint={() =>
					Effect.runFork(controller.map.applyMapPointAsStop({ kind: "waypoint" }))}
				onApplyAsDestination={() =>
					Effect.runFork(
						controller.map.applyMapPointAsStop({ kind: "destinationQuery" }),
					)}
				onToggleSegmentLock={() =>
					controller.map.mapClickSelection &&
					controller.map.toggleMapSelectionSegmentLock(
						controller.map.mapClickSelection,
					)}
				onToggleRoadAvoidance={() =>
					controller.map.mapClickSelection &&
					Effect.runFork(
						controller.map.toggleMapSelectionRoadAvoidance(
							controller.map.mapClickSelection,
						),
					)}
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
			{#if controller.map.selectedBasemap}
				<div
					class="absolute bottom-[calc(100%+0.5rem)] right-0 z-20 max-w-[23rem] rounded-md border border-white/10 bg-black/42 px-2 py-1 text-[10px] leading-none text-white/58 shadow-sm backdrop-blur-[6px] supports-[backdrop-filter]:bg-black/34 md:text-[11px]"
				>
					<span class="mr-1 uppercase tracking-wide text-white/42">Basemap</span>
					{@html controller.map.selectedBasemap.attributionHtml}
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
