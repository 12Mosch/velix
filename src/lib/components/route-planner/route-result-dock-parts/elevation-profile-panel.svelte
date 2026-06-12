<script lang="ts">
	import { MountainSnow, TrendingUp } from "@lucide/svelte";

import { Badge } from "$lib/components/ui/badge/index.js";
import { chartW } from "$lib/route-planner/constants";
import { formatDistance } from "$lib/unit-settings.svelte";
import {
	formatElevation,
		formatExactDistance,
		formatGrade,
		formatRoundCourseTarget,
		formatSpatialConstraintEnforcement,
		formatSpatialConstraintSummary,
		getClimbColor,
	} from "$lib/route-planner/formatters";
	import type { PlannerAnalysisController } from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import type { RouteResultDockChromeView } from "$lib/components/route-planner/route-result-dock-parts/types";

	type Props = {
		dock: RouteResultDockChromeView;
		analysis: PlannerAnalysisController;
	};

	let { dock, analysis }: Props = $props();
</script>

<div
	id="route-profile-panel"
	class="mt-2.5 min-w-0 rounded-md border border-border/40 bg-secondary/10"
>
	{#if dock.activeRoute}
		<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-3 py-2">
			<div class="flex min-w-0 flex-wrap items-center gap-2">
				<span class="text-xs font-semibold uppercase tracking-wide text-foreground/75">
					{dock.activeRoute.startLabel}
				</span>
				{#if dock.activeRoute.mode === "round_course"}
					<Badge
						variant="secondary"
						class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
					>
						Round course
					</Badge>
					<span class="text-xs text-muted-foreground">Returns to start</span>
				{:else if dock.activeRoute.mode === "out_and_back"}
					<Badge
						variant="secondary"
						class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
					>
						Out and back
					</Badge>
					<span class="text-xs text-muted-foreground">
						to {dock.activeRoute.destinationLabel} and back
					</span>
				{:else}
					<span class="text-xs text-muted-foreground">
						to {dock.activeRoute.destinationLabel}
					</span>
				{/if}
				{#if dock.activeRoute.spatialConstraint}
					<Badge
						variant="outline"
						class="h-5 border-sky-500/25 bg-sky-500/8 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200"
					>
						{formatSpatialConstraintSummary(dock.activeRoute)}
					</Badge>
					<Badge
						variant="outline"
						class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
					>
						{formatSpatialConstraintEnforcement(
							dock.activeRoute.spatialConstraint.enforcement,
						)}
					</Badge>
				{/if}
			</div>
			{#if dock.activeRoute.mode === "round_course" && dock.activeRoundCourseTarget}
				<span class="text-xs text-muted-foreground">
					Target {formatRoundCourseTarget(dock.activeRoundCourseTarget)}
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
		{#if analysis.elevationSamples.length > 0}
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
		{:else}
			<div class="border-t border-border/30 px-3 py-2 text-xs text-muted-foreground">
				No climb data available because this route has no elevation samples.
			</div>
		{/if}
	{/if}
</div>
