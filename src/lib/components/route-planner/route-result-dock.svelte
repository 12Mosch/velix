<script lang="ts">
	import ActionTooltip from "$lib/components/route-planner/action-tooltip.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import { isImportedRoute, type RouteGradientSection } from "$lib/route-planning";
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
		formatTrainingSessionKind,
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
	import { Effect } from "effect";


	type Props = {
		form: PlannerFormController;
		routes: PlannerRoutesController;
		analysis: PlannerAnalysisController;
		save: PlannerSaveController;
		sharing: PlannerSharingController;
		importExport: PlannerImportExportController;
	};

	let { form, routes, analysis, save, sharing, importExport }: Props = $props();
	const dockChromeView = $derived.by(() => ({
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
		activeImportedRouteSource: routes.activeImportedRouteSource,
		alternativeInfoMessage: routes.alternativeInfoMessage,
		canUndoRouteEdit: routes.canUndoRouteEdit,
		canRedoRouteEdit: routes.canRedoRouteEdit,
		routeActionsDisabled: routes.routeNeedsRecalculation || routes.isRouting,
	}));
	let profileOpen = $state(false);
	const saveDraftDisabledReason = $derived(
		routes.routeNeedsRecalculation || routes.isRouting
			? routes.isRouting
				? "Route is generating"
				: "Recalculate before saving"
			: null,
	);
	const exportDisabledReason = $derived(
		routes.routeNeedsRecalculation || routes.isRouting
			? routes.isRouting
				? "Route is generating"
				: "Recalculate before export"
			: null,
	);
	const shareDisabledReason = $derived(
		routes.routeNeedsRecalculation || routes.isRouting
			? routes.isRouting
				? "Route is generating"
				: "Recalculate before sharing"
			: sharing.isSharingRoute
				? "Sharing route"
				: null,
	);
	function isProfileOpen(): boolean {
		return profileOpen;
	}
	function getGradientSectionDirection(section: RouteGradientSection): string {
		if (section.averageGradePercent > 1) return "Climb";
		if (section.averageGradePercent < -1) return "Descent";
		return "Flat";
	}
	function getGradientSectionTone(section: RouteGradientSection): string {
		if (section.averageGradePercent > 1) {
			return "border-rose-500/25 bg-rose-500/8";
		}
		if (section.averageGradePercent < -1) {
			return "border-sky-500/25 bg-sky-500/8";
		}
		return "border-border/30 bg-background/60";
	}
</script>

