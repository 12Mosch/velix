<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import PlannerStopInput from "$lib/components/route-planner/planner-stop-input.svelte";
	import {
		areaRadiusStepMeters,
		constraintCenterCompletionTarget,
		corridorWidthStepMeters,
		destinationCompletionTarget,
		maxAreaRadiusMeters,
		maxCorridorWidthMeters,
		maxWaypoints,
		minAreaRadiusMeters,
		minCorridorWidthMeters,
		minRoundCourseDistanceMeters,
		plannerModeOptions,
		startCompletionTarget,
	} from "$lib/route-planner/constants";
	import { formatDistanceInputAttribute } from "$lib/route-planner/formatters";
	import { getDistanceUnitLabel } from "$lib/unit-settings.svelte";
	import type { SpatialConstraintEnforcement } from "$lib/route-planning";
	import type { RoundCourseTargetKind, SpatialConstraintKind } from "$lib/route-planner/types";
	import type { PlannerAnalysisController, PlannerFormController, PlannerImportExportController, PlannerMapController, PlannerRoutesController, RoutePlannerPageController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import { getWaypointCompletionTarget } from "$lib/route-planner/page/planner-completion.svelte";
	import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, LocateFixed, MapPin, Navigation, Plus, X } from "@lucide/svelte";

	let { form }: { form: PlannerFormController; routes: PlannerRoutesController; map: PlannerMapController; importExport: PlannerImportExportController; analysis: PlannerAnalysisController } = $props();
	const controller = $derived(form as unknown as RoutePlannerPageController);
	const directionsOpen = $derived(controller.directionsOpen);
	const routeAnalysisOpen = $derived(controller.routeAnalysisOpen);
	const gradientOverlayEnabled = $derived(controller.gradientOverlayEnabled);
	const windOverlayEnabled = $derived(controller.windOverlayEnabled);
	const plannerMode = $derived(controller.plannerMode);
	const startStop = $derived(controller.startStop);
	const waypointStops = $derived(controller.waypointStops);
	const destinationStop = $derived(controller.destinationStop);
	const roundCourseTargetKind = $derived(controller.roundCourseTargetKind);
	const roundCourseDistanceInput = $derived(controller.roundCourseDistanceInput);
	const roundCourseDistanceMetersInput = $derived(controller.roundCourseDistanceMetersInput);
	const roundCourseDurationInput = $derived(controller.roundCourseDurationInput);
	const roundCourseAscendMeters = $derived(controller.roundCourseAscendMeters);
	const spatialConstraintKind = $derived(controller.spatialConstraintKind);
	const spatialConstraintEnforcement = $derived(controller.spatialConstraintEnforcement);
	const constraintCenterStop = $derived(controller.constraintCenterStop);
	const areaRadiusInput = $derived(controller.areaRadiusInput);
	const corridorWidthInput = $derived(controller.corridorWidthInput);
	const areaRadiusMetersInput = $derived(controller.areaRadiusMetersInput);
	const corridorWidthMetersInput = $derived(controller.corridorWidthMetersInput);
	const formattedInputDistanceUnit = $derived(controller.formattedInputDistanceUnit);
	const routeRequestError = $derived(controller.routeRequestError);
	const routeImportError = $derived(controller.routeImportError);
	const fieldErrors = $derived(controller.fieldErrors);
	const isRouting = $derived(controller.isRouting);
	const isImportingGpx = $derived(controller.isImportingGpx);
	const routeAlternatives = $derived(controller.routeAlternatives);
	const selectedRouteIndex = $derived(controller.selectedRouteIndex);
	const lockedSegmentIndexes = $derived(controller.lockedSegmentIndexes);
	const avoidedRoads = $derived(controller.avoidedRoads);
	const lastGeneratedRouteCount = $derived(controller.lastGeneratedRouteCount);
	const routeExportError = $derived(controller.routeExportError);
	const routeShareErrors = $derived(controller.routeShareErrors);
	const routeShareUrls = $derived(controller.routeShareUrls);
	const isSharingRoute = $derived(controller.isSharingRoute);
	const activeRouteShareCopied = $derived(controller.activeRouteShareCopied);
	const saveSyncError = $derived(controller.saveSyncError);
	const activeSavedRouteId = $derived(controller.activeSavedRouteId);
	const plannerDraftRouteId = $derived(controller.plannerDraftRouteId);
	const isActiveRouteSaved = $derived(controller.isActiveRouteSaved);
	const pendingSavedRouteId = $derived(controller.pendingSavedRouteId);
	const clientFetch = $derived(controller.clientFetch);
	const activeProfileIndex = $derived(controller.activeProfileIndex);
	const chartScrubPointerId = $derived(controller.chartScrubPointerId);
	const mapClickSelection = $derived(controller.mapClickSelection);
	const isResolvingMapSelection = $derived(controller.isResolvingMapSelection);
	const currentLocation = $derived(controller.currentLocation);
	const currentLocationFocusKey = $derived(controller.currentLocationFocusKey);
	const recenterRouteRequestKey = $derived(controller.recenterRouteRequestKey);
	const fitInitialSavedRouteBounds = $derived(controller.fitInitialSavedRouteBounds);
	const isLocating = $derived(controller.isLocating);
	const currentLocationError = $derived(controller.currentLocationError);
	const gpxImportInput = $derived(controller.gpxImportInput);
	const undoStack = $derived(controller.undoStack);
	const redoStack = $derived(controller.redoStack);
	const advancedOpen = $derived(controller.advancedOpen);
	const completionController = $derived(controller.completionController);
	const selectedCueIndex = $derived(controller.selectedCueIndex);
	const selectedCueFocusKey = $derived(controller.selectedCueFocusKey);
	const lastCueRouteKey = $derived(controller.lastCueRouteKey);
	const selectedBasemap = $derived(controller.selectedBasemap);
	const availableBasemapOptions = $derived(controller.availableBasemapOptions);
	const isRoundCourseMode = $derived(controller.isRoundCourseMode);
	const isOutAndBackMode = $derived(controller.isOutAndBackMode);
	const activeRoute = $derived(controller.activeRoute);
	const activeDirections = $derived(controller.activeDirections);
	const activeTurnCount = $derived(controller.activeTurnCount);
	const selectedCue = $derived(controller.selectedCue);
	const activeRouteShareKey = $derived(controller.activeRouteShareKey);
	const activeRouteShareError = $derived(controller.activeRouteShareError);
	const activeRouteShareUrl = $derived(controller.activeRouteShareUrl);
	const isActiveRouteShareCopied = $derived(controller.isActiveRouteShareCopied);
	const activeRoundCourseTarget = $derived(controller.activeRoundCourseTarget);
	const activeRouteClimbs = $derived(controller.activeRouteClimbs);
	const activeRouteGradientMetrics = $derived(controller.activeRouteGradientMetrics);
	const activeRouteGradientGeoJson = $derived(controller.activeRouteGradientGeoJson);
	const canShowGradientOverlay = $derived(controller.canShowGradientOverlay);
	const activeRouteWindGeoJson = $derived(controller.activeRouteWindGeoJson);
	const canShowWindOverlay = $derived(controller.canShowWindOverlay);
	const activeWindSummary = $derived(controller.activeWindSummary);
	const strongestWindSegments = $derived(controller.strongestWindSegments);
	const activeCategorizedClimbs = $derived(controller.activeCategorizedClimbs);
	const activeKeyClimbs = $derived(controller.activeKeyClimbs);
	const hardestClimb = $derived(controller.hardestClimb);
	const routeOverlays = $derived(controller.routeOverlays);
	const constraintOverlay = $derived(controller.constraintOverlay);
	const avoidanceOverlay = $derived(controller.avoidanceOverlay);
	const activeRouteSegmentCount = $derived(controller.activeRouteSegmentCount);
	const sanitizedLockedSegmentIndexes = $derived(controller.sanitizedLockedSegmentIndexes);
	const lockedSegmentOverlay = $derived(controller.lockedSegmentOverlay);
	const combinedRouteBounds = $derived(controller.combinedRouteBounds);
	const surfaceMix = $derived(controller.surfaceMix);
	const activeWarnings = $derived(controller.activeWarnings);
	const activeReadinessWarnings = $derived(controller.activeReadinessWarnings);
	const activeProviderWarnings = $derived(controller.activeProviderWarnings);
	const primaryActiveWarning = $derived(controller.primaryActiveWarning);
	const activeImportedRouteSource = $derived(controller.activeImportedRouteSource);
	const alternativeInfoMessage = $derived(controller.alternativeInfoMessage);
	const elevationSamples = $derived(controller.elevationSamples);
	const chartH = $derived(controller.chartH);
	const elevMin = $derived(controller.elevMin);
	const elevMax = $derived(controller.elevMax);
	const elevRange = $derived(controller.elevRange);
	const sampledProfileDistanceTotal = $derived(controller.sampledProfileDistanceTotal);
	const chartProfilePoints = $derived(controller.chartProfilePoints);
	const activeProfilePoint = $derived(controller.activeProfilePoint);
	const highlightedRouteCoordinate = $derived(controller.highlightedRouteCoordinate);
	const linePoints = $derived(controller.linePoints);
	const areaD = $derived(controller.areaD);
	const distanceTickLabels = $derived(controller.distanceTickLabels);
	const canUndoRouteEdit = $derived(controller.canUndoRouteEdit);
	const canRedoRouteEdit = $derived(controller.canRedoRouteEdit);
	const hasAdvancedErrors = $derived(controller.hasAdvancedErrors);
	const getWarningContainerClass: RoutePlannerPageController["getWarningContainerClass"] = (...args) => controller.getWarningContainerClass(...args);
	const getWarningBadgeClass: RoutePlannerPageController["getWarningBadgeClass"] = (...args) => controller.getWarningBadgeClass(...args);
	const showCurrentLocationOnMap: RoutePlannerPageController["showCurrentLocationOnMap"] = (...args) => controller.showCurrentLocationOnMap(...args);
	const recenterActiveRoute: RoutePlannerPageController["recenterActiveRoute"] = (...args) => controller.recenterActiveRoute(...args);
	const selectCue: RoutePlannerPageController["selectCue"] = (...args) => controller.selectCue(...args);
	const getWindSegmentDistanceRange: RoutePlannerPageController["getWindSegmentDistanceRange"] = (...args) => controller.getWindSegmentDistanceRange(...args);
	const formatCueSegmentTime: RoutePlannerPageController["formatCueSegmentTime"] = (...args) => controller.formatCueSegmentTime(...args);
	const getDestinationFieldLabel: RoutePlannerPageController["getDestinationFieldLabel"] = (...args) => controller.getDestinationFieldLabel(...args);
	const getDestinationSuggestionsLabel: RoutePlannerPageController["getDestinationSuggestionsLabel"] = (...args) => controller.getDestinationSuggestionsLabel(...args);
	const getDestinationPlaceholder: RoutePlannerPageController["getDestinationPlaceholder"] = (...args) => controller.getDestinationPlaceholder(...args);
	const getCurrentLocationDestinationLabel: RoutePlannerPageController["getCurrentLocationDestinationLabel"] = (...args) => controller.getCurrentLocationDestinationLabel(...args);
	const getSubmitButtonText: RoutePlannerPageController["getSubmitButtonText"] = (...args) => controller.getSubmitButtonText(...args);
	const resetSpatialConstraintDefaults: RoutePlannerPageController["resetSpatialConstraintDefaults"] = (...args) => controller.resetSpatialConstraintDefaults(...args);
	const syncStopsFromRoute: RoutePlannerPageController["syncStopsFromRoute"] = (...args) => controller.syncStopsFromRoute(...args);
	const syncActiveRouteManualEditing: RoutePlannerPageController["syncActiveRouteManualEditing"] = (...args) => controller.syncActiveRouteManualEditing(...args);
	const setRouteAlternativesState: RoutePlannerPageController["setRouteAlternativesState"] = (...args) => controller.setRouteAlternativesState(...args);
	const setSingleRouteState: RoutePlannerPageController["setSingleRouteState"] = (...args) => controller.setSingleRouteState(...args);
	const selectRouteAlternative: RoutePlannerPageController["selectRouteAlternative"] = (...args) => controller.selectRouteAlternative(...args);
	const markPlannerEdited: RoutePlannerPageController["markPlannerEdited"] = (...args) => controller.markPlannerEdited(...args);
	const cancelAutosaveTimer: RoutePlannerPageController["cancelAutosaveTimer"] = (...args) => controller.cancelAutosaveTimer(...args);
	const getActiveRouteForSaving: RoutePlannerPageController["getActiveRouteForSaving"] = (...args) => controller.getActiveRouteForSaving(...args);
	const saveActiveRouteDraft: RoutePlannerPageController["saveActiveRouteDraft"] = (...args) => controller.saveActiveRouteDraft(...args);
	const scheduleActiveRouteAutosave: RoutePlannerPageController["scheduleActiveRouteAutosave"] = (...args) => controller.scheduleActiveRouteAutosave(...args);
	const captureRouteEditSnapshot: RoutePlannerPageController["captureRouteEditSnapshot"] = (...args) => controller.captureRouteEditSnapshot(...args);
	const performRouteEdit: RoutePlannerPageController["performRouteEdit"] = (...args) => controller.performRouteEdit(...args);
	const performAsyncRouteEdit: RoutePlannerPageController["performAsyncRouteEdit"] = (...args) => controller.performAsyncRouteEdit(...args);
	const undoRouteEdit: RoutePlannerPageController["undoRouteEdit"] = (...args) => controller.undoRouteEdit(...args);
	const redoRouteEdit: RoutePlannerPageController["redoRouteEdit"] = (...args) => controller.redoRouteEdit(...args);
	const clearRouteEditHistory: RoutePlannerPageController["clearRouteEditHistory"] = (...args) => controller.clearRouteEditHistory(...args);
	const setPlannerMode: RoutePlannerPageController["setPlannerMode"] = (...args) => controller.setPlannerMode(...args);
	const restorePendingSavedRoute: RoutePlannerPageController["restorePendingSavedRoute"] = (...args) => controller.restorePendingSavedRoute(...args);
	const restoreSavedRoute: RoutePlannerPageController["restoreSavedRoute"] = (...args) => controller.restoreSavedRoute(...args);
	const updateRoundCourseTargetKind: RoutePlannerPageController["updateRoundCourseTargetKind"] = (...args) => controller.updateRoundCourseTargetKind(...args);
	const updateRoundCourseDistanceInput: RoutePlannerPageController["updateRoundCourseDistanceInput"] = (...args) => controller.updateRoundCourseDistanceInput(...args);
	const updateRoundCourseDuration: RoutePlannerPageController["updateRoundCourseDuration"] = (...args) => controller.updateRoundCourseDuration(...args);
	const updateRoundCourseAscend: RoutePlannerPageController["updateRoundCourseAscend"] = (...args) => controller.updateRoundCourseAscend(...args);
	const updateSpatialConstraintKind: RoutePlannerPageController["updateSpatialConstraintKind"] = (...args) => controller.updateSpatialConstraintKind(...args);
	const updateSpatialConstraintEnforcement: RoutePlannerPageController["updateSpatialConstraintEnforcement"] = (...args) => controller.updateSpatialConstraintEnforcement(...args);
	const setConstraintCenterStop: RoutePlannerPageController["setConstraintCenterStop"] = (...args) => controller.setConstraintCenterStop(...args);
	const updateConstraintCenterInput: RoutePlannerPageController["updateConstraintCenterInput"] = (...args) => controller.updateConstraintCenterInput(...args);
	const updateAreaRadiusInput: RoutePlannerPageController["updateAreaRadiusInput"] = (...args) => controller.updateAreaRadiusInput(...args);
	const updateCorridorWidthInput: RoutePlannerPageController["updateCorridorWidthInput"] = (...args) => controller.updateCorridorWidthInput(...args);
	const handleChartPointerDown: RoutePlannerPageController["handleChartPointerDown"] = (...args) => controller.handleChartPointerDown(...args);
	const handleChartPointerMove: RoutePlannerPageController["handleChartPointerMove"] = (...args) => controller.handleChartPointerMove(...args);
	const handleChartPointerLeave: RoutePlannerPageController["handleChartPointerLeave"] = (...args) => controller.handleChartPointerLeave(...args);
	const releaseChartScrub: RoutePlannerPageController["releaseChartScrub"] = (...args) => controller.releaseChartScrub(...args);
	const handleChartLostPointerCapture: RoutePlannerPageController["handleChartLostPointerCapture"] = (...args) => controller.handleChartLostPointerCapture(...args);
	const closeCompletionMenu: RoutePlannerPageController["closeCompletionMenu"] = (...args) => controller.closeCompletionMenu(...args);
	const setFieldStop: RoutePlannerPageController["setFieldStop"] = (...args) => controller.setFieldStop(...args);
	const setWaypointStop: RoutePlannerPageController["setWaypointStop"] = (...args) => controller.setWaypointStop(...args);
	const handleFieldInput: RoutePlannerPageController["handleFieldInput"] = (...args) => controller.handleFieldInput(...args);
	const updateField: RoutePlannerPageController["updateField"] = (...args) => controller.updateField(...args);
	const getWaypointError: RoutePlannerPageController["getWaypointError"] = (...args) => controller.getWaypointError(...args);
	const clearWaypointError: RoutePlannerPageController["clearWaypointError"] = (...args) => controller.clearWaypointError(...args);
	const updateWaypoint: RoutePlannerPageController["updateWaypoint"] = (...args) => controller.updateWaypoint(...args);
	const handleWaypointInput: RoutePlannerPageController["handleWaypointInput"] = (...args) => controller.handleWaypointInput(...args);
	const addWaypoint: RoutePlannerPageController["addWaypoint"] = (...args) => controller.addWaypoint(...args);
	const removeWaypoint: RoutePlannerPageController["removeWaypoint"] = (...args) => controller.removeWaypoint(...args);
	const canMoveWaypoint: RoutePlannerPageController["canMoveWaypoint"] = (...args) => controller.canMoveWaypoint(...args);
	const moveWaypoint: RoutePlannerPageController["moveWaypoint"] = (...args) => controller.moveWaypoint(...args);
	const closeMapClickMenu: RoutePlannerPageController["closeMapClickMenu"] = (...args) => controller.closeMapClickMenu(...args);
	const handleMapClick: RoutePlannerPageController["handleMapClick"] = (...args) => controller.handleMapClick(...args);
	const getMapClickMenuTitle: RoutePlannerPageController["getMapClickMenuTitle"] = (...args) => controller.getMapClickMenuTitle(...args);
	const getMapClickMenuSubtitle: RoutePlannerPageController["getMapClickMenuSubtitle"] = (...args) => controller.getMapClickMenuSubtitle(...args);
	const getRemoveActionLabel: RoutePlannerPageController["getRemoveActionLabel"] = (...args) => controller.getRemoveActionLabel(...args);
	const removeSelectedMapStop: RoutePlannerPageController["removeSelectedMapStop"] = (...args) => controller.removeSelectedMapStop(...args);
	const getSelectedSegmentIndex: RoutePlannerPageController["getSelectedSegmentIndex"] = (...args) => controller.getSelectedSegmentIndex(...args);
	const isMapSelectionSegmentLocked: RoutePlannerPageController["isMapSelectionSegmentLocked"] = (...args) => controller.isMapSelectionSegmentLocked(...args);
	const toggleMapSelectionSegmentLock: RoutePlannerPageController["toggleMapSelectionSegmentLock"] = (...args) => controller.toggleMapSelectionSegmentLock(...args);
	const getAvoidanceForSelection: RoutePlannerPageController["getAvoidanceForSelection"] = (...args) => controller.getAvoidanceForSelection(...args);
	const isMapSelectionRoadAvoided: RoutePlannerPageController["isMapSelectionRoadAvoided"] = (...args) => controller.isMapSelectionRoadAvoided(...args);
	const toggleMapSelectionRoadAvoidance: RoutePlannerPageController["toggleMapSelectionRoadAvoidance"] = (...args) => controller.toggleMapSelectionRoadAvoidance(...args);
	const removeAvoidedRoad: RoutePlannerPageController["removeAvoidedRoad"] = (...args) => controller.removeAvoidedRoad(...args);
	const getMapWaypointInsertionSegmentIndex: RoutePlannerPageController["getMapWaypointInsertionSegmentIndex"] = (...args) => controller.getMapWaypointInsertionSegmentIndex(...args);
	const isMapWaypointInsertionLocked: RoutePlannerPageController["isMapWaypointInsertionLocked"] = (...args) => controller.isMapWaypointInsertionLocked(...args);
	const applyMapPointAsStop: RoutePlannerPageController["applyMapPointAsStop"] = (...args) => controller.applyMapPointAsStop(...args);
	const requestRouteCalculation: RoutePlannerPageController["requestRouteCalculation"] = (...args) => controller.requestRouteCalculation(...args);
	const rerouteAfterManualEdit: RoutePlannerPageController["rerouteAfterManualEdit"] = (...args) => controller.rerouteAfterManualEdit(...args);
	const isLockedStopIndex: RoutePlannerPageController["isLockedStopIndex"] = (...args) => controller.isLockedStopIndex(...args);
	const handleRouteStopDragEnd: RoutePlannerPageController["handleRouteStopDragEnd"] = (...args) => controller.handleRouteStopDragEnd(...args);
	const handleRouteSegmentDragEnd: RoutePlannerPageController["handleRouteSegmentDragEnd"] = (...args) => controller.handleRouteSegmentDragEnd(...args);
	const useCurrentLocationAsStop: RoutePlannerPageController["useCurrentLocationAsStop"] = (...args) => controller.useCurrentLocationAsStop(...args);
	const handleGenerateRoute: RoutePlannerPageController["handleGenerateRoute"] = (...args) => controller.handleGenerateRoute(...args);
	const handleSaveDraft: RoutePlannerPageController["handleSaveDraft"] = (...args) => controller.handleSaveDraft(...args);
	const handleShareActiveRoute: RoutePlannerPageController["handleShareActiveRoute"] = (...args) => controller.handleShareActiveRoute(...args);
	const handleExportGpx: RoutePlannerPageController["handleExportGpx"] = (...args) => controller.handleExportGpx(...args);
	const handleExportFit: RoutePlannerPageController["handleExportFit"] = (...args) => controller.handleExportFit(...args);
	const openGpxImportPicker: RoutePlannerPageController["openGpxImportPicker"] = (...args) => controller.openGpxImportPicker(...args);
	const chooseBasemap: RoutePlannerPageController["chooseBasemap"] = (...args) => controller.chooseBasemap(...args);
	const handleGpxImportSelection: RoutePlannerPageController["handleGpxImportSelection"] = (...args) => controller.handleGpxImportSelection(...args);
