<script lang="ts">
	import { AlertTriangle, MountainSnow, Route, ShieldCheck, TrendingDown, TrendingUp, Wind } from "@lucide/svelte";

import { Badge } from "$lib/components/ui/badge/index.js";
import { isImportedRoute, type RouteGradientSection } from "$lib/route-planning";
import { formatDistance } from "$lib/unit-settings.svelte";
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
		getQualityToneClass,
		getRoutingBadgeLabel,
		getRoutingProfileLabel,
	} from "$lib/route-planner/formatters";
	import type { PlannerAnalysisController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import type { RouteResultDockChromeView } from "$lib/components/route-planner/route-result-dock-parts/types";

	type Props = {
		dock: RouteResultDockChromeView;
		analysis: PlannerAnalysisController;
	};

	let { dock, analysis }: Props = $props();

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

<div
	id="route-analysis-panel"
	class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-3 md:max-h-[min(42vh,26rem)] md:p-3.5"
>
	{#if dock.activeRoute}
		<div class="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
			<div class="flex flex-col gap-3">
				{#if analysis.activeTrainingSuitability}
					<div class="space-y-2">
						<div class="flex items-start justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								<ShieldCheck class="size-3.5 shrink-0 text-primary" />
								<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
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
						<ShieldCheck class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
						<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
							Ride quality
						</span>
					</div>
					<Badge variant="secondary" class="h-5 shrink-0 px-2 text-[10px] font-semibold">
						{getRoutingBadgeLabel(dock.activeRoute)}
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
								<div class={`rounded-md border px-2.5 py-2 text-xs ${analysis.getWarningContainerClass(warning)}`}>
									<div class="mb-1 flex items-center justify-between gap-2">
										<span class="font-semibold">{warning.title}</span>
										{#if warning.metricLabel && warning.metricValue}
											<span class={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${analysis.getWarningBadgeClass(warning)}`}>
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
							{isImportedRoute(dock.activeRoute)
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
												<span>{analysis.getWindSegmentDistanceRange(dock.activeRoute, segment)}</span>
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
							{isImportedRoute(dock.activeRoute)
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
								<div class={`rounded-md border px-2.5 py-2 text-xs ${getGradientSectionTone(section)}`}>
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
					<div class="font-medium text-foreground">{dock.activeRoute.startLabel}</div>
				</div>
				{#if dock.activeRoute.waypoints.length > 0 && dock.activeRoute.mode !== "out_and_back"}
					<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
						<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
							Resolved waypoints
						</div>
						<div class="space-y-1">
							{#each dock.activeRoute.waypoints as waypoint, index}
								<div class="font-medium text-foreground">
									{index + 1}. {waypoint.label}
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if dock.activeRoute.mode === "round_course"}
					<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
						<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
							Loop finish
						</div>
						<div class="font-medium text-foreground">Returns to {dock.activeRoute.startLabel}</div>
					</div>
					{#if dock.activeRoundCourseTarget}
						<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
							<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
								Requested target
							</div>
							<div class="font-medium text-foreground">
								{formatRoundCourseTarget(dock.activeRoundCourseTarget)}
							</div>
						</div>
					{/if}
				{:else if dock.activeRoute.mode === "out_and_back"}
					<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
						<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
							Resolved turnaround
						</div>
						<div class="font-medium text-foreground">{dock.activeRoute.destinationLabel}</div>
					</div>
				{:else}
					<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
						<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
							Resolved destination
						</div>
						<div class="font-medium text-foreground">{dock.activeRoute.destinationLabel}</div>
					</div>
				{/if}
				{#if dock.activeRoute.spatialConstraint}
					<div class="rounded-md border border-sky-500/20 bg-sky-500/8 px-2.5 py-2">
						<div class="mb-1 font-semibold uppercase tracking-wide text-sky-900/70 dark:text-sky-100/70">
							Route bounds
						</div>
						<div class="font-medium text-foreground">
							{formatSpatialConstraintSummary(dock.activeRoute)}
						</div>
						<div class="text-muted-foreground">
							{formatSpatialConstraintEnforcement(
								dock.activeRoute.spatialConstraint.enforcement,
							)}
						</div>
					</div>
				{/if}
				<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
					<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
						Routing profile
					</div>
					<div class="font-medium text-foreground">
						{getRoutingProfileLabel(dock.activeRoute)}
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
	{/if}
</div>
