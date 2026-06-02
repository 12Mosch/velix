<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { Effect } from "effect";
	import { onMount } from "svelte";
	import { api } from "../../../convex/_generated/api";
	import MapView from "$lib/components/map-view.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { getOptionalConvexClient } from "$lib/convex-client.svelte";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import { downloadRouteFit, downloadRouteGpx } from "$lib/route-export";
	import {
		formatRoundCourseTarget,
		formatWaypointSummary,
		getRoundCourseTarget,
		getRouteDurationText,
		getRouteLegText,
		getRouteTitle,
	} from "$lib/route-display";
	import {
		analyzeRouteClimbs,
		buildRouteClimbGeoJson,
		buildRouteGeoJson,
		buildRouteSurfaceGeoJson,
		getRouteElevationAnalysisPoints,
		type PlannedRoute,
		type RouteClimb,
		type RouteMapOverlay,
	} from "$lib/route-planning";
	import { addSavedRoute } from "$lib/saved-routes.svelte";
	import {
		deserializeRemoteSavedRoute,
		type RemoteSavedRoutePayload,
	} from "$lib/saved-routes-core";
	import {
		formatDistance,
		initUnitPreference,
	} from "$lib/unit-settings.svelte";

	type SharedRoutePayload = RemoteSavedRoutePayload & {
		createdAt: string;
	};

	const convexClient = Effect.runSync(getOptionalConvexClient());

	let sharedRoutePayload = $state<SharedRoutePayload | null>(null);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let exportError = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let loadRequestId = 0;
	const token = $derived(page.params.token ?? "");
	const savedRoute = $derived(
		sharedRoutePayload ? deserializeRemoteSavedRoute(sharedRoutePayload) : null,
	);
	const route = $derived(savedRoute?.route ?? null);
	const routeClimbs = $derived(
		route
			? Effect.runSync(
					Effect.gen(function* () {
						const points = yield* getRouteElevationAnalysisPoints(
							route.coordinates,
						);
						return yield* analyzeRouteClimbs(points);
					}),
				)
			: [],
	);
	const routeOverlays = $derived<RouteMapOverlay[]>(
		buildSharedRouteOverlays(route, routeClimbs),
	);

	onMount(() => {
		Effect.runSync(
			initUnitPreference().pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						console.error("Failed to initialize unit preference", error);
					}),
				),
			),
		);
	});

	$effect(() => {
		const shareToken = token;
		void loadSharedRoute(shareToken);
	});

	function buildSharedRouteOverlays(
		route: PlannedRoute | null,
		routeClimbs: RouteClimb[],
	): RouteMapOverlay[] {
		if (!route) {
			return [];
		}

		const baseGeoJson = Effect.runSync(buildRouteGeoJson(route));
		const surfaceGeoJson = Effect.runSync(buildRouteSurfaceGeoJson(route));
		const climbGeoJson = Effect.runSync(
			buildRouteClimbGeoJson(route, routeClimbs),
		);

		return [
			{
				id: "shared-route",
				geoJson: {
					...baseGeoJson,
					features: [
						...baseGeoJson.features,
						...surfaceGeoJson.features,
						...climbGeoJson.features,
					],
				},
				bounds: route.bounds,
				isSelected: true,
			},
		];
	}

	async function loadSharedRoute(shareToken: string) {
		const requestId = ++loadRequestId;

		if (!convexClient) {
			isLoading = false;
			loadError = "Shared route links need Convex to be configured.";
			sharedRoutePayload = null;
			return;
		}

		isLoading = true;
		loadError = null;
		sharedRoutePayload = null;

		try {
			const payload = await convexClient.query(
				api.sharedRoutes.getByToken,
				{ shareToken },
			);
			if (requestId === loadRequestId) {
				sharedRoutePayload = payload;
			}
		} catch (error) {
			if (requestId === loadRequestId) {
				loadError =
					error instanceof Error
						? `Could not load shared route: ${error.message}`
						: "Could not load shared route.";
			}
		} finally {
			if (requestId === loadRequestId) {
				isLoading = false;
			}
		}
	}

	async function handleSaveCopy(route: PlannedRoute) {
		saveError = null;

		try {
			const savedCopy = await addSavedRoute(route);
			await goto(`/?savedRoute=${savedCopy.id}`);
		} catch (error) {
			saveError =
				error instanceof Error
					? `Could not save route: ${error.message}`
					: "Could not save route.";
		}
	}

	function handleExportGpx(route: PlannedRoute) {
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

	function handleExportFit(route: PlannedRoute) {
		exportError = null;

		try {
			downloadRouteFit(route);
		} catch (error) {
			exportError =
				error instanceof Error
					? `Could not export FIT: ${error.message}`
					: "Could not export FIT.";
		}
	}
</script>

<div class="flex h-full min-h-svh w-full flex-col overflow-y-auto bg-background">
	{#if isLoading}
		<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 md:p-6">
			<Skeleton class="h-[48vh] min-h-80 w-full rounded-xl" />
			<div class="space-y-3">
				<Skeleton class="h-7 w-72 max-w-full rounded-md" />
				<Skeleton class="h-5 w-96 max-w-full rounded-md" />
				<div class="flex flex-wrap gap-2">
					<Skeleton class="h-9 w-24 rounded-md" />
					<Skeleton class="h-9 w-24 rounded-md" />
					<Skeleton class="h-9 w-24 rounded-md" />
				</div>
			</div>
		</div>
	{:else if loadError || !route}
		<div class="mx-auto flex w-full max-w-2xl flex-1 items-center p-4 md:p-6">
			<div class="rounded-xl border border-border bg-background p-6 shadow-lg md:p-8">
				<div class="flex flex-col items-start gap-4">
					<Badge variant="secondary">Shared route</Badge>
					<div class="space-y-1.5">
						<h1 class="font-heading text-xl font-semibold tracking-tight text-foreground">
							Route not found
						</h1>
						<p class="text-sm leading-6 text-muted-foreground">
							{loadError ?? "This shared route link is invalid or no longer available."}
						</p>
					</div>
					<Button href="/">Open route planner</Button>
				</div>
			</div>
		</div>
	{:else}
		<section class="relative h-[52vh] min-h-96 w-full border-b border-border">
			<MapView
				ariaLabel="Shared route map"
				routeOverlays={routeOverlays}
				plannedRoute={route}
				routeMode={route.mode}
				manualEditingEnabled={false}
				fitBounds={route.bounds}
			/>
		</section>

		<section class="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:p-6">
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div class="min-w-0 space-y-2">
					<div class="flex flex-wrap items-center gap-2">
						<Badge variant="secondary">Public snapshot</Badge>
						{#if sharedRoutePayload}
							<span class="text-xs text-muted-foreground">
								Created {new Date(sharedRoutePayload.createdAt).toLocaleString(undefined, {
									dateStyle: "medium",
									timeStyle: "short",
								})}
							</span>
						{/if}
					</div>
					<h1 class="font-heading text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
						{getRouteTitle(route)}
					</h1>
					<p class="text-sm text-muted-foreground">{getRouteLegText(route)}</p>
					{#if formatWaypointSummary(route.waypoints)}
						<p class="text-sm text-muted-foreground">
							{formatWaypointSummary(route.waypoints)}
						</p>
					{/if}
				</div>

				<div class="flex shrink-0 flex-wrap gap-2">
					<Button variant="outline" onclick={() => handleSaveCopy(route)}>
						Save a copy
					</Button>
					<Button variant="outline" onclick={() => handleExportGpx(route)}>
						Export GPX
					</Button>
					<Button variant="outline" onclick={() => handleExportFit(route)}>
						Export FIT
					</Button>
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

			{#if saveError}
				<div
					class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
					role="alert"
				>
					{saveError}
				</div>
			{/if}

			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-lg border border-border bg-secondary/30 p-3">
					<div class="text-xs text-muted-foreground">Distance</div>
					<div class="font-heading text-lg font-semibold">{formatDistance(route.distanceMeters)}</div>
				</div>
				<div class="rounded-lg border border-border bg-secondary/30 p-3">
					<div class="text-xs text-muted-foreground">Duration</div>
					<div class="font-heading text-lg font-semibold">{getRouteDurationText(route)}</div>
				</div>
				<div class="rounded-lg border border-border bg-secondary/30 p-3">
					<div class="text-xs text-muted-foreground">Ascent</div>
					<div class="font-heading text-lg font-semibold">
						{Math.round(route.ascendMeters).toLocaleString()} m
					</div>
				</div>
				<div class="rounded-lg border border-border bg-secondary/30 p-3">
					<div class="text-xs text-muted-foreground">Descent</div>
					<div class="font-heading text-lg font-semibold">
						{Math.round(route.descendMeters).toLocaleString()} m
					</div>
				</div>
			</div>

			{#if route.mode === "round_course" && getRoundCourseTarget(route)}
				<div class="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
					Round-course target:
					<span class="font-medium text-foreground">
						{formatRoundCourseTarget(getRoundCourseTarget(route))}
					</span>
				</div>
			{/if}
		</section>
	{/if}
</div>
