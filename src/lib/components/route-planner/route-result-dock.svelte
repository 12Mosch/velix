<script lang="ts">
	import ActionTooltip from "$lib/components/route-planner/action-tooltip.svelte";
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
		formatQualityBand,
		formatQualityScore,
		formatRoundCourseTarget,
		formatSpatialConstraintEnforcement,
		formatSpatialConstraintSummary,
		formatWindBucket,
		formatWindComponent,
		formatWindSpeed,
		getClimbColor,
		getClimbLabel,
		getImportedRouteStopSummary,
		getQualityToneClass,
		getRouteDurationText,
		getRoutingBadgeLabel,
		getRoutingProfileLabel,
	} from "$lib/route-planner/formatters";
	import type { PlannerAnalysisController, PlannerFormController, PlannerImportExportController, PlannerRoutesController, PlannerSaveController, PlannerSharingController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronUp, CircleDot, CornerDownLeft, CornerDownRight, Flag, MountainSnow, Navigation, Redo2, Route, Share2, ShieldCheck, Shuffle, TrendingDown, TrendingUp, Undo2, Wind, X } from "@lucide/svelte";


	type Props = {
		form: PlannerFormController;
		routes: PlannerRoutesController;
		analysis: PlannerAnalysisController;
		save: PlannerSaveController;
		sharing: PlannerSharingController;
		importExport: PlannerImportExportController;
	};

	let { form, routes, analysis, save, sharing, importExport }: Props = $props();
	const dockView = $derived.by(() => ({
		directionsOpen: analysis.directionsOpen,
		routeAnalysisOpen: analysis.routeAnalysisOpen,
		isRouting: routes.isRouting,
		isImportingGpx: importExport.isImportingGpx,
		routeAlternatives: routes.routeAlternatives,
		selectedRouteIndex: routes.selectedRouteIndex,
		routeNeedsRecalculation: routes.routeNeedsRecalculation,
		avoidedRoads: routes.avoidedRoads,
		routeExportError: importExport.routeExportError,
		isSharingRoute: sharing.isSharingRoute,
		saveSyncError: save.saveSyncError,
		isActiveRouteSaved: save.isActiveRouteSaved,
		selectedCueIndex: analysis.selectedCueIndex,
		isRoundCourseMode: form.isRoundCourseMode,
		isOutAndBackMode: form.isOutAndBackMode,
		activeRoute: routes.activeRoute,
		activeDirections: routes.activeDirections,
		activeTurnCount: routes.activeTurnCount,
		activeRouteShareError: sharing.activeRouteShareError,
		activeRouteShareUrl: sharing.activeRouteShareUrl,
		isActiveRouteShareCopied: sharing.isActiveRouteShareCopied,
		activeRoundCourseTarget: routes.activeRoundCourseTarget,
		activeRouteClimbs: analysis.activeRouteClimbs,
		activeRouteGradientMetrics: analysis.activeRouteGradientMetrics,
		activeRouteQuality: analysis.activeRouteQuality,
		routeAlternativeQualities: analysis.routeAlternativeQualities,
		activeWindSummary: analysis.activeWindSummary,
		strongestWindSegments: analysis.strongestWindSegments,
		activeCategorizedClimbs: analysis.activeCategorizedClimbs,
		activeKeyClimbs: analysis.activeKeyClimbs,
		hardestClimb: analysis.hardestClimb,
		surfaceMix: analysis.surfaceMix,
		activeReadinessWarnings: analysis.activeReadinessWarnings,
		activeProviderWarnings: analysis.activeProviderWarnings,
		activeImportedRouteSource: routes.activeImportedRouteSource,
		alternativeInfoMessage: routes.alternativeInfoMessage,
		elevationSamples: analysis.elevationSamples,
		chartH: analysis.chartH,
		elevMin: analysis.elevMin,
		elevMax: analysis.elevMax,
		sampledProfileDistanceTotal: analysis.sampledProfileDistanceTotal,
		activeProfilePoint: analysis.activeProfilePoint,
		linePoints: analysis.linePoints,
		areaD: analysis.areaD,
		distanceTickLabels: analysis.distanceTickLabels,
		canUndoRouteEdit: routes.canUndoRouteEdit,
		canRedoRouteEdit: routes.canRedoRouteEdit,
		routeActionsDisabled: routes.routeNeedsRecalculation || routes.isRouting,
	}));
	const routeActionDisabledReason = $derived(
		dockView.isRouting ? "Route is generating" : "Recalculate before export",
	);
	const saveDraftDisabledReason = $derived(
		dockView.routeActionsDisabled
			? dockView.isRouting
				? "Route is generating"
				: "Recalculate before saving"
			: null,
	);
	const exportDisabledReason = $derived(
		dockView.routeActionsDisabled ? routeActionDisabledReason : null,
	);
	const shareDisabledReason = $derived(
		dockView.routeActionsDisabled
			? dockView.isRouting
				? "Route is generating"
				: "Recalculate before sharing"
			: dockView.isSharingRoute
				? "Sharing route"
				: null,
	);
