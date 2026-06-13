<!-- biome-ignore-all lint/a11y/useValidAriaValues: Dynamic Svelte ARIA values are computed at runtime. -->
<script lang="ts">
	import ActionTooltip from "$lib/components/route-planner/action-tooltip.svelte";
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
	import {
		formatDistanceInputAttribute,
		formatDuration,
		formatTrainingSessionKind,
	} from "$lib/route-planner/formatters";
	import { formatDistance, getDistanceUnitLabel } from "$lib/unit-settings.svelte";
	import { estimateWorkoutTarget, parseWorkoutPlan } from "$lib/workout-plan";
	import type { SpatialConstraintEnforcement } from "$lib/route-planning";
	import type { RoundCourseTargetKind, SpatialConstraintKind } from "$lib/route-planner/types";
	import type { PlannerAnalysisController, PlannerFormController, PlannerImportExportController, PlannerMapController, PlannerRoutesController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import { getWaypointCompletionTarget } from "$lib/route-planner/page/planner-completion.svelte";
	import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp, LocateFixed, MapPin, Navigation, Plus, X } from "@lucide/svelte";
	import { Effect } from "effect";


	type Props = {
		form: PlannerFormController;
		routes: PlannerRoutesController;
		map: PlannerMapController;
		importExport: PlannerImportExportController;
		analysis: PlannerAnalysisController;
	};

	let { form, routes, map, importExport, analysis }: Props = $props();
	const builderView = $derived.by(() => ({
		plannerMode: form.plannerMode,
		startStop: form.startStop,
		waypointStops: form.waypointStops,
		destinationStop: form.destinationStop,
		roundCourseTargetKind: form.roundCourseTargetKind,
		roundCourseDistanceInput: form.roundCourseDistanceInput,
		roundCourseDurationInput: form.roundCourseDurationInput,
		roundCourseAscendMeters: form.roundCourseAscendMeters,
		workoutPlanInput: form.workoutPlanInput,
		workoutPlanError: form.workoutPlanError,
		spatialConstraintKind: form.spatialConstraintKind,
		spatialConstraintEnforcement: form.spatialConstraintEnforcement,
		constraintCenterStop: form.constraintCenterStop,
		areaRadiusInput: form.areaRadiusInput,
		corridorWidthInput: form.corridorWidthInput,
		routeRequestError: routes.routeRequestError,
		routeImportError: importExport.routeImportError,
		fieldErrors: form.fieldErrors,
		isLocating: map.isLocating,
		currentLocationError: map.currentLocationError,
		advancedOpen: form.advancedOpen,
		completionController: form.completionController,
		isRoundCourseMode: form.isRoundCourseMode,
		activeWarnings: analysis.activeWarnings,
		primaryActiveWarning: analysis.primaryActiveWarning,
	}));
	const workoutPlanPreview = $derived.by(() => {
		const input = builderView.workoutPlanInput.trim();
		if (!input) {
			return null;
		}

		const parsed = parseWorkoutPlan(input);
		return parsed.errors.length === 0 && parsed.totalDurationMs > 0
			? {
					parsed,
					estimate: estimateWorkoutTarget(parsed.expandedSteps),
				}
			: null;
	});