{#snippet routeSummarySkeleton()}
	<div
		class="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3"
		role="status"
		aria-live="polite"
		aria-label={form.getSubmitButtonText()}
	>
		<span class="sr-only">
			{dockChromeView.isRoundCourseMode
				? "Calculating the round course..."
				: dockChromeView.isOutAndBackMode
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
					{#if dockChromeView.isRouting}
						{@render routeSummarySkeleton()}
					{:else if dockChromeView.activeRoute}
						<div
							class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums sm:text-sm"
						>
							<span class="font-semibold text-foreground">
								<span class="font-heading text-base sm:text-lg">
									{formatDistanceValue(dockChromeView.activeRoute.distanceMeters)}
								</span>
								{getDistanceUnitLabel()}
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1">
								<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
								<span class="font-semibold text-foreground">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(dockChromeView.activeRoute.ascendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1 text-sky-600 dark:text-sky-400">
								<TrendingDown class="size-3.5 shrink-0 opacity-80" />
								<span class="font-semibold">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(dockChromeView.activeRoute.descendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">{getRouteDurationText(dockChromeView.activeRoute)}</span>
							{#if dockChromeView.activeDirections.length > 0}
								<span class="hidden text-border md:inline" aria-hidden="true">·</span>
								<span class="font-semibold text-foreground">
									{dockChromeView.activeTurnCount} turn{dockChromeView.activeTurnCount === 1 ? "" : "s"}
								</span>
							{/if}
						</div>
					{:else}
						<div class="flex min-w-0 flex-col gap-1">
							<span class="text-sm font-semibold text-foreground">
								{dockChromeView.isRoundCourseMode
										? "Generate a round course to see live distance, climbing, and elevation."
										: dockChromeView.isOutAndBackMode
											? "Generate an out-and-back route to see live distance, climbing, and elevation."
										: "Generate a route to see live distance, climbing, and elevation."}
							</span>
							<span class="text-xs text-muted-foreground">
								{dockChromeView.isRoundCourseMode
										? "The map overlay and summary will update once a loop route is found."
										: dockChromeView.isOutAndBackMode
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
								disabled={dockChromeView.isImportingGpx}
								onclick={importExport.openGpxImportPicker}
							>
								{#if dockChromeView.isImportingGpx}
									<Skeleton class="size-3 rounded-full" />
								{/if}
								{dockChromeView.isImportingGpx ? "Importing GPX..." : "Import GPX"}
							</Button>
							{#if dockChromeView.activeRoute}
								<div class="flex items-center gap-1">
									<Button
										variant="outline"
										size="icon"
										class="size-8"
										type="button"
										disabled={!dockChromeView.canUndoRouteEdit}
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
										disabled={!dockChromeView.canRedoRouteEdit}
										aria-label="Redo route edit"
										onclick={routes.redoRouteEdit}
									>
										<Redo2 class="size-3.5" />
									</Button>
								</div>
								<ActionTooltip content={saveDraftDisabledReason}>
									<Button
										variant={dockChromeView.isActiveRouteSaved ? "secondary" : "outline"}
										size="sm"
										class="gap-1 font-semibold"
										disabled={dockChromeView.routeActionsDisabled}
										onclick={() =>
											void Effect.runPromise(save.handleSaveDraft())}
									>
										{#if dockChromeView.isActiveRouteSaved}
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
										disabled={dockChromeView.routeActionsDisabled}
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
										disabled={dockChromeView.routeActionsDisabled}
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
										disabled={dockChromeView.routeActionsDisabled || dockChromeView.isSharingRoute}
										onclick={() =>
											void Effect.runPromise(sharing.handleShareActiveRoute())}
									>
										<Share2 class="size-3.5" />
										{dockChromeView.isSharingRoute ? "Sharing..." : dockChromeView.isActiveRouteShareCopied ? "Copied" : "Share"}
									</Button>
								</ActionTooltip>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (analysis.directionsOpen = !dockChromeView.directionsOpen)}
									aria-expanded={dockChromeView.directionsOpen}
									aria-controls="route-directions-panel"
								>
									Directions
									<Badge
										variant="secondary"
										class="h-5 px-1.5 text-[10px] font-semibold"
									>
										{dockChromeView.activeTurnCount}
									</Badge>
									{#if dockChromeView.directionsOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (profileOpen = !profileOpen)}
									aria-expanded={isProfileOpen()}
									aria-controls="route-profile-panel"
								>
									Profile
									{#if isProfileOpen()}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="gap-1 font-semibold"
									onclick={() => (analysis.routeAnalysisOpen = !dockChromeView.routeAnalysisOpen)}
									aria-expanded={dockChromeView.routeAnalysisOpen}
									aria-controls="route-analysis-panel"
								>
									{dockChromeView.routeAnalysisOpen ? "Less" : "Analysis"}
									{#if dockChromeView.routeAnalysisOpen}
										<ChevronUp class="size-3.5 opacity-70" />
									{:else}
										<ChevronDown class="size-3.5 opacity-70" />
									{/if}
								</Button>
							{/if}
						</div>
					</div>
				</div>

				{#if dockChromeView.activeRoute && dockChromeView.routeNeedsRecalculation}
					<div
						class="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-950 dark:text-amber-100"
						role="status"
					>
						Route needs recalculation. Generate Route to update save, export, and share actions.
					</div>
				{/if}

				{#if dockChromeView.activeRoute && dockChromeView.routeExportError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{dockChromeView.routeExportError}
					</div>
				{/if}

				{#if dockChromeView.activeRoute && dockChromeView.activeRouteShareError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{dockChromeView.activeRouteShareError}
						{#if dockChromeView.activeRouteShareUrl}
							<input
								class="mt-2 w-full rounded-md border border-destructive/20 bg-background px-2 py-1 font-mono text-xs text-foreground"
								readonly
								value={dockChromeView.activeRouteShareUrl}
								aria-label="Share link"
								onfocus={(event) => event.currentTarget.select()}
							/>
						{/if}
					</div>
				{/if}

				{#if dockChromeView.saveSyncError}
					<div
						class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
						role="alert"
					>
						{dockChromeView.saveSyncError}
					</div>
				{/if}

				{#if dockChromeView.activeRoute && dockChromeView.activeImportedRouteSource}
					<div
						class="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-sm text-sky-900 dark:text-sky-100"
						role="status"
					>
						<div class="font-semibold">Imported GPX</div>
						<div>{dockChromeView.activeImportedRouteSource.filename}</div>
						<div>{getImportedRouteStopSummary(dockChromeView.activeRoute)}</div>
						<div>Edit stops, then Generate Route to recalculate.</div>
					</div>
				{/if}

				{#if dockChromeView.activeRoute && dockChromeView.avoidedRoads.length > 0}
					<div class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
						<div class="mb-2 flex items-center justify-between gap-3">
							<div class="text-xs font-semibold uppercase tracking-wide text-destructive">
								{dockChromeView.avoidedRoads.length} avoided
							</div>
						</div>
						<div class="flex flex-wrap gap-2">
							{#each dockChromeView.avoidedRoads as avoidance, index (`avoidance-${index}`)}
								<div class="flex items-center gap-1 rounded-md border border-destructive/20 bg-background/80 px-2 py-1 text-xs font-medium text-foreground">
									<span>{avoidance.label}</span>
									<Button
										variant="ghost"
										size="icon"
										class="size-6 text-muted-foreground hover:text-destructive"
										type="button"
										disabled={dockChromeView.isRouting}
										aria-label={`Remove ${avoidance.label}`}
										onclick={() =>
											void Effect.runPromise(routes.removeAvoidedRoad(index))}
									>
										<X class="size-3.5" />
									</Button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if dockChromeView.activeRoute && dockChromeView.routeAlternatives.length > 1}
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
							{#each dockChromeView.routeAlternatives as route, index (`alternative-${index}`)}
								<button
									type="button"
									class={`rounded-lg border p-3 text-left transition-colors ${
										index === dockChromeView.selectedRouteIndex
											? "border-primary/40 bg-background shadow-sm"
											: "border-border/50 bg-background/70 hover:border-border hover:bg-background"
									}`}
									aria-pressed={index === dockChromeView.selectedRouteIndex}
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
											{#if index === dockChromeView.selectedRouteIndex}
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
												Quality {formatQualityScore(analysis.routeAlternativeQualities[index]?.overallScore ?? null)}
											</div>
											<div>{formatQualityBand(analysis.routeAlternativeQualities[index]?.band ?? "unknown")}</div>
										</div>
									</div>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if dockChromeView.activeRoute && dockChromeView.alternativeInfoMessage}
					<div
						class="mt-3 rounded-lg border border-border/50 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground"
						role="status"
					>
						{dockChromeView.alternativeInfoMessage}
					</div>
				{/if}

				{#if profileOpen && dockChromeView.activeRoute}
				<div
					id="route-profile-panel"
					class="mt-2.5 min-w-0 rounded-md border border-border/40 bg-secondary/10"
				>
						<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-3 py-2">
							<div class="flex min-w-0 flex-wrap items-center gap-2">
								<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
									{dockChromeView.activeRoute.startLabel}
								</span>
								{#if dockChromeView.activeRoute.mode === "round_course"}
									<Badge
										variant="secondary"
										class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
									>
										Round course
									</Badge>
									<span class="text-xs text-muted-foreground">Returns to start</span>
								{:else if dockChromeView.activeRoute.mode === "out_and_back"}
									<Badge
										variant="secondary"
										class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
									>
										Out and back
									</Badge>
									<span class="text-xs text-muted-foreground">
										to {dockChromeView.activeRoute.destinationLabel} and back
									</span>
								{:else}
									<span class="text-xs text-muted-foreground">
										to {dockChromeView.activeRoute.destinationLabel}
									</span>
								{/if}
								{#if dockChromeView.activeRoute.spatialConstraint}
									<Badge
										variant="outline"
										class="h-5 border-sky-500/25 bg-sky-500/8 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200"
									>
										{formatSpatialConstraintSummary(dockChromeView.activeRoute)}
									</Badge>
									<Badge
										variant="outline"
										class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
									>
										{formatSpatialConstraintEnforcement(
											dockChromeView.activeRoute.spatialConstraint.enforcement,
										)}
									</Badge>
								{/if}
							</div>
							{#if dockChromeView.activeRoute.mode === "round_course" && dockChromeView.activeRoundCourseTarget}
								<span class="text-xs text-muted-foreground">
									Target {formatRoundCourseTarget(dockChromeView.activeRoundCourseTarget)}
								</span>
							{/if}
						</div>
					<div
						class="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-1.5"
					>
						<div
							class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/75"
						>
							<TrendingUp class="size-3 shrink-0" />
							Elevation
						</div>
						{#if analysis.elevationSamples.length > 0}
							<div
								class="flex min-w-0 flex-nowrap items-center justify-end gap-x-2 overflow-x-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground"
							>
								{#if analysis.activeProfilePoint}
									<span class="font-semibold text-foreground">
										At {formatExactDistance(analysis.activeProfilePoint.distanceMeters)}
									</span>
									<span class="font-semibold text-foreground">
										{formatElevation(analysis.activeProfilePoint.elevationMeters)}
									</span>
									<span class="text-border">|</span>
								{/if}
								<span>min {formatElevation(analysis.elevMin)}</span>
								<span class="text-border">|</span>
								<span>max {formatElevation(analysis.elevMax)}</span>
								<span class="text-border">|</span>
								<span>delta {formatElevation(analysis.elevMax - analysis.elevMin)}</span>
								{#if analysis.activeRouteGradientMetrics && analysis.activeRouteGradientMetrics.averageGradientPercent !== null}
									<span class="text-border">|</span>
									<span>avg {formatGrade(analysis.activeRouteGradientMetrics.averageGradientPercent)}</span>
								{/if}
								{#if analysis.activeRouteGradientMetrics && analysis.activeRouteGradientMetrics.maximumGradientPercent !== null}
									<span class="text-border">|</span>
									<span>max {formatGrade(analysis.activeRouteGradientMetrics.maximumGradientPercent)}</span>
								{/if}
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">No route profile yet</span>
						{/if}
					</div>
					<div class="px-2 pb-1.5 pt-1">
						{#if analysis.elevationSamples.length > 0}
							<svg
								class="block w-full touch-none"
								height={analysis.chartH}
								viewBox="0 0 {chartW} {analysis.chartH}"
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
										y1={gridLine * analysis.chartH}
										x2={chartW}
										y2={gridLine * analysis.chartH}
										stroke="currentColor"
										class="text-border/40"
										stroke-width="1"
										vector-effect="non-scaling-stroke"
									/>
								{/each}
								{#each analysis.activeRouteClimbs as climb}
									<rect
										x={(climb.startDistanceMeters / Math.max(analysis.sampledProfileDistanceTotal ?? 1, 1)) * chartW}
										y="0"
										width={Math.max(
											1.5,
											((climb.endDistanceMeters - climb.startDistanceMeters) /
												Math.max(analysis.sampledProfileDistanceTotal ?? 1, 1)) *
												chartW,
										)}
										height={analysis.chartH}
										fill={getClimbColor(climb)}
										opacity={climb.isKeyClimb ? "0.24" : "0.13"}
									/>
								{/each}
								<path d={analysis.areaD} fill="url(#elevFill)" class="text-emerald-500" />
								{#if analysis.activeProfilePoint}
									<line
										x1={analysis.activeProfilePoint.x}
										y1="0"
										x2={analysis.activeProfilePoint.x}
										y2={analysis.chartH}
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
									points={analysis.linePoints}
									vector-effect="non-scaling-stroke"
								/>
								{#if analysis.activeProfilePoint}
									<circle
										cx={analysis.activeProfilePoint.x}
										cy={analysis.activeProfilePoint.y}
										r="5.75"
										fill="rgba(16, 185, 129, 0.22)"
									/>
									<circle
										cx={analysis.activeProfilePoint.x}
										cy={analysis.activeProfilePoint.y}
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
									height={analysis.chartH}
									fill="transparent"
									pointer-events="all"
								/>
							</svg>
							<div
								class="flex justify-between px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
							>
								<span>Start</span>
								<span class="hidden min-[480px]:inline">{analysis.distanceTickLabels[0]}</span>
								<span class="hidden min-[640px]:inline">{analysis.distanceTickLabels[1]}</span>
								<span class="hidden min-[900px]:inline">{analysis.distanceTickLabels[2]}</span>
								<span>{analysis.distanceTickLabels[3]}</span>
							</div>
						{:else}
							<div class="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
								Elevation and route profile will appear here after a route is generated.
							</div>
						{/if}
					</div>
					{#if dockChromeView.activeRoute && analysis.elevationSamples.length > 0}
						<div class="border-t border-border/30 px-3 py-2">
							{#if analysis.activeRouteClimbs.length > 0}
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
									<span class="font-semibold text-foreground">
										{analysis.activeRouteClimbs.length} detected climb{analysis.activeRouteClimbs.length === 1 ? "" : "s"}
									</span>
									<span>{analysis.activeCategorizedClimbs.length} categorized</span>
									<span>{analysis.activeKeyClimbs.length} key highlighted</span>
									{#if analysis.hardestClimb}
										<span class="font-semibold text-foreground">
											Hardest: {analysis.hardestClimb.category}, {formatElevation(analysis.hardestClimb.elevationGainMeters)} over {formatDistance(analysis.hardestClimb.distanceMeters)} at {formatGrade(analysis.hardestClimb.averageGradePercent)}
										</span>
									{/if}
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">
									No climbs meet the 500 m, 30 m gain, and 3% average grade threshold.
								</p>
							{/if}
						</div>
					{:else if dockChromeView.activeRoute}
						<div class="border-t border-border/30 px-3 py-2 text-xs text-muted-foreground">
							No climb data available because this route has no elevation samples.
						</div>
					{/if}
				</div>
				{/if}

				{#if dockChromeView.directionsOpen && dockChromeView.activeRoute}
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
								{dockChromeView.activeDirections.length} cue{dockChromeView.activeDirections.length === 1 ? "" : "s"}
							</span>
						</div>

						{#if dockChromeView.activeDirections.length > 0}
							<div class="space-y-1">
								{#each dockChromeView.activeDirections as cue, index (`cue-${index}-${cue.coordinateIndex}-${cue.sign}`)}
									<button
										type="button"
										class={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
											dockChromeView.selectedCueIndex === index
												? "border-primary/35 bg-primary/10 text-foreground"
												: "border-transparent bg-background/60 text-foreground hover:border-border/70 hover:bg-background"
										}`}
										aria-pressed={dockChromeView.selectedCueIndex === index}
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

				{#if dockChromeView.routeAnalysisOpen && dockChromeView.activeRoute}
					<div
						id="route-analysis-panel"
						class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-3 md:max-h-[min(42vh,26rem)] md:p-3.5"
					>
						<div class="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
							<div class="flex flex-col gap-3">
								{#if analysis.activeTrainingSuitability}
									<div class="space-y-2">
										<div class="flex items-start justify-between gap-2">
											<div class="flex min-w-0 items-center gap-2">
												<ShieldCheck
													class="size-3.5 shrink-0 text-primary"
												/>
												<span
													class="text-xs font-semibold uppercase tracking-wide text-foreground/75"
												>
													Training suitability
												</span>
											</div>
											<Badge
												variant="outline"
												class={`h-5 shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wide ${getQualityToneClass(analysis.activeTrainingSuitability.band)}`}
											>
												{formatQualityBand(analysis.activeTrainingSuitability.band)}
											</Badge>
										</div>
										<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2 text-xs">
											<div class="mb-2 flex items-center justify-between gap-2">
												<div>
													<div class="font-semibold text-foreground">
														Training {formatQualityScore(analysis.activeTrainingSuitability.overallScore)}
													</div>
													<div class="text-muted-foreground">
														{formatTrainingSessionKind(analysis.activeTrainingSuitability.sessionKind)} · {analysis.activeTrainingSuitability.summary}
													</div>
												</div>
												<div class="shrink-0 text-right text-muted-foreground">
													{analysis.activeTrainingSuitability.confidence} confidence
												</div>
											</div>
											<div class="grid gap-1.5">
												{#each Object.values(analysis.activeTrainingSuitability.subscores) as item}
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
											{#if analysis.activeTrainingSuitability.flags.length > 0}
												<div class="mt-2 grid gap-1.5 border-t border-border/30 pt-2">
													{#each analysis.activeTrainingSuitability.flags as flag}
														<div
															class={`rounded-md border px-2 py-1.5 ${
																flag.severity === "warning"
																	? "border-destructive/25 bg-destructive/10 text-destructive"
																	: "border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100"
															}`}
														>
															<div class="font-semibold">{flag.label}</div>
															<div class="opacity-85">{flag.summary}</div>
														</div>
													{/each}
												</div>
											{/if}
										</div>
									</div>
								{/if}

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
										{getRoutingBadgeLabel(dockChromeView.activeRoute)}
									</Badge>
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<AlertTriangle class="size-3" /> Readiness
										</span>
									</div>
									{#if analysis.activeRouteQuality}
										<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2 text-xs">
											<div class="mb-2 flex items-center justify-between gap-2">
												<div>
													<div class="font-semibold text-foreground">
														Quality {formatQualityScore(analysis.activeRouteQuality.overallScore)}
													</div>
													<div class="text-muted-foreground">
														{formatQualityBand(analysis.activeRouteQuality.band)} · {analysis.activeRouteQuality.confidence} confidence
													</div>
												</div>
												<Badge
													variant="outline"
													class={`h-5 px-2 text-[10px] font-semibold uppercase tracking-wide ${getQualityToneClass(analysis.activeRouteQuality.band)}`}
												>
													{formatQualityBand(analysis.activeRouteQuality.band)}
												</Badge>
											</div>
											<div class="grid gap-1.5">
												{#each Object.values(analysis.activeRouteQuality.subscores) as item}
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
									{#if analysis.activeReadinessWarnings.length > 0}
										<div class="grid gap-1.5">
											{#each analysis.activeReadinessWarnings as warning}
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
									{#if analysis.surfaceMix.length > 0}
										<div class="flex h-2 overflow-hidden rounded-full bg-secondary">
											{#each analysis.surfaceMix as surface}
												<div
													class="{surface.className} opacity-90"
													style="width: {surface.pct}%"
													title="{surface.label}: {surface.pct}%"
												></div>
											{/each}
										</div>
										<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
											{#each analysis.surfaceMix as surface}
												<span class="flex items-center gap-1">
													<span class="size-1.5 rounded-full {surface.className}"></span>
													{surface.label} ({surface.pct}%)
												</span>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											{isImportedRoute(dockChromeView.activeRoute)
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
										{#if analysis.activeWindSummary}
											<span>{analysis.activeWindSummary.forecastTime}</span>
										{/if}
									</div>
									{#if analysis.activeWindSummary}
										<div class="grid gap-1.5 text-xs">
											<div class="grid grid-cols-2 gap-1.5">
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Average</div>
													<div class="font-semibold text-foreground">
														{analysis.activeWindSummary.averageHeadwindKmh < 0
															? `${formatWindSpeed(analysis.activeWindSummary.averageTailwindKmh)} tailwind`
															: `${formatWindSpeed(analysis.activeWindSummary.averageHeadwindKmh)} headwind`}
													</div>
												</div>
												<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
													<div class="text-muted-foreground">Max crosswind</div>
													<div class="font-semibold text-foreground">
														{formatWindSpeed(analysis.activeWindSummary.maxCrosswindKmh)}
													</div>
												</div>
											</div>
											<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
												<span>Headwind {formatDistance(analysis.activeWindSummary.headwindDistanceMeters)}</span>
												<span>Crosswind {formatDistance(analysis.activeWindSummary.crosswindDistanceMeters)}</span>
												<span>Tailwind {formatDistance(analysis.activeWindSummary.tailwindDistanceMeters)}</span>
												<span>Max headwind {formatWindSpeed(analysis.activeWindSummary.maxHeadwindKmh)}</span>
											</div>
											{#if analysis.strongestWindSegments.length > 0}
												<div class="grid gap-1.5">
													{#each analysis.strongestWindSegments as segment}
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
																<span>{analysis.getWindSegmentDistanceRange(dockChromeView.activeRoute, segment)}</span>
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
											{isImportedRoute(dockChromeView.activeRoute)
												? "Wind analysis becomes available after re-routing this imported track."
												: "Wind analysis was not available for this route."}
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<TrendingUp class="size-3" /> Gradient sections
										</span>
										{#if analysis.activeRouteGradientSections.length > 0}
											<span>{analysis.activeRouteGradientSections.length} total</span>
										{/if}
									</div>
									{#if analysis.activeRouteGradientSections.length === 0}
										<p class="text-xs text-muted-foreground">
											No gradient section data available because this route has no elevation samples.
										</p>
									{:else if analysis.notableGradientSections.length > 0}
										<div class="grid gap-1.5">
											{#each analysis.notableGradientSections as section}
												<div
													class={`rounded-md border px-2.5 py-2 text-xs ${getGradientSectionTone(section)}`}
												>
													<div class="mb-1 flex items-center justify-between gap-2">
														<div class="flex min-w-0 items-center gap-2 font-semibold text-foreground">
															{#if section.averageGradePercent < -1}
																<TrendingDown class="size-3 shrink-0 text-sky-600 dark:text-sky-300" />
															{:else}
																<TrendingUp class="size-3 shrink-0 text-rose-600 dark:text-rose-300" />
															{/if}
															<span>{getGradientSectionDirection(section)}</span>
														</div>
														<span class="shrink-0 font-semibold tabular-nums text-foreground">
															{formatGrade(section.averageGradePercent)}
														</span>
													</div>
													<div class="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
														<span>{formatDistance(section.distanceMeters)}</span>
														<span>
															{formatElevation(Math.abs(section.elevationDeltaMeters))}
															{section.elevationDeltaMeters < 0 ? " loss" : " gain"}
														</span>
														<span>from {formatExactDistance(section.startDistanceMeters)}</span>
													</div>
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											No notable non-flat gradient sections for this elevation profile.
										</p>
									{/if}
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<MountainSnow class="size-3" /> Climbs
										</span>
									</div>
									{#if analysis.activeRouteClimbs.length > 0}
										<div class="grid gap-1.5">
											{#each analysis.activeRouteClimbs as climb, index}
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
									<div class="font-medium text-foreground">{dockChromeView.activeRoute.startLabel}</div>
								</div>
								{#if dockChromeView.activeRoute.waypoints.length > 0 && dockChromeView.activeRoute.mode !== "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved waypoints
										</div>
										<div class="space-y-1">
											{#each dockChromeView.activeRoute.waypoints as waypoint, index}
												<div class="font-medium text-foreground">
													{index + 1}. {waypoint.label}
												</div>
											{/each}
										</div>
									</div>
								{/if}
								{#if dockChromeView.activeRoute.mode === "round_course"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Loop finish
										</div>
										<div class="font-medium text-foreground">Returns to {dockChromeView.activeRoute.startLabel}</div>
									</div>
									{#if dockChromeView.activeRoundCourseTarget}
										<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
											<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
												Requested target
											</div>
											<div class="font-medium text-foreground">
												{formatRoundCourseTarget(dockChromeView.activeRoundCourseTarget)}
											</div>
										</div>
									{/if}
								{:else if dockChromeView.activeRoute.mode === "out_and_back"}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved turnaround
										</div>
										<div class="font-medium text-foreground">{dockChromeView.activeRoute.destinationLabel}</div>
									</div>
								{:else}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved destination
										</div>
										<div class="font-medium text-foreground">{dockChromeView.activeRoute.destinationLabel}</div>
									</div>
								{/if}
								{#if dockChromeView.activeRoute.spatialConstraint}
									<div class="rounded-md border border-sky-500/20 bg-sky-500/8 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-sky-900/70 dark:text-sky-100/70">
											Route bounds
										</div>
										<div class="font-medium text-foreground">
											{formatSpatialConstraintSummary(dockChromeView.activeRoute)}
										</div>
										<div class="text-muted-foreground">
											{formatSpatialConstraintEnforcement(
												dockChromeView.activeRoute.spatialConstraint.enforcement,
											)}
										</div>
									</div>
								{/if}
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Routing profile
									</div>
									<div class="font-medium text-foreground">
										{getRoutingProfileLabel(dockChromeView.activeRoute)}
									</div>
								</div>
								{#if analysis.activeProviderWarnings.length > 0}
									<div class="rounded-md border border-amber-500/20 bg-amber-500/8 px-2.5 py-2 text-amber-900 dark:text-amber-100">
										<div class="mb-1 font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-100/70">
											Routing fallback
										</div>
										<div class="space-y-1 font-medium">
											{#each analysis.activeProviderWarnings as warning}
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
