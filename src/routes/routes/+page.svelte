<script lang="ts">
	import { onMount } from "svelte";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		deleteSavedRoute,
		savedRoutesState,
		initSavedRoutes,
	} from "$lib/saved-routes.svelte";
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

	function handleDeleteSavedRoute(id: string) {
		deleteSavedRoute(id);
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
									</div>
									<h2 class="font-heading text-lg font-semibold tracking-tight text-foreground">
										{savedRoute.route.startLabel}
									</h2>
									<div class="flex items-center gap-2 text-sm text-muted-foreground">
										<Route class="size-4 shrink-0" />
										<span>to</span>
										<span class="font-medium text-foreground">
											{savedRoute.route.destinationLabel}
										</span>
									</div>
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
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
										<span>{Math.round(savedRoute.route.ascendMeters).toLocaleString()} m up</span>
									</div>
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<Clock3 class="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
										<span>{formatDuration(savedRoute.route.durationMs)}</span>
									</div>
								</div>
							</div>

							<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
