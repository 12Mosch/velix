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
	import type { PlannerAnalysisController, PlannerFormController, PlannerImportExportController, PlannerMapController, PlannerRoutesController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import { getWaypointCompletionTarget } from "$lib/route-planner/page/planner-completion.svelte";
	import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, LocateFixed, MapPin, Navigation, Plus, X } from "@lucide/svelte";


	let { form, routes, map, importExport, analysis }: { form: PlannerFormController; routes: PlannerRoutesController; map: PlannerMapController; importExport: PlannerImportExportController; analysis: PlannerAnalysisController } = $props();
	const directionsOpen = $derived(analysis.directionsOpen);
	const routeAnalysisOpen = $derived(analysis.routeAnalysisOpen);
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
	const lockedSegmentIndexes = $derived(routes.lockedSegmentIndexes);
	const avoidedRoads = $derived(routes.avoidedRoads);
	const lastGeneratedRouteCount = $derived(routes.lastGeneratedRouteCount);
	const routeExportError = $derived(importExport.routeExportError);
	const activeProfileIndex = $derived(analysis.activeProfileIndex);
	const chartScrubPointerId = $derived(analysis.chartScrubPointerId);
	const mapClickSelection = $derived(map.mapClickSelection);
	const isResolvingMapSelection = $derived(map.isResolvingMapSelection);
	const currentLocation = $derived(map.currentLocation);
	const currentLocationFocusKey = $derived(map.currentLocationFocusKey);
	const recenterRouteRequestKey = $derived(map.recenterRouteRequestKey);
	const fitInitialSavedRouteBounds = $derived(routes.fitInitialSavedRouteBounds);
	const isLocating = $derived(map.isLocating);
	const currentLocationError = $derived(map.currentLocationError);
	const gpxImportInput = $derived(importExport.gpxImportInput);
	const undoStack = $derived(routes.undoStack);
	const redoStack = $derived(routes.redoStack);
	const advancedOpen = $derived(form.advancedOpen);
	const completionController = $derived(form.completionController);
	const selectedCueIndex = $derived(analysis.selectedCueIndex);
	const selectedCueFocusKey = $derived(analysis.selectedCueFocusKey);
	const lastCueRouteKey = $derived(analysis.lastCueRouteKey);
	const selectedBasemap = $derived(map.selectedBasemap);
	const availableBasemapOptions = $derived(map.availableBasemapOptions);
	const isRoundCourseMode = $derived(form.isRoundCourseMode);
	const isOutAndBackMode = $derived(form.isOutAndBackMode);
	const activeRoute = $derived(routes.activeRoute);
	const activeDirections = $derived(routes.activeDirections);
	const activeTurnCount = $derived(routes.activeTurnCount);
	const selectedCue = $derived(analysis.selectedCue);
	const activeRoundCourseTarget = $derived(routes.activeRoundCourseTarget);
	const activeRouteClimbs = $derived(analysis.activeRouteClimbs);
	const activeRouteGradientMetrics = $derived(analysis.activeRouteGradientMetrics);
	const activeWindSummary = $derived(analysis.activeWindSummary);
	const strongestWindSegments = $derived(analysis.strongestWindSegments);
	const activeCategorizedClimbs = $derived(analysis.activeCategorizedClimbs);
	const activeKeyClimbs = $derived(analysis.activeKeyClimbs);
	const hardestClimb = $derived(analysis.hardestClimb);
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
	const linePoints = $derived(analysis.linePoints);
	const areaD = $derived(analysis.areaD);
	const distanceTickLabels = $derived(analysis.distanceTickLabels);
	const canUndoRouteEdit = $derived(routes.canUndoRouteEdit);
	const canRedoRouteEdit = $derived(routes.canRedoRouteEdit);
	const hasAdvancedErrors = $derived(form.hasAdvancedErrors);
</script>

			<div
				class="pointer-events-auto absolute inset-x-3 bottom-3 flex max-h-[min(52dvh,28rem)] max-w-none flex-col gap-3 overflow-y-auto md:static md:ml-0 md:mt-4 md:w-full md:max-w-[340px] md:overflow-visible"
			>
				<form
					class="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg"
					novalidate
					onsubmit={routes.handleGenerateRoute}
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
								onclick={() => form.setPlannerMode(option.mode)}
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
							onInput={(value) => form.handleFieldInput("startQuery", value)}
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
									onclick={() => form.useCurrentLocationAsStop("startQuery")}
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
													form.updateRoundCourseDistanceInput(
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
										onclick={() => form.addWaypoint()}
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
															error={form.getWaypointError(index)}
															inputClass="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
															onInput={(value) => form.handleWaypointInput(index, value)}
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
														disabled={!form.canMoveWaypoint(index, -1)}
														onclick={() => form.moveWaypoint(index, -1)}
													>
														<ArrowUp class="size-3.5" />
														Move up
													</Button>
													<Button
														variant="outline"
														size="sm"
														type="button"
														class="gap-1"
														disabled={!form.canMoveWaypoint(index, 1)}
														onclick={() => form.moveWaypoint(index, 1)}
													>
														<ArrowDown class="size-3.5" />
														Move down
													</Button>
													<Button
														variant="ghost"
														size="sm"
														type="button"
														class="gap-1 text-muted-foreground hover:text-foreground"
														disabled={routes.isLockedStopIndex(index + 1)}
														onclick={() => form.removeWaypoint(index)}
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
								label={form.getDestinationFieldLabel()}
								value={destinationStop.label}
								placeholder={form.getDestinationPlaceholder()}
								target={destinationCompletionTarget}
								controller={completionController}
								completionLabel={form.getDestinationSuggestionsLabel()}
								error={fieldErrors.destinationQuery}
								inputClass="border-none bg-secondary/20 pl-9 pr-10 focus-visible:ring-1 focus-visible:ring-primary/50"
								onInput={(value) => form.handleFieldInput("destinationQuery", value)}
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
										aria-label={form.getCurrentLocationDestinationLabel()}
										onclick={() => form.useCurrentLocationAsStop("destinationQuery")}
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
						onclick={() => (form.advancedOpen = !advancedOpen)}
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
													form.updateRoundCourseTargetKind(option.kind as RoundCourseTargetKind)}
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
													form.updateRoundCourseDuration(
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
													form.updateRoundCourseAscend(
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
											form.updateSpatialConstraintKind(option.kind as SpatialConstraintKind)}
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
											form.updateSpatialConstraintEnforcement(
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
									onInput={form.updateConstraintCenterInput}
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
											form.updateAreaRadiusInput(
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
											form.updateCorridorWidthInput(
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
							class={`rounded-lg border px-3 py-2 text-sm ${analysis.getWarningContainerClass(primaryActiveWarning)}`}
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
										class={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${analysis.getWarningBadgeClass(primaryActiveWarning)}`}
									>
										{primaryActiveWarning.metricLabel}: {primaryActiveWarning.metricValue}
									</span>
								{/if}
							</div>
							<p class="mt-0.5 text-xs opacity-85">{primaryActiveWarning.message}</p>
						</div>
					{/if}

					<Button size="lg" type="submit" class="mt-1 w-full font-semibold shadow-sm">
						{form.getSubmitButtonText()}
					</Button>
				</form>
			</div>