</script>

			<div
				class="pointer-events-auto absolute inset-x-3 bottom-3 flex max-h-[min(52dvh,28rem)] max-w-none flex-col gap-3 overflow-y-auto md:static md:ml-0 md:mt-4 md:w-full md:max-w-[340px] md:overflow-visible"
			>
				<form
					class="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg"
					novalidate
					onsubmit={handleGenerateRoute}
				>
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-base font-semibold tracking-tight md:text-lg">Route Builder</h2>
					</div>

					<div class="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-secondary/15 p-1">
						{#each plannerModeOptions as option}
							<Button
								type="button"
								variant={plannerMode === option.mode ? "secondary" : "ghost"}
								size="sm"
								class={`h-auto min-w-0 whitespace-normal flex-col items-start justify-start gap-0.5 rounded-md px-3 py-2 text-left ${
									plannerMode === option.mode
										? "border-primary/20 bg-background shadow-sm"
										: "text-muted-foreground"
								}`}
								aria-pressed={plannerMode === option.mode}
								onclick={() => setPlannerMode(option.mode)}
							>
								<span class="text-xs font-semibold uppercase tracking-wide">
									{option.label}
								</span>
								<span class="text-[11px] leading-relaxed opacity-80">
									{option.description}
								</span>
							</Button>
						{/each}
					</div>

					<div class="flex min-w-0 flex-1 flex-col gap-3">
						<PlannerStopInput
							id="start-point"
							label="Start"
							value={startStop.label}
							placeholder="Enter starting point..."
							target={startCompletionTarget}
							controller={completionController}
							completionLabel="Start suggestions"
							error={fieldErrors.startQuery}
							inputClass="border-none bg-secondary/20 pl-9 pr-10 focus-visible:ring-1 focus-visible:ring-primary/50"
							onInput={(value) => handleFieldInput("startQuery", value)}
						>
							{#snippet leading()}
								<MapPin class="size-4 text-muted-foreground" />
							{/snippet}
							{#snippet trailing()}
								<Button
									variant="ghost"
									size="icon-xs"
									type="button"
									class="size-7 text-muted-foreground hover:text-foreground"
									disabled={isLocating}
									aria-label="Use current location as start"
									onclick={() => useCurrentLocationAsStop("startQuery")}
								>
									<LocateFixed class="size-3.5" />
								</Button>
							{/snippet}
						</PlannerStopInput>

						{#if isRoundCourseMode}
							{#if roundCourseTargetKind === "distance"}
								<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
									<div class="space-y-2">
										<label
											for="round-course-distance"
											class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
										>
											Target distance
										</label>
										<div class="relative">
											<Input
												id="round-course-distance"
												type="number"
												min={formatDistanceInputAttribute(minRoundCourseDistanceMeters)}
												step="0.5"
												inputmode="decimal"
												value={roundCourseDistanceInput}
												placeholder="e.g. 60"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={fieldErrors.roundCourseTarget ? "true" : undefined}
												oninput={(event) =>
													updateRoundCourseDistanceInput(
														(event.currentTarget as HTMLInputElement).value,
													)}
											/>
											<span
												class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												{getDistanceUnitLabel()}
											</span>
										</div>
									</div>
									{#if fieldErrors.roundCourseTarget}
										<p class="text-xs font-medium text-destructive">
											{fieldErrors.roundCourseTarget}
										</p>
									{/if}
								</div>
							{/if}
						{:else}
							{#if advancedOpen && !isRoundCourseMode}
							<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
								<div class="flex items-center justify-between gap-3">
									<div>
										<div class="text-xs font-semibold uppercase tracking-wide text-foreground/80">
											Waypoints
										</div>
									</div>
									<Button
										variant="ghost"
										size="sm"
										type="button"
										class="gap-1"
										disabled={waypointStops.length >= maxWaypoints}
										onclick={() => addWaypoint()}
									>
										<Plus class="size-3.5" />
										Add waypoint
									</Button>
								</div>

								{#if waypointStops.length > 0}
									<div class="space-y-2">
										{#each waypointStops as waypointStop, index (`waypoint-${index}`)}
											<div class="rounded-md border border-border/50 bg-background/80 p-2.5">
												<div class="flex items-start gap-2">
													<div class="flex h-9 w-7 shrink-0 items-center justify-center">
														<span
															class="flex size-6 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
														>
															{index + 1}
														</span>
													</div>
													<div class="min-w-0 flex-1 space-y-2">
														<label
															for={`waypoint-${index}`}
															class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
														>
															Waypoint {index + 1}
														</label>
														<PlannerStopInput
															id={`waypoint-${index}`}
															label={`Waypoint ${index + 1}`}
															value={waypointStop.label}
															placeholder="Add a stop..."
															target={getWaypointCompletionTarget(index)}
															controller={completionController}
															completionLabel={`Waypoint ${index + 1} suggestions`}
															error={getWaypointError(index)}
															inputClass="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
															onInput={(value) => handleWaypointInput(index, value)}
														>
															{#snippet leading()}
																<MapPin class="size-4 text-amber-600 dark:text-amber-300" />
															{/snippet}
														</PlannerStopInput>
													</div>
												</div>
												<div class="mt-2 flex flex-wrap justify-end gap-1.5">
													<Button
														variant="outline"
														size="sm"
														type="button"
														class="gap-1"
														disabled={!canMoveWaypoint(index, -1)}
														onclick={() => moveWaypoint(index, -1)}
													>
														<ArrowUp class="size-3.5" />
														Move up
													</Button>
													<Button
														variant="outline"
														size="sm"
														type="button"
														class="gap-1"
														disabled={!canMoveWaypoint(index, 1)}
														onclick={() => moveWaypoint(index, 1)}
													>
														<ArrowDown class="size-3.5" />
														Move down
													</Button>
													<Button
														variant="ghost"
														size="sm"
														type="button"
														class="gap-1 text-muted-foreground hover:text-foreground"
														disabled={isLockedStopIndex(index + 1)}
														onclick={() => removeWaypoint(index)}
													>
														<X class="size-3.5" />
														Remove
													</Button>
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<p class="rounded-md bg-background/60 px-3 py-2 text-xs text-muted-foreground">
										No waypoints yet. Add one to force the route through intermediate stops.
									</p>
								{/if}
							</div>
							{/if}

							<PlannerStopInput
								id="destination"
								label={getDestinationFieldLabel()}
								value={destinationStop.label}
								placeholder={getDestinationPlaceholder()}
								target={destinationCompletionTarget}
								controller={completionController}
								completionLabel={getDestinationSuggestionsLabel()}
								error={fieldErrors.destinationQuery}
								inputClass="border-none bg-secondary/20 pl-9 pr-10 focus-visible:ring-1 focus-visible:ring-primary/50"
								onInput={(value) => handleFieldInput("destinationQuery", value)}
							>
								{#snippet leading()}
									<Navigation class="size-4 text-primary" />
								{/snippet}
								{#snippet trailing()}
									<Button
										variant="ghost"
										size="icon-xs"
										type="button"
										class="size-7 text-muted-foreground hover:text-foreground"
										disabled={isLocating}
										aria-label={getCurrentLocationDestinationLabel()}
										onclick={() => useCurrentLocationAsStop("destinationQuery")}
									>
										<LocateFixed class="size-3.5" />
									</Button>
								{/snippet}
							</PlannerStopInput>
						{/if}
					</div>

					<Button
						type="button"
						variant="ghost"
						class="justify-between rounded-lg border border-border/60 px-3 font-semibold"
						aria-expanded={advancedOpen}
						aria-controls="route-builder-advanced"
						onclick={() => (controller.advancedOpen = !advancedOpen)}
					>
						Advanced
						{#if advancedOpen}
							<ChevronUp class="size-4 opacity-70" />
						{:else}
							<ChevronDown class="size-4 opacity-70" />
						{/if}
					</Button>

					{#if advancedOpen}
					<div id="route-builder-advanced" class="space-y-3">
						{#if isRoundCourseMode}
							<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
								<div class="space-y-1">
									<div class="block text-xs font-semibold uppercase tracking-wide text-foreground/80">
										Round-course target
									</div>
									<div class="grid grid-cols-3 gap-2">
										{#each [
											{ kind: "distance", label: "Distance" },
											{ kind: "duration", label: "Time" },
											{ kind: "ascend", label: "Climb" },
										] as option}
											<Button
												type="button"
												variant="outline"
												class={`h-auto min-w-0 justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
													roundCourseTargetKind === option.kind
														? "border-primary/20 bg-background shadow-sm"
														: "text-muted-foreground"
												}`}
												aria-pressed={roundCourseTargetKind === option.kind}
												onclick={() =>
													updateRoundCourseTargetKind(option.kind as RoundCourseTargetKind)}
											>
												{option.label}
											</Button>
										{/each}
									</div>
								</div>

								{#if roundCourseTargetKind === "duration"}
									<div class="space-y-2">
										<label
											for="round-course-time"
											class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
										>
											Target time
										</label>
										<div class="relative">
											<Input
												id="round-course-time"
												value={roundCourseDurationInput}
												placeholder="e.g. 3:30"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={fieldErrors.roundCourseTarget ? "true" : undefined}
												oninput={(event) =>
													updateRoundCourseDuration(
														(event.currentTarget as HTMLInputElement).value,
													)}
											/>
											<span
												class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												h
											</span>
										</div>
									</div>
								{:else if roundCourseTargetKind === "ascend"}
									<div class="space-y-2">
										<label
											for="round-course-climb"
											class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
										>
											Target climb
										</label>
										<div class="relative">
											<Input
												id="round-course-climb"
												type="number"
												min="50"
												step="50"
												inputmode="decimal"
												value={roundCourseAscendMeters}
												placeholder="e.g. 800"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={fieldErrors.roundCourseTarget ? "true" : undefined}
												oninput={(event) =>
													updateRoundCourseAscend(
														(event.currentTarget as HTMLInputElement).value,
													)}
											/>
											<span
												class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
											>
												m
											</span>
										</div>
									</div>
								{/if}

								<p class="text-xs text-muted-foreground">
									Distance targets search around the requested loop distance; time
									and climb targets search nearby loop distances for the closest match.
								</p>
								{#if roundCourseTargetKind !== "distance" && fieldErrors.roundCourseTarget}
									<p class="text-xs font-medium text-destructive">
										{fieldErrors.roundCourseTarget}
									</p>
								{/if}
							</div>
						{/if}

						<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
						<div class="space-y-1">
							<div class="text-xs font-semibold uppercase tracking-wide text-foreground/80">
								Route bounds
							</div>
							<div class="grid grid-cols-3 gap-2">
								{#each [
									{ kind: "none", label: "None" },
									{ kind: "area", label: "Area" },
									{ kind: "corridor", label: "Corridor" },
								] as option}
									<Button
										type="button"
										variant="outline"
										class={`h-auto min-w-0 justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
											spatialConstraintKind === option.kind
												? "border-primary/20 bg-background shadow-sm"
												: "text-muted-foreground"
										}`}
										aria-pressed={spatialConstraintKind === option.kind}
										disabled={isRoundCourseMode && option.kind === "corridor"}
										onclick={() =>
											updateSpatialConstraintKind(option.kind as SpatialConstraintKind)}
									>
										{option.label}
									</Button>
								{/each}
							</div>
						</div>

						{#if spatialConstraintKind !== "none"}
							<div class="grid grid-cols-2 gap-2">
								{#each [
									{ enforcement: "strict", label: "Keep inside" },
									{ enforcement: "preferred", label: "Prefer inside" },
								] as option}
									<Button
										type="button"
										variant="outline"
										class={`h-auto min-w-0 justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
											spatialConstraintEnforcement === option.enforcement
												? "border-primary/20 bg-background shadow-sm"
												: "text-muted-foreground"
										}`}
										aria-pressed={spatialConstraintEnforcement === option.enforcement}
										onclick={() =>
											updateSpatialConstraintEnforcement(
												option.enforcement as SpatialConstraintEnforcement,
											)}
									>
										{option.label}
									</Button>
								{/each}
							</div>
						{/if}

						{#if spatialConstraintKind === "area"}
							<div class="space-y-2">
								<PlannerStopInput
									id="constraint-center"
									label="Area center"
									value={constraintCenterStop.label}
									placeholder="Enter area center..."
									target={constraintCenterCompletionTarget}
									controller={completionController}
									completionLabel="Area center suggestions"
									error=""
									inputClass="border-none bg-background pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
									onInput={updateConstraintCenterInput}
								>
									{#snippet leading()}
										<MapPin class="size-4 text-sky-600 dark:text-sky-300" />
									{/snippet}
								</PlannerStopInput>
								<label
									for="area-radius"
									class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
								>
									Radius
								</label>
								<div class="relative">
										<Input
											id="area-radius"
											type="number"
											min={formatDistanceInputAttribute(minAreaRadiusMeters)}
											max={formatDistanceInputAttribute(maxAreaRadiusMeters)}
											step={formatDistanceInputAttribute(areaRadiusStepMeters)}
											inputmode="decimal"
											value={areaRadiusInput}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={fieldErrors.spatialConstraint ? "true" : undefined}
										oninput={(event) =>
											updateAreaRadiusInput(
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									<span
										class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
									>
										{getDistanceUnitLabel()}
									</span>
								</div>
							</div>
						{:else if spatialConstraintKind === "corridor"}
							<div class="space-y-2">
								<label
									for="corridor-width"
									class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
								>
									Width
								</label>
								<div class="relative">
										<Input
											id="corridor-width"
											type="number"
											min={formatDistanceInputAttribute(minCorridorWidthMeters)}
											max={formatDistanceInputAttribute(maxCorridorWidthMeters)}
											step={formatDistanceInputAttribute(corridorWidthStepMeters)}
											inputmode="decimal"
											value={corridorWidthInput}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={fieldErrors.spatialConstraint ? "true" : undefined}
										oninput={(event) =>
											updateCorridorWidthInput(
												(event.currentTarget as HTMLInputElement).value,
											)}
									/>
									<span
										class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
									>
										{getDistanceUnitLabel()}
									</span>
								</div>
							</div>
						{/if}

						{#if fieldErrors.spatialConstraint}
							<p class="text-xs font-medium text-destructive">
								{fieldErrors.spatialConstraint}
							</p>
						{/if}
					</div>

					<Separator class="my-0.5" />

					<div class="space-y-2.5">
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs font-semibold text-foreground/80">
								Optimization strategy
							</span>
							<Badge
								variant="secondary"
								class="h-5 shrink-0 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
							>
								Lower traffic bias
							</Badge>
						</div>

						<div class="flex flex-wrap gap-1.5">
							<Badge
								variant="outline"
								class="h-6 border-border/50 bg-secondary/30 px-2 text-[10px] font-medium"
							>
								Avoid ferries
							</Badge>
							<Badge
								variant="outline"
								class="h-6 border-border/50 bg-secondary/30 px-2 text-[10px] font-medium"
							>
								Penalize rough surface
							</Badge>
							<Badge
								variant="outline"
								class="h-6 border-border/50 bg-secondary/30 px-2 text-[10px] font-medium"
							>
								Avoid busy roads when possible
							</Badge>
						</div>
					</div>
					</div>
					{/if}

					{#if routeRequestError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{routeRequestError}
						</div>
					{/if}

					{#if routeImportError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{routeImportError}
						</div>
					{/if}

					{#if currentLocationError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{currentLocationError}
						</div>
					{/if}

					{#if activeWarnings.length > 0 && primaryActiveWarning}
						<div
							class={`rounded-lg border px-3 py-2 text-sm ${getWarningContainerClass(primaryActiveWarning)}`}
							role="status"
						>
							<div class="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide opacity-75">
								<AlertTriangle class="size-3.5" />
								Route readiness
							</div>
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<span class="font-semibold">{primaryActiveWarning.title}</span>
								{#if primaryActiveWarning.metricLabel && primaryActiveWarning.metricValue}
									<span
										class={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${getWarningBadgeClass(primaryActiveWarning)}`}
									>
										{primaryActiveWarning.metricLabel}: {primaryActiveWarning.metricValue}
									</span>
								{/if}
							</div>
							<p class="mt-0.5 text-xs opacity-85">{primaryActiveWarning.message}</p>
						</div>
					{/if}

					<Button size="lg" type="submit" class="mt-1 w-full font-semibold shadow-sm">
						{getSubmitButtonText()}
					</Button>
				</form>
			</div>
