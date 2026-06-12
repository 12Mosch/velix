<script lang="ts">
	import { Effect } from "effect";
	import { X } from "@lucide/svelte";

import { Badge } from "$lib/components/ui/badge/index.js";
import { Button } from "$lib/components/ui/button/index.js";
import { formatDistance } from "$lib/unit-settings.svelte";
import {
	formatQualityBand,
	formatQualityScore,
		getImportedRouteStopSummary,
		getRouteDurationText,
	} from "$lib/route-planner/formatters";
	import type {
		PlannerAnalysisController,
		PlannerRoutesController,
	} from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import type { RouteResultDockChromeView } from "$lib/components/route-planner/route-result-dock-parts/types";

	type Props = {
		dock: RouteResultDockChromeView;
		routes: PlannerRoutesController;
		analysis: PlannerAnalysisController;
	};

	let { dock, routes, analysis }: Props = $props();
</script>

{#if dock.activeRoute && dock.routeNeedsRecalculation}
	<div
		class="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-950 dark:text-amber-100"
		role="status"
	>
		Route needs recalculation. Generate Route to update save, export, and share actions.
	</div>
{/if}

{#if dock.activeRoute && dock.routeExportError}
	<div
		class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
		role="alert"
	>
		{dock.routeExportError}
	</div>
{/if}

{#if dock.activeRoute && dock.activeRouteShareError}
	<div
		class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
		role="alert"
	>
		{dock.activeRouteShareError}
		{#if dock.activeRouteShareUrl}
			<input
				class="mt-2 w-full rounded-md border border-destructive/20 bg-background px-2 py-1 font-mono text-xs text-foreground"
				readonly
				value={dock.activeRouteShareUrl}
				aria-label="Share link"
				onfocus={(event) => event.currentTarget.select()}
			/>
		{/if}
	</div>
{/if}

{#if dock.saveSyncError}
	<div
		class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
		role="alert"
	>
		{dock.saveSyncError}
	</div>
{/if}

{#if dock.activeRoute && dock.activeImportedRouteSource}
	<div
		class="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-sm text-sky-900 dark:text-sky-100"
		role="status"
	>
		<div class="font-semibold">Imported GPX</div>
		<div>{dock.activeImportedRouteSource.filename}</div>
		<div>{getImportedRouteStopSummary(dock.activeRoute)}</div>
		<div>Edit stops, then Generate Route to recalculate.</div>
	</div>
{/if}

{#if dock.activeRoute && dock.avoidedRoads.length > 0}
	<div class="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
		<div class="mb-2 flex items-center justify-between gap-3">
			<div class="text-xs font-semibold uppercase tracking-wide text-destructive">
				{dock.avoidedRoads.length} avoided
			</div>
		</div>
		<div class="flex flex-wrap gap-2">
			{#each dock.avoidedRoads as avoidance, index (`avoidance-${index}`)}
				<div class="flex items-center gap-1 rounded-md border border-destructive/20 bg-background/80 px-2 py-1 text-xs font-medium text-foreground">
					<span>{avoidance.label}</span>
					<Button
						variant="ghost"
						size="icon"
						class="size-6 text-muted-foreground hover:text-destructive"
						type="button"
						disabled={dock.isRouting}
						aria-label={`Remove ${avoidance.label}`}
						onclick={() => void Effect.runPromise(routes.removeAvoidedRoad(index))}
					>
						<X class="size-3.5" />
					</Button>
				</div>
			{/each}
		</div>
	</div>
{/if}

{#if dock.activeRoute && dock.routeAlternatives.length > 1}
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
			{#each dock.routeAlternatives as route, index (`alternative-${index}`)}
				<button
					type="button"
					class={`rounded-lg border p-3 text-left transition-colors ${
						index === dock.selectedRouteIndex
							? "border-primary/40 bg-background shadow-sm"
							: "border-border/50 bg-background/70 hover:border-border hover:bg-background"
					}`}
					aria-pressed={index === dock.selectedRouteIndex}
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
							{#if index === dock.selectedRouteIndex}
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

{#if dock.activeRoute && dock.alternativeInfoMessage}
	<div
		class="mt-3 rounded-lg border border-border/50 bg-secondary/10 px-3 py-2 text-sm text-muted-foreground"
		role="status"
	>
		{dock.alternativeInfoMessage}
	</div>
{/if}
