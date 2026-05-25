<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import { isImportedRoute } from "$lib/route-planning";
	import { chartW } from "$lib/route-planner/constants";
	import {
		formatDistance,
		formatDistanceValue,
		getDistanceUnitLabel,
	} from "$lib/unit-settings.svelte";
	import {
		formatElevation,
		formatExactDistance,
		formatGrade,
		formatRoundCourseTarget,
		formatSpatialConstraintEnforcement,
		formatSpatialConstraintSummary,
		formatWindBucket,
		formatWindComponent,
		formatWindSpeed,
		getClimbColor,
		getClimbLabel,
		getImportedRouteStopSummary,
		getRouteDurationText,
		getRoutingBadgeLabel,
		getRoutingProfileLabel,
	} from "$lib/route-planner/formatters";
	import type { PlannerAnalysisController, PlannerFormController, PlannerImportExportController, PlannerOverlayController, PlannerRoutesController, PlannerSaveController, PlannerSharingController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronUp, CircleDot, CornerDownLeft, CornerDownRight, Flag, MountainSnow, Navigation, Redo2, Route, Share2, ShieldCheck, Shuffle, TrendingDown, TrendingUp, Undo2, Wind, X } from "@lucide/svelte";


	let { form, routes, analysis, overlay, save, sharing, importExport }: { form: PlannerFormController; routes: PlannerRoutesController; analysis: PlannerAnalysisController; overlay: PlannerOverlayController; save: PlannerSaveController; sharing: PlannerSharingController; importExport: PlannerImportExportController } = $props();
	const directionsOpen = $derived(analysis.directionsOpen);
	const routeAnalysisOpen = $derived(analysis.routeAnalysisOpen);
	const gradientOverlayEnabled = $derived(overlay.gradientOverlayEnabled);
	const windOverlayEnabled = $derived(overlay.windOverlayEnabled);
	const plannerMode = $derived(form.plannerMode);
	const startStop = $derived(form.startStop);
	const waypointStops = $derived(form.waypointStops);
	const destinationStop = $derived(form.destinationStop);
	const roundCourseTargetKind = $derived(form.roundCourseTargetKind);
	const roundCourseDistanceInput = $derived(form.roundCourseDistanceInput);
	const roundCourseDistanceMetersInput = $derived(form.roundCourseDistanceMetersInput);
	const roundCourseDurationInput = $derived(form.roundCourseDurationInput);
	const roundCourseAscendMeters = $derived(form.roundCourseAscendMeters);
	const spatialConstraintKind = $derived(form.spatialConstraintKind);
	const spatialConstraintEnforcement = $derived(form.spatialConstraintEnforcement);
	const constraintCenterStop = $derived(form.constraintCenterStop);
	const areaRadiusInput = $derived(form.areaRadiusInput);
	const corridorWidthInput = $derived(form.corridorWidthInput);
	const areaRadiusMetersInput = $derived(form.areaRadiusMetersInput);
	const corridorWidthMetersInput = $derived(form.corridorWidthMetersInput);
	const formattedInputDistanceUnit = $derived(form.formattedInputDistanceUnit);
	const routeRequestError = $derived(routes.routeRequestError);
	const routeImportError = $derived(importExport.routeImportError);
	const fieldErrors = $derived(form.fieldErrors);
	const isRouting = $derived(routes.isRouting);
	const isImportingGpx = $derived(importExport.isImportingGpx);
	const routeAlternatives = $derived(routes.routeAlternatives);
	const selectedRouteIndex = $derived(routes.selectedRouteIndex);
	const routeNeedsRecalculation = $derived(routes.routeNeedsRecalculation);
	const lockedSegmentIndexes = $derived(routes.lockedSegmentIndexes);
	const avoidedRoads = $derived(routes.avoidedRoads);
	const lastGeneratedRouteCount = $derived(routes.lastGeneratedRouteCount);
	const routeExportError = $derived(importExport.routeExportError);
	const routeShareErrors = $derived(sharing.routeShareErrors);
	const routeShareUrls = $derived(sharing.routeShareUrls);
	const isSharingRoute = $derived(sharing.isSharingRoute);
	const activeRouteShareCopied = $derived(sharing.activeRouteShareCopied);
	const saveSyncError = $derived(save.saveSyncError);
	const activeSavedRouteId = $derived(save.activeSavedRouteId);
	const plannerDraftRouteId = $derived(save.plannerDraftRouteId);
	const isActiveRouteSaved = $derived(save.isActiveRouteSaved);
	const pendingSavedRouteId = $derived(save.pendingSavedRouteId);
	const activeProfileIndex = $derived(analysis.activeProfileIndex);
	const chartScrubPointerId = $derived(analysis.chartScrubPointerId);
	const fitInitialSavedRouteBounds = $derived(routes.fitInitialSavedRouteBounds);
	const gpxImportInput = $derived(importExport.gpxImportInput);
	const undoStack = $derived(routes.undoStack);
	const redoStack = $derived(routes.redoStack);
	const advancedOpen = $derived(form.advancedOpen);
	const completionController = $derived(form.completionController);
	const selectedCueIndex = $derived(analysis.selectedCueIndex);
	const selectedCueFocusKey = $derived(analysis.selectedCueFocusKey);
	const lastCueRouteKey = $derived(analysis.lastCueRouteKey);
	const isRoundCourseMode = $derived(form.isRoundCourseMode);
	const isOutAndBackMode = $derived(form.isOutAndBackMode);
	const activeRoute = $derived(routes.activeRoute);
	const activeDirections = $derived(routes.activeDirections);
	const activeTurnCount = $derived(routes.activeTurnCount);
	const selectedCue = $derived(analysis.selectedCue);
	const activeRouteShareKey = $derived(sharing.activeRouteShareKey);
	const activeRouteShareError = $derived(sharing.activeRouteShareError);
	const activeRouteShareUrl = $derived(sharing.activeRouteShareUrl);
	const isActiveRouteShareCopied = $derived(sharing.isActiveRouteShareCopied);
	const activeRoundCourseTarget = $derived(routes.activeRoundCourseTarget);
	const activeRouteClimbs = $derived(analysis.activeRouteClimbs);
	const activeRouteGradientMetrics = $derived(analysis.activeRouteGradientMetrics);
	const activeRouteGradientGeoJson = $derived(overlay.activeRouteGradientGeoJson);
	const canShowGradientOverlay = $derived(overlay.canShowGradientOverlay);
	const activeRouteWindGeoJson = $derived(overlay.activeRouteWindGeoJson);
	const canShowWindOverlay = $derived(overlay.canShowWindOverlay);
	const activeWindSummary = $derived(analysis.activeWindSummary);
	const strongestWindSegments = $derived(analysis.strongestWindSegments);
	const activeCategorizedClimbs = $derived(analysis.activeCategorizedClimbs);
	const activeKeyClimbs = $derived(analysis.activeKeyClimbs);
	const hardestClimb = $derived(analysis.hardestClimb);
	const routeOverlays = $derived(overlay.routeOverlays);
	const constraintOverlay = $derived(overlay.constraintOverlay);
	const avoidanceOverlay = $derived(overlay.avoidanceOverlay);
	const activeRouteSegmentCount = $derived(overlay.activeRouteSegmentCount);
	const sanitizedLockedSegmentIndexes = $derived(overlay.sanitizedLockedSegmentIndexes);
	const lockedSegmentOverlay = $derived(overlay.lockedSegmentOverlay);
	const combinedRouteBounds = $derived(overlay.combinedRouteBounds);
	const surfaceMix = $derived(analysis.surfaceMix);
	const activeWarnings = $derived(analysis.activeWarnings);
	const activeReadinessWarnings = $derived(analysis.activeReadinessWarnings);
	const activeProviderWarnings = $derived(analysis.activeProviderWarnings);
	const primaryActiveWarning = $derived(analysis.primaryActiveWarning);
	const activeImportedRouteSource = $derived(routes.activeImportedRouteSource);
	const alternativeInfoMessage = $derived(routes.alternativeInfoMessage);
	const elevationSamples = $derived(analysis.elevationSamples);
	const chartH = $derived(analysis.chartH);
	const elevMin = $derived(analysis.elevMin);
	const elevMax = $derived(analysis.elevMax);
	const elevRange = $derived(analysis.elevRange);
	const sampledProfileDistanceTotal = $derived(analysis.sampledProfileDistanceTotal);
	const chartProfilePoints = $derived(analysis.chartProfilePoints);
	const activeProfilePoint = $derived(analysis.activeProfilePoint);
	const highlightedRouteCoordinate = $derived(overlay.highlightedRouteCoordinate);
	const linePoints = $derived(analysis.linePoints);
	const areaD = $derived(analysis.areaD);
	const distanceTickLabels = $derived(analysis.distanceTickLabels);
	const canUndoRouteEdit = $derived(routes.canUndoRouteEdit);
	const canRedoRouteEdit = $derived(routes.canRedoRouteEdit);
	const hasAdvancedErrors = $derived(form.hasAdvancedErrors);
	const routeActionsDisabled = $derived(routeNeedsRecalculation || isRouting);
