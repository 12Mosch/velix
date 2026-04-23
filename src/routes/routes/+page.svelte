<script lang="ts">
	import { onMount } from "svelte";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { downloadRouteGpx } from "$lib/route-export";
	import {
		deleteSavedRoute,
		savedRoutesState,
		initSavedRoutes,
	} from "$lib/saved-routes.svelte";
	import {
		isImportedRoute,
		type PlannedRoute,
		type RoundCourseTarget,
	} from "$lib/route-planning";
	import {
		ArrowLeft,
		Bookmark,
		Clock3,
		MapPinned,
		MountainSnow,
		Route,
		Trash2,
	} from "lucide-svelte";

	onMount(() => {
		initSavedRoutes();
	});

	let exportError = $state<string | null>(null);

	function formatDistance(meters: number): string {
		return `${(meters / 1000).toFixed(1)} km`;
	}

	function formatDuration(durationMs: number): string {
		const totalMinutes = Math.round(durationMs / 60000);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;

		if (hours === 0) {
			return `${minutes} min`;
		}

		return `${hours}:${minutes.toString().padStart(2, "0")} h`;
	}

	function formatSavedAt(createdAt: string): string {
		return new Date(createdAt).toLocaleString(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		});
	}

	function formatWaypointSummary(
		waypoints: Array<{ label: string }>,
	): string | null {
		if (waypoints.length === 0) {
			return null;
		}

		return `Via: ${waypoints.map((waypoint) => waypoint.label).join(" -> ")}`;
	}

	function isRoundCourseRoute(route: { mode: string }) {
		return route.mode === "round_course";
	}

	function getRoundCourseTarget(route: PlannedRoute): RoundCourseTarget | null {
		if (route.mode !== "round_course") {
			return null;
		}

		if (route.roundCourseTarget) {
			return route.roundCourseTarget;
		}

		if (
			typeof route.requestedDistanceMeters === "number" &&
			Number.isFinite(route.requestedDistanceMeters)
		) {
			return {
				kind: "distance",
				distanceMeters: route.requestedDistanceMeters,
			};
		}

		return null;
	}

	function formatRoundCourseTarget(target: RoundCourseTarget | null): string {
		if (!target) {
			return "";
		}

		if (target.kind === "distance") {
			return formatDistance(target.distanceMeters);
		}

		if (target.kind === "duration") {
			return formatDuration(target.durationMs);
		}

		return `${Math.round(target.ascendMeters).toLocaleString()} m up`;
	}

	function getRouteDurationText(route: PlannedRoute): string {
		if (isImportedRoute(route) && !route.source.hasDuration) {
			return "Time unavailable";
		}

		return formatDuration(route.durationMs);
	}

	function handleDeleteSavedRoute(id: string) {
		deleteSavedRoute(id);
	}

	function handleExportSavedRoute(route: PlannedRoute) {
		exportError = null;

		try {
			downloadRouteGpx(route);
		} catch (error) {
			exportError =
				error instanceof Error
					? `Could not export GPX: ${error.message}`
					: "Could not export GPX.";
		}
	}
</script>

<div class="relative h-full w-full overflow-y-auto bg-background">
	<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
		<div class="flex items-center gap-3">
			<Button variant="ghost" size="icon" class="size-8 shrink-0" href="/">
				<ArrowLeft class="size-4" />
			</Button>
			<div class="flex min-w-0 flex-col gap-0.5">
				<h1 class="font-heading text-lg font-semibold tracking-tight md:text-xl">My routes</h1>
			</div>
		</div>

		{#if exportError}
			<div
				class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{exportError}
			</div>
		{/if}

		{#if savedRoutesState.savedRoutes.length === 0}
			<div class="rounded-xl border border-border bg-background p-6 shadow-lg md:p-8">
				<div class="flex flex-col items-start gap-4">
					<div class="rounded-lg border border-primary/20 bg-primary/10 p-3 text-primary">
						<Bookmark class="size-5" />
					</div>
					<div class="space-y-1.5">
						<h2 class="font-heading text-lg font-semibold tracking-tight text-foreground">
							No saved routes yet
						</h2>
						<p class="max-w-xl text-sm leading-6 text-muted-foreground">
							Generate a route in the planner and use the Save Draft button to keep it here.
						</p>
					</div>
					<Button href="/">Open route planner</Button>
				</div>
			</div>
		{:else}
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					<Badge
						variant="secondary"
						class="h-6 border-primary/20 bg-primary/10 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
					>
						{savedRoutesState.savedRoutes.length}
						{savedRoutesState.savedRoutes.length === 1 ? " route" : " routes"}
					</Badge>
				</div>
			</div>

			<div class="grid gap-3">
				{#each savedRoutesState.savedRoutes as savedRoute (savedRoute.id)}
					<div class="rounded-xl border border-border bg-background p-4 shadow-lg md:p-5">
						<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
							<div class="min-w-0 flex-1 space-y-3">
								<div class="space-y-1">
									<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span>Saved {formatSavedAt(savedRoute.createdAt)}</span>
										{#if isRoundCourseRoute(savedRoute.route)}
											<Badge
												variant="secondary"
												class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
											>
												Round course
											</Badge>
										{/if}
										{#if isImportedRoute(savedRoute.route)}
											<Badge
												variant="secondary"
												class="h-5 border-sky-500/20 bg-sky-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
											>
												Imported GPX
											</Badge>
										{/if}
									</div>
									<h2 class="font-heading text-lg font-semibold tracking-tight text-foreground">
										{savedRoute.route.startLabel}
									</h2>
									{#if isRoundCourseRoute(savedRoute.route)}
										<div class="flex items-center gap-2 text-sm text-muted-foreground">
											<Route class="size-4 shrink-0" />
											<span>Returns to start</span>
										</div>
									{:else}
										<div class="flex items-center gap-2 text-sm text-muted-foreground">
											<Route class="size-4 shrink-0" />
											<span>to</span>
											<span class="font-medium text-foreground">
												{savedRoute.route.destinationLabel}
											</span>
										</div>
									{/if}
									{#if formatWaypointSummary(savedRoute.route.waypoints)}
										<p class="text-xs text-muted-foreground">
											{formatWaypointSummary(savedRoute.route.waypoints)}
										</p>
									{/if}
								</div>

								<div class="flex flex-wrap gap-2.5 text-xs text-muted-foreground sm:text-sm">
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<MapPinned class="size-3.5 shrink-0 text-primary" />
										<span>{formatDistance(savedRoute.route.distanceMeters)}</span>
									</div>
									{#if isRoundCourseRoute(savedRoute.route) && getRoundCourseTarget(savedRoute.route)}
										<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
											<Route class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
											<span>Target {formatRoundCourseTarget(getRoundCourseTarget(savedRoute.route))}</span>
										</div>
									{/if}
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
										<span>{Math.round(savedRoute.route.ascendMeters).toLocaleString()} m up</span>
									</div>
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<Clock3 class="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
										<span>{getRouteDurationText(savedRoute.route)}</span>
									</div>
								</div>
							</div>

							<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
								<Button
									variant="outline"
									class="font-semibold"
									onclick={() => handleExportSavedRoute(savedRoute.route)}
								>
									Export GPX
								</Button>
								<Button
									variant="outline"
									class="gap-1 font-semibold text-destructive hover:text-destructive"
									onclick={() => handleDeleteSavedRoute(savedRoute.id)}
								>
									<Trash2 class="size-3.5" />
									Delete
								</Button>
								<Button href={`/?savedRoute=${savedRoute.id}`} class="font-semibold">
									Open route
								</Button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