</script>

{#snippet routeSummarySkeleton()}
	<div
		class="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3"
		role="status"
		aria-live="polite"
		aria-label={form.getSubmitButtonText()}
	>
		<span class="sr-only">
			{dockView.isRoundCourseMode
				? "Calculating the round course..."
				: dockView.isOutAndBackMode
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
					{#if dockView.isRouting}
						{@render routeSummarySkeleton()}
					{:else if dockView.activeRoute}
						<div
							class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums sm:text-sm"
						>
							<span class="font-semibold text-foreground">
								<span class="font-heading text-base sm:text-lg">
									{formatDistanceValue(dockView.activeRoute.distanceMeters)}
								</span>
								{getDistanceUnitLabel()}
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1">
								<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
								<span class="font-semibold text-foreground">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(dockView.activeRoute.ascendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1 text-sky-600 dark:text-sky-400">
								<TrendingDown class="size-3.5 shrink-0 opacity-80" />
								<span class="font-semibold">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(dockView.activeRoute.descendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">
								{dockView.activeRouteClimbs.length} climb{dockView.activeRouteClimbs.length === 1 ? "" : "s"}
								{#if dockView.activeCategorizedClimbs.length > 0}
									<span class="text-muted-foreground">
										({dockView.activeCategorizedClimbs.length} categorized)
									</span>
								{/if}
							</span>
							{#if dockView.activeRouteGradientMetrics && dockView.activeRouteGradientMetrics.averageGradientPercent !== null}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									Avg {formatGrade(dockView.activeRouteGradientMetrics.averageGradientPercent)}
								</span>
							{/if}
							{#if dockView.activeRouteGradientMetrics && dockView.activeRouteGradientMetrics.maximumGradientPercent !== null}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									Max {formatGrade(dockView.activeRouteGradientMetrics.maximumGradientPercent)}
								</span>
							{/if}
							{#if dockView.activeRouteQuality}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<Badge
									variant="outline"
									class={`h-6 px-2 text-[10px] font-semibold uppercase tracking-wide ${getQualityToneClass(dockView.activeRouteQuality.band)}`}
								>
									Quality {formatQualityScore(dockView.activeRouteQuality.overallScore)}
								</Badge>
							{/if}
							{#if dockView.activeWindSummary}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="flex items-center gap-1 font-semibold text-foreground">
									<Wind class="size-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
									{#if dockView.activeWindSummary.averageHeadwindKmh < 0}
										Tailwind {formatWindSpeed(dockView.activeWindSummary.averageTailwindKmh)}
									{:else}
										Avg headwind {formatWindSpeed(dockView.activeWindSummary.averageHeadwindKmh)}
									{/if}
								</span>
							{/if}
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">{getRouteDurationText(dockView.activeRoute)}</span>
							{#if dockView.activeDirections.length > 0}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									{dockView.activeTurnCount} turn{dockView.activeTurnCount === 1 ? "" : "s"}
								</span>
							{/if}
						</div>
					{:else}
						<div class="flex min-w-0 flex-col gap-1">
							<span class="text-sm font-semibold text-foreground">
								{dockView.isRoundCourseMode
										? "Generate a round course to see live distance, climbing, and elevation."
										: dockView.isOutAndBackMode
											? "Generate an out-and-back route to see live distance, climbing, and elevation."
										: "Generate a route to see live distance, climbing, and elevation."}
							</span>
							<span class="text-xs text-muted-foreground">
								{dockView.isRoundCourseMode
										? "The map overlay and summary will update once a loop route is found."
										: dockView.isOutAndBackMode
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
								disabled={dockView.isImportingGpx}
								onclick={importExport.openGpxImportPicker}
							>
								{#if dockView.isImportingGpx}
									<Skeleton class="size-3 rounded-full" />
								{/if}
								{dockView.isImportingGpx ? "Importing GPX..." : "Import GPX"}
							</Button>
							{#if dockView.activeRoute}
								<div class="flex items-center gap-1">
									<Button
										variant="outline"
										size="icon"
										class="size-8"
										type="button"
										disabled={!dockView.canUndoRouteEdit}
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
										disabled={!dockView.canRedoRouteEdit}
										aria-label="Redo route edit"
										onclick={routes.redoRouteEdit}
									>
										<Redo2 class="size-3.5" />
									</Button>
								</div>
								<ActionTooltip content={saveDraftDisabledReason}>
									<Button
										variant={dockView.isActiveRouteSaved ? "secondary" : "outline"}
										size="sm"
										class="gap-1 font-semibold"
										disabled={dockView.routeActionsDisabled}
										onclick={save.handleSaveDraft}
									>
										{#if dockView.isActiveRouteSaved}
											<Check class="size-3.5" />
											Saved
										{:else}
											Save Draft
										{/if}
									</Button>
								</ActionTooltip>
								<ActionTooltip content={exportDisabledReason}>
									<Button
										size="sm"
										class="font-semibold"
										disabled={dockView.routeActionsDisabled}
										onclick={importExport.handleExportGpx}
									>
										Export GPX
									</Button>
								</ActionTooltip>
								<ActionTooltip content={exportDisabledReason}>
									<Button
										size="sm"
										variant="outline"
										class="font-semibold"
										disabled={dockView.routeActionsDisabled}
										onclick={importExport.handleExportFit}
									>
										Export FIT
									</Button>
								</ActionTooltip>
								<ActionTooltip content={shareDisabledReason}>
									<Button
										size="sm"
										variant="outline"
										class="gap-1 font-semibold"
										disabled={dockView.routeActionsDisabled || dockView.isSharingRoute}
										onclick={sharing.handleShareActiveRoute}
									>
										<Share2 class="size-3.5" />
										{dockView.isSharingRoute ? "Sharing..." : dockView.isActiveRouteShareCopied ? "Copied" : "Share"}
									</Button>
								</ActionTooltip>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (analysis.directionsOpen = !dockView.directionsOpen)}
									aria-expanded={dockView.directionsOpen}
									aria-controls="route-directions-panel"
								>
									Directions
									<Badge
										variant="secondary"
										class="h-5 px-1.5 text-[10px] font-semibold"
									>
										{dockView.activeTurnCount}
									</Badge>
									{#if dockView.directionsOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (analysis.routeAnalysisOpen = !dockView.routeAnalysisOpen)}
									aria-expanded={dockView.routeAnalysisOpen}
									aria-controls="route-analysis-panel"
								>
									{dockView.routeAnalysisOpen ? "Less" : "Analysis"}
									{#if dockView.routeAnalysisOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
							{/if}
						</div>
					</div>
				</div>

				{#if dockView.activeRoute && dockView.routeNeedsRecalculation}
					<div
						class="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-950 dark:text-amber-100"
						role="status"
					>
						Route needs recalculation. Generate Route to update save, export, and share actions.
					</div>
				{/if}

				{#if dockView.activeRoute && dockView.routeExportError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{dockView.routeExportError}
					</div>
				{/if}

				{#if dockView.activeRoute && dockView.activeRouteShareError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{dockView.activeRouteShareError}
						{#if dockView.activeRouteShareUrl}
							<input
								class="mt-2 w-full rounded-md border border-destructive/20 bg-background px-2 py-1 font-mono text-xs text-foreground"
								readonly
								value={dockView.activeRouteShareUrl}
								aria-label="Share link"
								onfocus={(event) => event.currentTarget.select()}
							/>
						{/if}
					</div>
				{/if}

				{#if dockView.saveSyncError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{dockView.saveSyncError}
					</div>
				{/if}

				{#if dockView.activeRoute && dockView.activeImportedRouteSource}
					<div
						class="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-sm text-sky-900 dark:text-sky-100"
						role="status"
					>
						<div class="font-semibold">Imported GPX</div>
						<div>{dockView.activeImportedRouteSource.filename}</div>
						<div>{getImportedRouteStopSummary(dockView.activeRoute)}</div>
						<div>Edit stops, then Generate Route to recalculate.</div>
					</div>
				{/if}

				{#if dockView.activeRoute && dockView.avoidedRoads.length > 0}
					<div class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
						<div class="mb-2 flex items-center justify-between gap-3">
							<div class="text-xs font-semibold uppercase tracking-wide text-destructive">
								{dockView.avoidedRoads.length} avoided
							</div>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each dockView.avoidedRoads as avoidance, index (`avoidance-${index}`)}
								<div class="flex items-center gap-1 rounded-md border border-destructive/20 bg-background/80 px-2 py-1 text-xs font-medium text-foreground">
									<span>{avoidance.label}</span>
									<Button
										variant="ghost"
										size="icon"
										class="size-6 text-muted-foreground hover:text-destructive"
										type="button"
										disabled={dockView.isRouting}
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

				{#if dockView.activeRoute && dockView.routeAlternatives.length > 1}
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
							{#each dockView.routeAlternatives as route, index (`alternative-${index}`)}
								<button
									type="button"
									class={`rounded-lg border p-3 text-left transition-colors ${
										index === dockView.selectedRouteIndex
											? "border-primary/40 bg-background shadow-sm"
											: "border-border/50 bg-background/70 hover:border-border hover:bg-background"
									}`}
									aria-pressed={index === dockView.selectedRouteIndex}
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
											{#if index === dockView.selectedRouteIndex}
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
									<div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground min-[520px]:grid-cols-4">
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
										<div>
											<div class="font-semibold text-foreground">
												Quality {formatQualityScore(dockView.routeAlternativeQualities[index]?.overallScore ?? null)}
											</div>
											<div>{formatQualityBand(dockView.routeAlternativeQualities[index]?.band ?? "unknown")}</div>
										</div>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if dockView.activeRoute && dockView.alternativeInfoMessage}
					<div
						class="mt-3 rounded-lg border border-border/50 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground"
						role="status"
					>
						{dockView.alternativeInfoMessage}
					</div>
				{/if}

				{#if dockView.activeRoute}
				<div class="mt-2.5 min-w-0 rounded-md border border-border/40 bg-secondary/10">
					{#if dockView.activeRoute}
						<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-3 py-2">
							<div class="flex min-w-0 flex-wrap items-center gap-2">
								<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
									{dockView.activeRoute.startLabel}
								</span>
								{#if dockView.activeRoute.mode === "round_course"}
									<Badge
										variant="secondary"
										class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
									>
										Round course
									</Badge>
									<span class="text-xs text-muted-foreground">Returns to start</span>
								{:else if dockView.activeRoute.mode === "out_and_back"}
									<Badge
										variant="secondary"
										class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
									>
										Out and back
									</Badge>
									<span class="text-xs text-muted-foreground">
										to {dockView.activeRoute.destinationLabel} and back
									</span>
								{:else}
									<span class="text-xs text-muted-foreground">
										to {dockView.activeRoute.destinationLabel}
									</span>
								{/if}
								{#if dockView.activeRoute.spatialConstraint}
									<Badge
										variant="outline"
										class="h-5 border-sky-500/25 bg-sky-500/8 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200"
									>
										{formatSpatialConstraintSummary(dockView.activeRoute)}
									</Badge>
									<Badge
										variant="outline"
										class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
									>
										{formatSpatialConstraintEnforcement(
											dockView.activeRoute.spatialConstraint.enforcement,
										)}
									</Badge>
								{/if}
							</div>
							{#if dockView.activeRoute.mode === "round_course" && dockView.activeRoundCourseTarget}
								<span class="text-xs text-muted-foreground">
									Target {formatRoundCourseTarget(dockView.activeRoundCourseTarget)}
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
						{#if dockView.elevationSamples.length > 0}
							<div
								class="flex min-w-0 flex-nowrap items-center justify-end gap-x-2 overflow-x-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground"
							>
								{#if dockView.activeProfilePoint}
									<span class="font-semibold text-foreground">
										At {formatExactDistance(dockView.activeProfilePoint.distanceMeters)}
									</span>
									<span class="font-semibold text-foreground">
										{formatElevation(dockView.activeProfilePoint.elevationMeters)}
									</span>
									<span class="text-border">|</span>
								{/if}
								<span>min {formatElevation(dockView.elevMin)}</span>
								<span class="text-border">|</span>
								<span>max {formatElevation(dockView.elevMax)}</span>
								<span class="text-border">|</span>
								<span>delta {formatElevation(dockView.elevMax - dockView.elevMin)}</span>
								{#if dockView.activeRouteGradientMetrics && dockView.activeRouteGradientMetrics.averageGradientPercent !== null}
									<span class="text-border">|</span>
									<span>avg {formatGrade(dockView.activeRouteGradientMetrics.averageGradientPercent)}</span>
								{/if}
								{#if dockView.activeRouteGradientMetrics && dockView.activeRouteGradientMetrics.maximumGradientPercent !== null}
									<span class="text-border">|</span>
									<span>max {formatGrade(dockView.activeRouteGradientMetrics.maximumGradientPercent)}</span>
								{/if}
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">No route profile yet</span>
						{/if}
					</div>
					<div class="px-2 pb-1.5 pt-1">
						{#if dockView.elevationSamples.length > 0}
							<svg
								class="block w-full touch-none"
								height={dockView.chartH}
								viewBox="0 0 {chartW} {dockView.chartH}"
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
										y1={gridLine * dockView.chartH}
										x2={chartW}
										y2={gridLine * dockView.chartH}
										stroke="currentColor"
										class="text-border/40"
										stroke-width="1"
										vector-effect="non-scaling-stroke"
									/>
								{/each}
								{#each dockView.activeRouteClimbs as climb}
									<rect
										x={(climb.startDistanceMeters / Math.max(dockView.sampledProfileDistanceTotal ?? 1, 1)) * chartW}
										y="0"
										width={Math.max(
											1.5,
											((climb.endDistanceMeters - climb.startDistanceMeters) /
												Math.max(dockView.sampledProfileDistanceTotal ?? 1, 1)) *
												chartW,
										)}
										height={dockView.chartH}
										fill={getClimbColor(climb)}
										opacity={climb.isKeyClimb ? "0.24" : "0.13"}
									/>
								{/each}
								<path d={dockView.areaD} fill="url(#elevFill)" class="text-emerald-500" />
								{#if dockView.activeProfilePoint}
									<line
										x1={dockView.activeProfilePoint.x}
										y1="0"
										x2={dockView.activeProfilePoint.x}
										y2={dockView.chartH}
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
									points={dockView.linePoints}
									vector-effect="non-scaling-stroke"
								/>
								{#if dockView.activeProfilePoint}
									<circle
										cx={dockView.activeProfilePoint.x}
										cy={dockView.activeProfilePoint.y}
										r="5.75"
										fill="rgba(16, 185, 129, 0.22)"
									/>
									<circle
										cx={dockView.activeProfilePoint.x}
										cy={dockView.activeProfilePoint.y}
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
									height={dockView.chartH}
									fill="transparent"
									pointer-events="all"
								/>
							</svg>
							<div
								class="flex justify-between px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
							>
								<span>Start</span>
								<span class="hidden min-[480px]:inline">{dockView.distanceTickLabels[0]}</span>
								<span class="hidden min-[640px]:inline">{dockView.distanceTickLabels[1]}</span>
								<span class="hidden min-[900px]:inline">{dockView.distanceTickLabels[2]}</span>
								<span>{dockView.distanceTickLabels[3]}</span>
							</div>
						{:else}
							<div class="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
								Elevation and route profile will appear here after a route is generated.
							</div>
						{/if}
					</div>
					{#if dockView.activeRoute && dockView.elevationSamples.length > 0}
						<div class="border-t border-border/30 px-3 py-2">
							{#if dockView.activeRouteClimbs.length > 0}
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<span class="font-semibold text-foreground">
										{dockView.activeRouteClimbs.length} detected climb{dockView.activeRouteClimbs.length === 1 ? "" : "s"}
									</span>
									<span>{dockView.activeCategorizedClimbs.length} categorized</span>
									<span>{dockView.activeKeyClimbs.length} key highlighted</span>
									{#if dockView.hardestClimb}
										<span class="font-semibold text-foreground">
											Hardest: {dockView.hardestClimb.category}, {formatElevation(dockView.hardestClimb.elevationGainMeters)} over {formatDistance(dockView.hardestClimb.distanceMeters)} at {formatGrade(dockView.hardestClimb.averageGradePercent)}
										</span>
									{/if}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">
									No climbs meet the 500 m, 30 m gain, and 3% average grade threshold.
								</p>
							{/if}
						</div>
					{:else if dockView.activeRoute}
						<div class="border-t border-border/30 px-3 py-2 text-xs text-muted-foreground">
							No climb data available because this route has no elevation samples.
						</div>
					{/if}
				</div>
				{/if}

				{#if dockView.directionsOpen && dockView.activeRoute}
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
								{dockView.activeDirections.length} cue{dockView.activeDirections.length === 1 ? "" : "s"}
							</span>
						</div>

						{#if dockView.activeDirections.length > 0}
							<div class="space-y-1">
								{#each dockView.activeDirections as cue, index (`cue-${index}-${cue.coordinateIndex}-${cue.sign}`)}
									<button
										type="button"
										class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
											dockView.selectedCueIndex === index
												? "border-primary/35 bg-primary/10 text-foreground"
												: "border-transparent bg-background/60 text-foreground hover:border-border/70 hover:bg-background"
										}`}
										aria-pressed={dockView.selectedCueIndex === index}
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

				{#if dockView.routeAnalysisOpen && dockView.activeRoute}
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
										{getRoutingBadgeLabel(dockView.activeRoute)}
									</Badge>
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<AlertTriangle class="size-3" /> Readiness
										</span>
									</div>
									{#if dockView.activeRouteQuality}
										<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2 text-xs">
											<div class="mb-2 flex items-center justify-between gap-2">
												<div>
													<div class="font-semibold text-foreground">
														Quality {formatQualityScore(dockView.activeRouteQuality.overallScore)}
													</div>
													<div class="text-muted-foreground">
														{formatQualityBand(dockView.activeRouteQuality.band)} · {dockView.activeRouteQuality.confidence} confidence
													</div>
												</div>
												<Badge
													variant="outline"
													class={`h-5 px-2 text-[10px] font-semibold uppercase tracking-wide ${getQualityToneClass(dockView.activeRouteQuality.band)}`}
												>
													{formatQualityBand(dockView.activeRouteQuality.band)}
												</Badge>
											</div>
											<div class="grid gap-1.5">
												{#each Object.values(dockView.activeRouteQuality.subscores) as item}
													<div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
														<div class="w-8 text-right font-semibold tabular-nums text-foreground">
															{item.available ? formatQualityScore(item.score) : "--"}
														</div>
														<div class="min-w-0">
															<div class="font-semibold text-foreground">{item.label}</div>
															<div class={item.available ? "text-muted-foreground" : "text-muted-foreground/70"}>
																{item.available ? item.summary : "Unavailable"}
															</div>
														</div>
													</div>
												{/each}
											</div>
										</div>
									{/if}
									{#if dockView.activeReadinessWarnings.length > 0}
										<div class="grid gap-1.5">
											{#each dockView.activeReadinessWarnings as warning}
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
									{#if dockView.surfaceMix.length > 0}
										<div class="flex h-2 overflow-hidden rounded-full bg-secondary">
											{#each dockView.surfaceMix as surface}
												<div
													class="{surface.className} opacity-90"
													style="width: {surface.pct}%"
													title="{surface.label}: {surface.pct}%"
												></div>
											{/each}
										</div>
										<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
											{#each dockView.surfaceMix as surface}
												<span class="flex items-center gap-1">
													<span class="size-1.5 rounded-full {surface.className}"></span>
													{surface.label} ({surface.pct}%)
												</span>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											{isImportedRoute(dockView.activeRoute)
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
										{#if dockView.activeWindSummary}
											<span>{dockView.activeWindSummary.forecastTime}</span>
										{/if}
									</div>
									{#if dockView.activeWindSummary}
										<div class="grid gap-1.5 text-xs">
											<div class="grid grid-cols-2 gap-1.5">
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Average</div>
													<div class="font-semibold text-foreground">
														{dockView.activeWindSummary.averageHeadwindKmh < 0
															? `${formatWindSpeed(dockView.activeWindSummary.averageTailwindKmh)} tailwind`
															: `${formatWindSpeed(dockView.activeWindSummary.averageHeadwindKmh)} headwind`}
													</div>
												</div>
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Max crosswind</div>
													<div class="font-semibold text-foreground">
														{formatWindSpeed(dockView.activeWindSummary.maxCrosswindKmh)}
													</div>
												</div>
											</div>
											<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
												<span>Headwind {formatDistance(dockView.activeWindSummary.headwindDistanceMeters)}</span>
												<span>Crosswind {formatDistance(dockView.activeWindSummary.crosswindDistanceMeters)}</span>
												<span>Tailwind {formatDistance(dockView.activeWindSummary.tailwindDistanceMeters)}</span>
												<span>Max headwind {formatWindSpeed(dockView.activeWindSummary.maxHeadwindKmh)}</span>
											</div>
											{#if dockView.strongestWindSegments.length > 0}
												<div class="grid gap-1.5">
													{#each dockView.strongestWindSegments as segment}
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
																<span>{analysis.getWindSegmentDistanceRange(dockView.activeRoute, segment)}</span>
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
											{isImportedRoute(dockView.activeRoute)
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
									{#if dockView.activeRouteClimbs.length > 0}
										<div class="grid gap-1.5">
											{#each dockView.activeRouteClimbs as climb, index}
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
									<div class="font-medium text-foreground">{dockView.activeRoute.startLabel}</div>
								</div>
								{#if dockView.activeRoute.waypoints.length > 0 && dockView.activeRoute.mode !== "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved waypoints
										</div>
										<div class="space-y-1">
											{#each dockView.activeRoute.waypoints as waypoint, index}
												<div class="font-medium text-foreground">
													{index + 1}. {waypoint.label}
												</div>
											{/each}
										</div>
									</div>
								{/if}
								{#if dockView.activeRoute.mode === "round_course"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Loop finish
										</div>
										<div class="font-medium text-foreground">Returns to {dockView.activeRoute.startLabel}</div>
									</div>
									{#if dockView.activeRoundCourseTarget}
										<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
											<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
												Requested target
											</div>
											<div class="font-medium text-foreground">
												{formatRoundCourseTarget(dockView.activeRoundCourseTarget)}
											</div>
										</div>
									{/if}
								{:else if dockView.activeRoute.mode === "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved turnaround
										</div>
										<div class="font-medium text-foreground">{dockView.activeRoute.destinationLabel}</div>
									</div>
								{:else}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved destination
										</div>
										<div class="font-medium text-foreground">{dockView.activeRoute.destinationLabel}</div>
									</div>
								{/if}
								{#if dockView.activeRoute.spatialConstraint}
									<div class="rounded-md border border-sky-500/20 bg-sky-500/8 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-sky-900/70 dark:text-sky-100/70">
											Route bounds
										</div>
										<div class="font-medium text-foreground">
											{formatSpatialConstraintSummary(dockView.activeRoute)}
										</div>
										<div class="text-muted-foreground">
											{formatSpatialConstraintEnforcement(
												dockView.activeRoute.spatialConstraint.enforcement,
											)}
										</div>
									</div>
								{/if}
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Routing profile
									</div>
									<div class="font-medium text-foreground">
										{getRoutingProfileLabel(dockView.activeRoute)}
									</div>
								</div>
								{#if dockView.activeProviderWarnings.length > 0}
									<div class="rounded-md border border-amber-500/20 bg-amber-500/8 px-2.5 py-2 text-amber-900 dark:text-amber-100">
										<div class="mb-1 font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-100/70">
											Routing fallback
										</div>
										<div class="space-y-1 font-medium">
											{#each dockView.activeProviderWarnings as warning}
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