</script>

			<div
				class="pointer-events-auto absolute inset-x-3 top-3 flex max-h-[min(42dvh,24rem)] max-w-none flex-col gap-3 md:static md:ml-0 md:mt-4 md:w-full md:max-h-none md:max-w-[340px]"
			>
				<form
					class="flex max-h-full min-h-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-md md:gap-3 md:overflow-visible md:bg-background md:p-4"
					novalidate
					onsubmit={(event) =>
						void Effect.runPromise(routes.handleGenerateRoute(event))}
				>
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-base font-semibold tracking-tight md:text-lg">Route Builder</h2>
					</div>

					<div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1 md:gap-3 md:overflow-visible md:pr-0">
					<div class="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-secondary/15 p-1">
						{#each plannerModeOptions as option}
							<Button
								type="button"
								variant={builderView.plannerMode === option.mode ? "secondary" : "ghost"}
								size="sm"
								class={`h-9 min-w-0 whitespace-normal flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-center md:h-auto md:items-start md:px-3 md:py-2 md:text-left ${
									builderView.plannerMode === option.mode
										? "border-primary/20 bg-background shadow-sm"
										: "text-muted-foreground"
								}`}
								aria-pressed={builderView.plannerMode === option.mode ? "true" : "false"}
								onclick={() => form.setPlannerMode(option.mode)}
							>
								<span class="text-xs font-semibold uppercase tracking-wide">
									{option.label}
								</span>
								<span class="hidden text-[11px] leading-relaxed opacity-80 md:block">
									{option.description}
								</span>
							</Button>
						{/each}
					</div>

					<div class="flex min-w-0 flex-1 flex-col gap-3">
						<PlannerStopInput
							id="start-point"
							label="Start"
							value={builderView.startStop.label}
							placeholder="Enter starting point..."
							target={startCompletionTarget}
							controller={builderView.completionController}
							completionLabel="Start suggestions"
							error={builderView.fieldErrors.startQuery}
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
									disabled={builderView.isLocating}
									aria-label="Use current location as start"
									onclick={() =>
										void Effect.runPromise(
											form.useCurrentLocationAsStop("startQuery"),
										)}
								>
									<LocateFixed class="size-3.5" />
								</Button>
							{/snippet}
						</PlannerStopInput>

						{#if builderView.isRoundCourseMode}
							<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-2.5 md:p-3">
								<label
									for="workout-plan"
									class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
								>
									Workout plan
								</label>
								<textarea
									id="workout-plan"
									value={builderView.workoutPlanInput}
									placeholder={`10m Z2 HR\n4x\n  5m 90% FTP 90rpm\n  2m Z2\n10m Z2 HR`}
									class="min-h-16 w-full resize-y rounded-md border-none bg-background px-3 py-2 text-sm leading-5 shadow-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-primary/50 md:min-h-24"
									aria-invalid={builderView.workoutPlanError ? "true" : "false"}
									oninput={(event) =>
										form.updateWorkoutPlanInput(
											(event.currentTarget as HTMLTextAreaElement).value,
										)}
								></textarea>
								{#if workoutPlanPreview}
									<div class="flex flex-wrap gap-1.5">
										<Badge
											variant="secondary"
											class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
										>
											{formatDuration(workoutPlanPreview.parsed.totalDurationMs)}
										</Badge>
										<Badge
											variant="outline"
											class="h-5 border-border/50 bg-background px-2 text-[10px] font-medium"
										>
											{workoutPlanPreview.parsed.expandedStepCount} steps
										</Badge>
										<Badge
											variant="outline"
											class="h-5 border-border/50 bg-background px-2 text-[10px] font-medium"
										>
											{formatTrainingSessionKind(workoutPlanPreview.estimate.trainingProfile.sessionKind)}
										</Badge>
										<Badge
											variant="outline"
											class="h-5 border-border/50 bg-background px-2 text-[10px] font-medium"
										>
											{formatDistance(workoutPlanPreview.estimate.distanceMeters)}
										</Badge>
									</div>
								{/if}
								{#if builderView.workoutPlanError}
									<p class="text-xs font-medium text-destructive">
										{builderView.workoutPlanError}
									</p>
								{/if}
							</div>
							{#if builderView.roundCourseTargetKind === "distance"}
								<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-2.5 md:p-3">
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
												value={builderView.roundCourseDistanceInput}
												placeholder="e.g. 60"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={builderView.fieldErrors.roundCourseTarget ? "true" : "false"}
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
									{#if builderView.fieldErrors.roundCourseTarget}
										<p class="text-xs font-medium text-destructive">
											{builderView.fieldErrors.roundCourseTarget}
										</p>
									{/if}
								</div>
							{/if}
						{:else}
							{#if builderView.advancedOpen && !builderView.isRoundCourseMode}
							<div class="space-y-2 rounded-lg border border-dashed border-border/70 bg-secondary/10 p-3">
								<div class="flex items-center justify-between gap-3">
									<div>
										<div class="text-xs font-semibold uppercase tracking-wide text-foreground/80">
											Waypoints
										</div>
									</div>
									<ActionTooltip
										content={builderView.waypointStops.length >= maxWaypoints
											? "Waypoint limit reached"
											: null}
									>
										<Button
											variant="ghost"
											size="sm"
											type="button"
											class="gap-1"
											disabled={builderView.waypointStops.length >= maxWaypoints}
											onclick={() => form.addWaypoint()}
										>
											<Plus class="size-3.5" />
											Add waypoint
										</Button>
									</ActionTooltip>
								</div>

								{#if builderView.waypointStops.length > 0}
									<div class="space-y-2">
										{#each builderView.waypointStops as waypointStop, index (`waypoint-${index}`)}
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
															controller={builderView.completionController}
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
													<ActionTooltip
														content={!form.canMoveWaypoint(index, -1)
															? index === 0
																? "Already first waypoint"
																: "Unlock adjacent segment first"
															: null}
													>
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
													</ActionTooltip>
													<ActionTooltip
														content={!form.canMoveWaypoint(index, 1)
															? index === builderView.waypointStops.length - 1
																? "Already last waypoint"
																: "Unlock adjacent segment first"
															: null}
													>
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
													</ActionTooltip>
													<ActionTooltip
														content={routes.isLockedStopIndex(index + 1)
															? "Unlock adjacent segment first"
															: null}
													>
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
													</ActionTooltip>
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
								value={builderView.destinationStop.label}
								placeholder={form.getDestinationPlaceholder()}
								target={destinationCompletionTarget}
								controller={builderView.completionController}
								completionLabel={form.getDestinationSuggestionsLabel()}
								error={builderView.fieldErrors.destinationQuery}
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
										disabled={builderView.isLocating}
										aria-label={form.getCurrentLocationDestinationLabel()}
										onclick={() =>
											void Effect.runPromise(
												form.useCurrentLocationAsStop("destinationQuery"),
											)}
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
						aria-expanded={builderView.advancedOpen ? "true" : "false"}
						aria-controls="route-builder-advanced"
						onclick={() => (form.advancedOpen = !builderView.advancedOpen)}
					>
						Advanced
						{#if builderView.advancedOpen}
							<ChevronUp class="size-4 opacity-70" />
						{:else}
							<ChevronDown class="size-4 opacity-70" />
						{/if}
					</Button>

					{#if builderView.advancedOpen}
					<div id="route-builder-advanced" class="space-y-3">
						{#if builderView.isRoundCourseMode}
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
													builderView.roundCourseTargetKind === option.kind
														? "border-primary/20 bg-background shadow-sm"
														: "text-muted-foreground"
												}`}
												aria-pressed={builderView.roundCourseTargetKind === option.kind ? "true" : "false"}
												onclick={() =>
													form.updateRoundCourseTargetKind(option.kind as RoundCourseTargetKind)}
											>
												{option.label}
											</Button>
										{/each}
									</div>
								</div>

								{#if builderView.roundCourseTargetKind === "duration"}
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
												value={builderView.roundCourseDurationInput}
												placeholder="e.g. 3:30"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={builderView.fieldErrors.roundCourseTarget ? "true" : "false"}
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
								{:else if builderView.roundCourseTargetKind === "ascend"}
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
												value={builderView.roundCourseAscendMeters}
												placeholder="e.g. 800"
												class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
												aria-invalid={builderView.fieldErrors.roundCourseTarget ? "true" : "false"}
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
								{#if builderView.roundCourseTargetKind !== "distance" && builderView.fieldErrors.roundCourseTarget}
									<p class="text-xs font-medium text-destructive">
										{builderView.fieldErrors.roundCourseTarget}
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
											builderView.spatialConstraintKind === option.kind
												? "border-primary/20 bg-background shadow-sm"
												: "text-muted-foreground"
										}`}
										aria-pressed={builderView.spatialConstraintKind === option.kind ? "true" : "false"}
										disabled={builderView.isRoundCourseMode && option.kind === "corridor"}
										onclick={() =>
											form.updateSpatialConstraintKind(option.kind as SpatialConstraintKind)}
									>
										{option.label}
									</Button>
								{/each}
							</div>
						</div>

						{#if builderView.spatialConstraintKind !== "none"}
							<div class="grid grid-cols-2 gap-2">
								{#each [
									{ enforcement: "strict", label: "Keep inside" },
									{ enforcement: "preferred", label: "Prefer inside" },
								] as option}
									<Button
										type="button"
										variant="outline"
										class={`h-auto min-w-0 justify-center rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
											builderView.spatialConstraintEnforcement === option.enforcement
												? "border-primary/20 bg-background shadow-sm"
												: "text-muted-foreground"
										}`}
										aria-pressed={builderView.spatialConstraintEnforcement === option.enforcement ? "true" : "false"}
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

						{#if builderView.spatialConstraintKind === "area"}
							<div class="space-y-2">
								<PlannerStopInput
									id="constraint-center"
									label="Area center"
									value={builderView.constraintCenterStop.label}
									placeholder="Enter area center..."
									target={constraintCenterCompletionTarget}
									controller={builderView.completionController}
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
											value={builderView.areaRadiusInput}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={builderView.fieldErrors.spatialConstraint ? "true" : "false"}
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
						{:else if builderView.spatialConstraintKind === "corridor"}
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
											value={builderView.corridorWidthInput}
										class="border-none bg-background pl-3 pr-14 focus-visible:ring-1 focus-visible:ring-primary/50"
										aria-invalid={builderView.fieldErrors.spatialConstraint ? "true" : "false"}
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

						{#if builderView.fieldErrors.spatialConstraint}
							<p class="text-xs font-medium text-destructive">
								{builderView.fieldErrors.spatialConstraint}
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

					{#if builderView.routeRequestError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{builderView.routeRequestError}
						</div>
					{/if}

					{#if builderView.routeImportError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{builderView.routeImportError}
						</div>
					{/if}

					{#if builderView.currentLocationError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{builderView.currentLocationError}
						</div>
					{/if}

					{#if builderView.activeWarnings.length > 0 && builderView.primaryActiveWarning}
						<div
							class={`rounded-lg border px-3 py-2 text-sm ${analysis.getWarningContainerClass(builderView.primaryActiveWarning)}`}
							role="status"
						>
							<div class="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide opacity-75">
								<AlertTriangle class="size-3.5" />
								Route readiness
							</div>
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<span class="font-semibold">{builderView.primaryActiveWarning.title}</span>
								{#if builderView.primaryActiveWarning.metricLabel && builderView.primaryActiveWarning.metricValue}
									<span
										class={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${analysis.getWarningBadgeClass(builderView.primaryActiveWarning)}`}
									>
										{builderView.primaryActiveWarning.metricLabel}: {builderView.primaryActiveWarning.metricValue}
									</span>
								{/if}
							</div>
							<p class="mt-0.5 text-xs opacity-85">{builderView.primaryActiveWarning.message}</p>
						</div>
					{/if}
					</div>

					<Button
						size="lg"
						type="submit"
						class="mt-0.5 h-11 w-full shrink-0 font-semibold shadow-sm md:mt-1 md:h-12"
					>
						{form.getSubmitButtonText()}
					</Button>
				</form>
			</div>