</script>

{#snippet routeSummarySkeleton()}
	<div
		class="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3"
		role="status"
		aria-live="polite"
		aria-label={form.getSubmitButtonText()}
	>
		<span class="sr-only">
			{isRoundCourseMode
				? "Calculating the round course..."
				: isOutAndBackMode
					? "Calculating the out-and-back route..."
					: "Calculating the road-bike route..."}
		</span>
		<Skeleton class="h-7 w-24 rounded-md" />
		<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-20 rounded-md" />
		<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-20 rounded-md" />
		<span class="hidden text-border md:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-24 rounded-md" />
	</div>
{/snippet}

		<div class="pointer-events-auto relative w-full shrink-0">
			<div
				class="rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm md:p-3.5"
			>
				<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					{#if isRouting}
						{@render routeSummarySkeleton()}
					{:else if activeRoute}
						<div
							class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums sm:text-sm"
						>
							<span class="font-semibold text-foreground">
								<span class="font-heading text-base sm:text-lg">
									{formatDistanceValue(activeRoute.distanceMeters)}
								</span>
								{getDistanceUnitLabel()}
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1">
								<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
								<span class="font-semibold text-foreground">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(activeRoute.ascendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1 text-sky-600 dark:text-sky-400">
								<TrendingDown class="size-3.5 shrink-0 opacity-80" />
								<span class="font-semibold">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(activeRoute.descendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">
								{activeRouteClimbs.length} climb{activeRouteClimbs.length === 1 ? "" : "s"}
								{#if activeCategorizedClimbs.length > 0}
									<span class="text-muted-foreground">
										({activeCategorizedClimbs.length} categorized)
									</span>
								{/if}
							</span>
							{#if activeRouteGradientMetrics && activeRouteGradientMetrics.averageGradientPercent !== null}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									Avg {formatGrade(activeRouteGradientMetrics.averageGradientPercent)}
								</span>
							{/if}
							{#if activeRouteGradientMetrics && activeRouteGradientMetrics.maximumGradientPercent !== null}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									Max {formatGrade(activeRouteGradientMetrics.maximumGradientPercent)}
								</span>
							{/if}
							{#if activeWindSummary}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="flex items-center gap-1 font-semibold text-foreground">
									<Wind class="size-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
									{#if activeWindSummary.averageHeadwindKmh < 0}
										Tailwind {formatWindSpeed(activeWindSummary.averageTailwindKmh)}
									{:else}
										Avg headwind {formatWindSpeed(activeWindSummary.averageHeadwindKmh)}
									{/if}
								</span>
							{/if}
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">{getRouteDurationText(activeRoute)}</span>
							{#if activeDirections.length > 0}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									{activeTurnCount} turn{activeTurnCount === 1 ? "" : "s"}
								</span>
							{/if}
						</div>
					{:else}
						<div class="flex min-w-0 flex-col gap-1">
							<span class="text-sm font-semibold text-foreground">
								{isRoundCourseMode
										? "Generate a round course to see live distance, climbing, and elevation."
										: isOutAndBackMode
											? "Generate an out-and-back route to see live distance, climbing, and elevation."
										: "Generate a route to see live distance, climbing, and elevation."}
							</span>
							<span class="text-xs text-muted-foreground">
								{isRoundCourseMode
										? "The map overlay and summary will update once a loop route is found."
										: isOutAndBackMode
											? "The map overlay and summary will update once the outbound leg is mirrored."
										: "The map overlay and summary will update once a route is found."}
							</span>
						</div>
					{/if}

					<div class="flex shrink-0 flex-col items-end gap-1.5">
						<div class="flex flex-wrap items-center justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								class="gap-1.5 font-semibold"
								disabled={isImportingGpx}
								onclick={importExport.openGpxImportPicker}
							>
								{#if isImportingGpx}
									<Skeleton class="size-3 rounded-full" />
								{/if}
								{isImportingGpx ? "Importing GPX..." : "Import GPX"}
							</Button>
							{#if activeRoute}
								<div class="flex items-center gap-1">
									<Button
										variant="outline"
										size="icon"
										class="size-8"
										type="button"
										disabled={!canUndoRouteEdit}
										aria-label="Undo route edit"
										onclick={routes.undoRouteEdit}
									>
										<Undo2 class="size-3.5" />
									</Button>
									<Button
										variant="outline"
										size="icon"
										class="size-8"
										type="button"
										disabled={!canRedoRouteEdit}
										aria-label="Redo route edit"
										onclick={routes.redoRouteEdit}
									>
										<Redo2 class="size-3.5" />
									</Button>
								</div>
								<Button
									variant={isActiveRouteSaved ? "secondary" : "outline"}
									size="sm"
									class="gap-1 font-semibold"
									disabled={routeActionsDisabled}
									onclick={save.handleSaveDraft}
								>
									{#if isActiveRouteSaved}
										<Check class="size-3.5" />
										Saved
									{:else}
										Save Draft
									{/if}
								</Button>
								<Button
									size="sm"
									class="font-semibold"
									disabled={routeActionsDisabled}
									onclick={importExport.handleExportGpx}
								>
									Export GPX
								</Button>
								<Button
									size="sm"
									variant="outline"
									class="font-semibold"
									disabled={routeActionsDisabled}
									onclick={importExport.handleExportFit}
								>
									Export FIT
								</Button>
								<Button
									size="sm"
									variant="outline"
									class="gap-1 font-semibold"
									disabled={routeActionsDisabled || isSharingRoute}
									onclick={sharing.handleShareActiveRoute}
								>
									<Share2 class="size-3.5" />
									{isSharingRoute ? "Sharing..." : isActiveRouteShareCopied ? "Copied" : "Share"}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (analysis.directionsOpen = !directionsOpen)}
									aria-expanded={directionsOpen}
									aria-controls="route-directions-panel"
								>
									Directions
									<Badge
										variant="secondary"
										class="h-5 px-1.5 text-[10px] font-semibold"
									>
										{activeTurnCount}
									</Badge>
									{#if directionsOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (analysis.routeAnalysisOpen = !routeAnalysisOpen)}
									aria-expanded={routeAnalysisOpen}
									aria-controls="route-analysis-panel"
								>
									{routeAnalysisOpen ? "Less" : "Analysis"}
									{#if routeAnalysisOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
							{/if}
						</div>
					</div>
				</div>

				{#if activeRoute && routeNeedsRecalculation}
					<div
						class="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-950 dark:text-amber-100"
						role="status"
					>
						Route needs recalculation. Generate Route to update save, export, and share actions.
					</div>
				{/if}

				{#if activeRoute && routeExportError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{routeExportError}
					</div>
				{/if}

				{#if activeRoute && activeRouteShareError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{activeRouteShareError}
						{#if activeRouteShareUrl}
							<input
								class="mt-2 w-full rounded-md border border-destructive/20 bg-background px-2 py-1 font-mono text-xs text-foreground"
								readonly
								value={activeRouteShareUrl}
								aria-label="Share link"
								onfocus={(event) => event.currentTarget.select()}
							/>
						{/if}
					</div>
				{/if}

				{#if saveSyncError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{saveSyncError}
					</div>
				{/if}

				{#if activeRoute && activeImportedRouteSource}
					<div
						class="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-sm text-sky-900 dark:text-sky-100"
						role="status"
					>
						<div class="font-semibold">Imported GPX</div>
						<div>{activeImportedRouteSource.filename}</div>
						<div>{getImportedRouteStopSummary(activeRoute)}</div>
						<div>Edit stops, then Generate Route to recalculate.</div>
					</div>
				{/if}

				{#if activeRoute && avoidedRoads.length > 0}
					<div class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
						<div class="mb-2 flex items-center justify-between gap-3">
							<div class="text-xs font-semibold uppercase tracking-wide text-destructive">
								{avoidedRoads.length} avoided
							</div>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each avoidedRoads as avoidance, index (`avoidance-${index}`)}
								<div class="flex items-center gap-1 rounded-md border border-destructive/20 bg-background/80 px-2 py-1 text-xs font-medium text-foreground">
									<span>{avoidance.label}</span>
									<Button
										variant="ghost"
										size="icon"
										class="size-6 text-muted-foreground hover:text-destructive"
										type="button"
										disabled={isRouting}
										aria-label={`Remove ${avoidance.label}`}
										onclick={() => routes.removeAvoidedRoad(index)}
									>
										<X class="size-3.5" />
									</Button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if activeRoute && routeAlternatives.length > 1}
					<div class="mt-3 rounded-lg border border-border/50 bg-secondary/10 p-3">
						<div class="mb-2 flex items-center justify-between gap-3">
							<div class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
								Alternatives
							</div>
							<div class="text-xs text-muted-foreground">
								Select the route you want to inspect, save, or export.
							</div>
						</div>
						<div class="grid gap-2 md:grid-cols-3">
							{#each routeAlternatives as route, index (`alternative-${index}`)}
								<button
									type="button"
									class={`rounded-lg border p-3 text-left transition-colors ${
										index === selectedRouteIndex
											? "border-primary/40 bg-background shadow-sm"
											: "border-border/50 bg-background/70 hover:border-border hover:bg-background"
									}`}
									aria-pressed={index === selectedRouteIndex}
									onclick={() => routes.selectRouteAlternative(index)}
								>
									<div class="mb-2 flex items-center justify-between gap-2">
										<div class="text-sm font-semibold text-foreground">
											Route {index + 1}
										</div>
										<div class="flex flex-wrap justify-end gap-1">
											{#if index === 0}
												<Badge
													variant="secondary"
													class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
												>
													Recommended
												</Badge>
											{/if}
											{#if index === selectedRouteIndex}
												<Badge
													variant="secondary"
													class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
												>
													Selected
												</Badge>
											{/if}
											{#if route.mode === "round_course"}
												<Badge
													variant="outline"
													class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
												>
													Round course
												</Badge>
											{/if}
											{#if route.mode === "out_and_back"}
												<Badge
													variant="outline"
													class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
												>
													Out and back
												</Badge>
											{/if}
										</div>
									</div>
									<div class="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
										<div>
											<div class="font-semibold text-foreground">
												{formatDistance(route.distanceMeters)}
											</div>
											<div>Distance</div>
										</div>
										<div>
											<div class="font-semibold text-foreground">
												{getRouteDurationText(route)}
											</div>
											<div>Duration</div>
										</div>
										<div>
											<div class="font-semibold text-foreground">
												{Math.round(route.ascendMeters).toLocaleString()} m
											</div>
											<div>Climb</div>
										</div>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if activeRoute && alternativeInfoMessage}
					<div
						class="mt-3 rounded-lg border border-border/50 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground"
						role="status"
					>
						{alternativeInfoMessage}
					</div>
				{/if}

				{#if activeRoute}
				<div class="mt-2.5 min-w-0 rounded-md border border-border/40 bg-secondary/10">
					{#if activeRoute}
						<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-3 py-2">
							<div class="flex min-w-0 flex-wrap items-center gap-2">
								<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
									{activeRoute.startLabel}
								</span>
								{#if activeRoute.mode === "round_course"}
									<Badge
										variant="secondary"
										class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
									>
										Round course
									</Badge>
									<span class="text-xs text-muted-foreground">Returns to start</span>
								{:else if activeRoute.mode === "out_and_back"}
									<Badge
										variant="secondary"
										class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
									>
										Out and back
									</Badge>
									<span class="text-xs text-muted-foreground">
										to {activeRoute.destinationLabel} and back
									</span>
								{:else}
									<span class="text-xs text-muted-foreground">
										to {activeRoute.destinationLabel}
									</span>
								{/if}
								{#if activeRoute.spatialConstraint}
									<Badge
										variant="outline"
										class="h-5 border-sky-500/25 bg-sky-500/8 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200"
									>
										{formatSpatialConstraintSummary(activeRoute)}
									</Badge>
									<Badge
										variant="outline"
										class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
									>
										{formatSpatialConstraintEnforcement(
											activeRoute.spatialConstraint.enforcement,
										)}
									</Badge>
								{/if}
							</div>
							{#if activeRoute.mode === "round_course" && activeRoundCourseTarget}
								<span class="text-xs text-muted-foreground">
									Target {formatRoundCourseTarget(activeRoundCourseTarget)}
								</span>
							{/if}
						</div>
					{/if}
					<div
						class="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-1.5"
					>
						<div
							class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/75"
						>
							<TrendingUp class="size-3 shrink-0" />
							Elevation
						</div>
						{#if elevationSamples.length > 0}
							<div
								class="flex min-w-0 flex-nowrap items-center justify-end gap-x-2 overflow-x-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground"
							>
								{#if activeProfilePoint}
									<span class="font-semibold text-foreground">
										At {formatExactDistance(activeProfilePoint.distanceMeters)}
									</span>
									<span class="font-semibold text-foreground">
										{formatElevation(activeProfilePoint.elevationMeters)}
									</span>
									<span class="text-border">|</span>
								{/if}
								<span>min {formatElevation(elevMin)}</span>
								<span class="text-border">|</span>
								<span>max {formatElevation(elevMax)}</span>
								<span class="text-border">|</span>
								<span>delta {formatElevation(elevMax - elevMin)}</span>
								{#if activeRouteGradientMetrics && activeRouteGradientMetrics.averageGradientPercent !== null}
									<span class="text-border">|</span>
									<span>avg {formatGrade(activeRouteGradientMetrics.averageGradientPercent)}</span>
								{/if}
								{#if activeRouteGradientMetrics && activeRouteGradientMetrics.maximumGradientPercent !== null}
									<span class="text-border">|</span>
									<span>max {formatGrade(activeRouteGradientMetrics.maximumGradientPercent)}</span>
								{/if}
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">No route profile yet</span>
						{/if}
					</div>
					<div class="px-2 pb-1.5 pt-1">
						{#if elevationSamples.length > 0}
							<svg
								class="block w-full touch-none"
								height={chartH}
								viewBox="0 0 {chartW} {chartH}"
								preserveAspectRatio="none"
								role="img"
								aria-label="Elevation along route"
								onpointerdown={analysis.handleChartPointerDown}
								onpointermove={analysis.handleChartPointerMove}
								onpointerleave={analysis.handleChartPointerLeave}
								onpointerup={analysis.releaseChartScrub}
								onpointercancel={analysis.releaseChartScrub}
								onlostpointercapture={analysis.handleChartLostPointerCapture}
							>
								<defs>
									<linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="rgb(16 185 129)" stop-opacity="0.35" />
										<stop offset="100%" stop-color="rgb(16 185 129)" stop-opacity="0.02" />
									</linearGradient>
								</defs>
								{#each [0.25, 0.5, 0.75] as gridLine}
									<line
										x1="0"
										y1={gridLine * chartH}
										x2={chartW}
										y2={gridLine * chartH}
										stroke="currentColor"
										class="text-border/40"
										stroke-width="1"
										vector-effect="non-scaling-stroke"
									/>
								{/each}
								{#each activeRouteClimbs as climb}
									<rect
										x={(climb.startDistanceMeters / Math.max(sampledProfileDistanceTotal ?? 1, 1)) * chartW}
										y="0"
										width={Math.max(
											1.5,
											((climb.endDistanceMeters - climb.startDistanceMeters) /
												Math.max(sampledProfileDistanceTotal ?? 1, 1)) *
												chartW,
										)}
										height={chartH}
										fill={getClimbColor(climb)}
										opacity={climb.isKeyClimb ? "0.24" : "0.13"}
									/>
								{/each}
								<path d={areaD} fill="url(#elevFill)" class="text-emerald-500" />
								{#if activeProfilePoint}
									<line
										x1={activeProfilePoint.x}
										y1="0"
										x2={activeProfilePoint.x}
										y2={chartH}
										stroke="rgb(16 185 129 / 0.45)"
										stroke-width="1.5"
										stroke-dasharray="3 4"
										vector-effect="non-scaling-stroke"
									/>
								{/if}
								<polyline
									fill="none"
									stroke="rgb(16 185 129)"
									stroke-width="2.5"
									stroke-linejoin="round"
									stroke-linecap="round"
									points={linePoints}
									vector-effect="non-scaling-stroke"
								/>
								{#if activeProfilePoint}
									<circle
										cx={activeProfilePoint.x}
										cy={activeProfilePoint.y}
										r="5.75"
										fill="rgba(16, 185, 129, 0.22)"
									/>
									<circle
										cx={activeProfilePoint.x}
										cy={activeProfilePoint.y}
										r="3.5"
										fill="rgb(16 185 129)"
										stroke="rgba(255, 255, 255, 0.96)"
										stroke-width="2"
									/>
								{/if}
								<rect
									x="0"
									y="0"
									width={chartW}
									height={chartH}
									fill="transparent"
									pointer-events="all"
								/>
							</svg>
							<div
								class="flex justify-between px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
							>
								<span>Start</span>
								<span class="hidden min-[480px]:inline">{distanceTickLabels[0]}</span>
								<span class="hidden min-[640px]:inline">{distanceTickLabels[1]}</span>
								<span class="hidden min-[900px]:inline">{distanceTickLabels[2]}</span>
								<span>{distanceTickLabels[3]}</span>
							</div>
						{:else}
							<div class="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
								Elevation and route profile will appear here after a route is generated.
							</div>
						{/if}
					</div>
					{#if activeRoute && elevationSamples.length > 0}
						<div class="border-t border-border/30 px-3 py-2">
							{#if activeRouteClimbs.length > 0}
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<span class="font-semibold text-foreground">
										{activeRouteClimbs.length} detected climb{activeRouteClimbs.length === 1 ? "" : "s"}
									</span>
									<span>{activeCategorizedClimbs.length} categorized</span>
									<span>{activeKeyClimbs.length} key highlighted</span>
									{#if hardestClimb}
										<span class="font-semibold text-foreground">
											Hardest: {hardestClimb.category}, {formatElevation(hardestClimb.elevationGainMeters)} over {formatDistance(hardestClimb.distanceMeters)} at {formatGrade(hardestClimb.averageGradePercent)}
										</span>
									{/if}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">
									No climbs meet the 500 m, 30 m gain, and 3% average grade threshold.
								</p>
							{/if}
						</div>
					{:else if activeRoute}
						<div class="border-t border-border/30 px-3 py-2 text-xs text-muted-foreground">
							No climb data available because this route has no elevation samples.
						</div>
					{/if}
				</div>
				{/if}

				{#if directionsOpen && activeRoute}
					<div
						id="route-directions-panel"
						class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-2"
					>
						<div class="flex items-center justify-between gap-2 px-1 pb-2">
							<div class="flex min-w-0 items-center gap-2">
								<Navigation class="size-3.5 shrink-0 text-primary" />
								<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
									Directions
								</span>
							</div>
							<span class="text-xs text-muted-foreground">
								{activeDirections.length} cue{activeDirections.length === 1 ? "" : "s"}
							</span>
						</div>

						{#if activeDirections.length > 0}
							<div class="space-y-1">
								{#each activeDirections as cue, index (`cue-${index}-${cue.coordinateIndex}-${cue.sign}`)}
									<button
										type="button"
										class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
											selectedCueIndex === index
												? "border-primary/35 bg-primary/10 text-foreground"
												: "border-transparent bg-background/60 text-foreground hover:border-border/70 hover:bg-background"
										}`}
										aria-pressed={selectedCueIndex === index}
										onclick={() => analysis.selectCue(index)}
									>
										<span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
											{#if cue.type === "left" || cue.type === "slight_left" || cue.type === "sharp_left" || cue.type === "keep_left"}
												<CornerDownLeft class="size-4" />
											{:else if cue.type === "right" || cue.type === "slight_right" || cue.type === "sharp_right" || cue.type === "keep_right"}
												<CornerDownRight class="size-4" />
											{:else if cue.type === "u_turn"}
												<Shuffle class="size-4" />
											{:else if cue.type === "roundabout" || cue.type === "leave_roundabout"}
												<CircleDot class="size-4" />
											{:else if cue.type === "finish"}
												<Flag class="size-4" />
											{:else if cue.sign < 0}
												<ArrowLeft class="size-4" />
											{:else if cue.sign > 0}
												<ArrowRight class="size-4" />
											{:else}
												<ArrowUp class="size-4" />
											{/if}
										</span>
										<span class="min-w-0">
											<span class="block text-xs font-semibold text-muted-foreground">
												{formatExactDistance(cue.distanceFromStartMeters)}
											</span>
											<span class="block truncate text-sm font-semibold">
												{cue.text}
											</span>
										</span>
										<span class="text-right text-xs tabular-nums text-muted-foreground">
											<span class="block">{formatDistance(cue.segmentDistanceMeters)}</span>
											<span class="block">{analysis.formatCueSegmentTime(cue.segmentTimeMs)}</span>
										</span>
									</button>
								{/each}
							</div>
						{:else}
							<div class="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border/60 bg-background/50 px-3 text-center text-sm text-muted-foreground">
								No directions available for this route
							</div>
						{/if}
					</div>
				{/if}

				{#if routeAnalysisOpen && activeRoute}
					<div
						id="route-analysis-panel"
						class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-3 md:max-h-[min(42vh,26rem)] md:p-3.5"
					>
						<div class="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
							<div class="flex flex-col gap-3">
								<div class="flex items-start justify-between gap-2">
									<div class="flex min-w-0 items-center gap-2">
										<ShieldCheck
											class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
										/>
										<span
											class="text-xs font-semibold uppercase tracking-wide text-foreground/75"
										>
											Ride quality
										</span>
									</div>
									<Badge
										variant="secondary"
										class="h-5 shrink-0 px-2 text-[10px] font-semibold"
									>
										{getRoutingBadgeLabel(activeRoute)}
									</Badge>
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<AlertTriangle class="size-3" /> Readiness
										</span>
									</div>
									{#if activeReadinessWarnings.length > 0}
										<div class="grid gap-1.5">
											{#each activeReadinessWarnings as warning}
												<div
													class={`rounded-md border px-2.5 py-2 text-xs ${analysis.getWarningContainerClass(warning)}`}
												>
													<div class="mb-1 flex items-center justify-between gap-2">
														<span class="font-semibold">{warning.title}</span>
														{#if warning.metricLabel && warning.metricValue}
															<span
																class={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${analysis.getWarningBadgeClass(warning)}`}
															>
																{warning.metricLabel}: {warning.metricValue}
															</span>
														{/if}
													</div>
													<div class="opacity-85">{warning.message}</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											No readiness warnings from available route data.
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<Route class="size-3" /> Surface mix
										</span>
									</div>
									{#if surfaceMix.length > 0}
										<div class="flex h-2 overflow-hidden rounded-full bg-secondary">
											{#each surfaceMix as surface}
												<div
													class="{surface.className} opacity-90"
													style="width: {surface.pct}%"
													title="{surface.label}: {surface.pct}%"
												></div>
											{/each}
										</div>
										<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
											{#each surfaceMix as surface}
												<span class="flex items-center gap-1">
													<span class="size-1.5 rounded-full {surface.className}"></span>
													{surface.label} ({surface.pct}%)
												</span>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											{isImportedRoute(activeRoute)
												? "Surface analysis becomes available after re-routing this imported track."
												: "Surface details were not available for this route."}
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<Wind class="size-3" /> Wind
										</span>
										{#if activeWindSummary}
											<span>{activeWindSummary.forecastTime}</span>
										{/if}
									</div>
									{#if activeWindSummary}
										<div class="grid gap-1.5 text-xs">
											<div class="grid grid-cols-2 gap-1.5">
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Average</div>
													<div class="font-semibold text-foreground">
														{activeWindSummary.averageHeadwindKmh < 0
															? `${formatWindSpeed(activeWindSummary.averageTailwindKmh)} tailwind`
															: `${formatWindSpeed(activeWindSummary.averageHeadwindKmh)} headwind`}
													</div>
												</div>
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Max crosswind</div>
													<div class="font-semibold text-foreground">
														{formatWindSpeed(activeWindSummary.maxCrosswindKmh)}
													</div>
												</div>
											</div>
											<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
												<span>Headwind {formatDistance(activeWindSummary.headwindDistanceMeters)}</span>
												<span>Crosswind {formatDistance(activeWindSummary.crosswindDistanceMeters)}</span>
												<span>Tailwind {formatDistance(activeWindSummary.tailwindDistanceMeters)}</span>
												<span>Max headwind {formatWindSpeed(activeWindSummary.maxHeadwindKmh)}</span>
											</div>
											{#if strongestWindSegments.length > 0}
												<div class="grid gap-1.5">
													{#each strongestWindSegments as segment}
														<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
															<div class="mb-1 flex items-center justify-between gap-2">
																<span class="font-semibold text-foreground">
																	{formatWindBucket(segment.bucket)}
																</span>
																<span class="text-muted-foreground">
																	{formatWindSpeed(segment.speedKmh)}
																</span>
															</div>
															<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
																<span>{analysis.getWindSegmentDistanceRange(activeRoute, segment)}</span>
																<span>{formatWindComponent(segment.headwindComponentKmh)}</span>
																<span>{formatWindSpeed(Math.abs(segment.crosswindComponentKmh))} cross</span>
															</div>
														</div>
													{/each}
												</div>
											{/if}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											{isImportedRoute(activeRoute)
												? "Wind analysis becomes available after re-routing this imported track."
												: "Wind analysis was not available for this route."}
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<MountainSnow class="size-3" /> Climbs
										</span>
									</div>
									{#if activeRouteClimbs.length > 0}
										<div class="grid gap-1.5">
											{#each activeRouteClimbs as climb, index}
												<div
													class={`rounded-md border px-2.5 py-2 text-xs ${
														climb.isKeyClimb
															? "border-amber-500/25 bg-amber-500/8"
															: "border-border/30 bg-background/60"
													}`}
												>
													<div class="mb-1 flex items-center justify-between gap-2">
														<div class="flex min-w-0 items-center gap-2 font-semibold text-foreground">
															<span
																class="size-2 shrink-0 rounded-full"
																style="background-color: {getClimbColor(climb)}"
															></span>
															<span>{getClimbLabel(climb, index)}</span>
														</div>
														{#if climb.isKeyClimb}
															<Badge
																variant="secondary"
																class="h-5 border-amber-500/20 bg-amber-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200"
															>
																Key
															</Badge>
														{/if}
													</div>
													<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
														<span>{formatDistance(climb.distanceMeters)}</span>
														<span>{formatElevation(climb.elevationGainMeters)} gain</span>
														<span>{formatGrade(climb.averageGradePercent)} avg</span>
														<span>from {formatExactDistance(climb.startDistanceMeters)}</span>
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											No detected climbs for this elevation profile.
										</p>
									{/if}
								</div>
							</div>

							<div class="grid grid-cols-1 gap-2.5 text-xs">
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Resolved start
									</div>
									<div class="font-medium text-foreground">{activeRoute.startLabel}</div>
								</div>
								{#if activeRoute.waypoints.length > 0 && activeRoute.mode !== "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved waypoints
										</div>
										<div class="space-y-1">
											{#each activeRoute.waypoints as waypoint, index}
												<div class="font-medium text-foreground">
													{index + 1}. {waypoint.label}
												</div>
											{/each}
										</div>
									</div>
								{/if}
								{#if activeRoute.mode === "round_course"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Loop finish
										</div>
										<div class="font-medium text-foreground">Returns to {activeRoute.startLabel}</div>
									</div>
									{#if activeRoundCourseTarget}
										<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
											<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
												Requested target
											</div>
											<div class="font-medium text-foreground">
												{formatRoundCourseTarget(activeRoundCourseTarget)}
											</div>
										</div>
									{/if}
								{:else if activeRoute.mode === "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved turnaround
										</div>
										<div class="font-medium text-foreground">{activeRoute.destinationLabel}</div>
									</div>
								{:else}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved destination
										</div>
										<div class="font-medium text-foreground">{activeRoute.destinationLabel}</div>
									</div>
								{/if}
								{#if activeRoute.spatialConstraint}
									<div class="rounded-md border border-sky-500/20 bg-sky-500/8 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-sky-900/70 dark:text-sky-100/70">
											Route bounds
										</div>
										<div class="font-medium text-foreground">
											{formatSpatialConstraintSummary(activeRoute)}
										</div>
										<div class="text-muted-foreground">
											{formatSpatialConstraintEnforcement(
												activeRoute.spatialConstraint.enforcement,
											)}
										</div>
									</div>
								{/if}
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Routing profile
									</div>
									<div class="font-medium text-foreground">
										{getRoutingProfileLabel(activeRoute)}
									</div>
								</div>
								{#if activeProviderWarnings.length > 0}
									<div class="rounded-md border border-amber-500/20 bg-amber-500/8 px-2.5 py-2 text-amber-900 dark:text-amber-100">
										<div class="mb-1 font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-100/70">
											Routing fallback
										</div>
										<div class="space-y-1 font-medium">
											{#each activeProviderWarnings as warning}
												<div>{warning.message}</div>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
