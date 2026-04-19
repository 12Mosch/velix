<script lang="ts">
	import { onMount } from "svelte";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { useSidebar } from "$lib/components/ui/sidebar/index.js";
	import MapView from "$lib/components/map-view.svelte";
	import { getBasemapById } from "$lib/map/basemaps";
	import { mapStylePreference } from "$lib/map-style-settings.svelte";
	import {
		addSavedRoute,
		deleteSavedRoute,
		getSavedRouteById,
		initSavedRoutes,
		isPlannedRoute,
	} from "$lib/saved-routes.svelte";
	import {
		buildRouteGeoJson,
		getSurfaceMix,
		sampleElevationProfile,
		type PlannedRoute,
		type RouteApiError,
		type RouteApiSuccess,
	} from "$lib/route-planning";
	import {
		ArrowDown,
		ArrowUp,
		Check,
		ChevronDown,
		ChevronUp,
		MapPin,
		MountainSnow,
		Navigation,
		Plus,
		Route,
		ShieldCheck,
		TrendingDown,
		TrendingUp,
		Wind,
		X,
	} from "lucide-svelte";

	type RouteField = "startQuery" | "destinationQuery";

	const chartW = 800;
	const padY = 5;
	const maxRoutePoints = 5;
	const maxWaypoints = maxRoutePoints - 2;
	const sidebar = useSidebar();

	let routeAnalysisOpen = $state(false);
	let startQuery = $state("");
	let waypointQueries = $state<string[]>([]);
	let destinationQuery = $state("");
	let routeRequestError = $state<string | null>(null);
	let fieldErrors = $state<NonNullable<RouteApiError["fieldErrors"]>>({});
	let isRouting = $state(false);
	let activeRoute = $state<PlannedRoute | null>(null);
	let activeSavedRouteId = $state<string | null>(null);
	let isActiveRouteSaved = $state(false);
	let clientFetch = $state<typeof window.fetch | null>(null);

	const selectedBasemap = $derived(
		mapStylePreference.selectedBasemapId
			? getBasemapById(mapStylePreference.selectedBasemapId)
			: null,
	);
	const routeGeoJson = $derived(activeRoute ? buildRouteGeoJson(activeRoute) : null);
	const surfaceMix = $derived(activeRoute ? getSurfaceMix(activeRoute) : []);
	const elevationSamples = $derived(activeRoute ? sampleElevationProfile(activeRoute.coordinates) : []);
	const chartH = $derived(routeAnalysisOpen ? 72 : 44);
	const elevMin = $derived(
		elevationSamples.length > 0 ? Math.min(...elevationSamples) : 0,
	);
	const elevMax = $derived(
		elevationSamples.length > 0 ? Math.max(...elevationSamples) : 0,
	);
	const elevRange = $derived(Math.max(elevMax - elevMin, 1));
	const linePoints = $derived(
		elevationSamples
			.map((meters, index) => {
				const x =
					elevationSamples.length > 1
						? (index / (elevationSamples.length - 1)) * chartW
						: chartW / 2;
				const y = elevY(meters, chartH, padY);
				return `${x},${y}`;
			})
			.join(" "),
	);
	const areaD = $derived(
		linePoints
			? `M 0,${chartH} L ${linePoints.replaceAll(" ", " L ")} L ${chartW},${chartH} Z`
			: "",
	);
	const distanceTickLabels = $derived(
		activeRoute
			? [
					formatDistance(activeRoute.distanceMeters * 0.25),
					formatDistance(activeRoute.distanceMeters * 0.5),
					formatDistance(activeRoute.distanceMeters * 0.75),
					formatDistance(activeRoute.distanceMeters),
				]
			: [],
	);

	$effect(() => {
		if (!activeRoute && routeAnalysisOpen) {
			routeAnalysisOpen = false;
		}
	});

	onMount(() => {
		clientFetch = window.fetch.bind(window);
		initSavedRoutes();
		restoreSavedRouteFromLocation();
	});

	function restoreSavedRouteFromLocation() {
		const savedRouteId = new URLSearchParams(window.location.search).get("savedRoute");
		const savedRoute = getSavedRouteById(savedRouteId);

		if (!savedRoute) {
			return;
		}

		if (!isPlannedRoute(savedRoute.route)) {
			return;
		}

		activeRoute = savedRoute.route;
		startQuery = savedRoute.route.startLabel;
		waypointQueries = savedRoute.route.waypoints.map((waypoint) => waypoint.label);
		destinationQuery = savedRoute.route.destinationLabel;
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
		routeRequestError = null;
		fieldErrors = {};
	}

	function elevY(meters: number, height: number, pad: number): number {
		const normalized = (meters - elevMin) / elevRange;
		return pad + (1 - normalized) * (height - pad * 2);
	}

	function formatDistance(meters: number): string {
		return `${(meters / 1000).toFixed(1)} km`;
	}

	function formatElevation(meters: number): string {
		return `${Math.round(meters).toLocaleString()} m`;
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

	function updateField(field: RouteField, value: string) {
		if (field === "startQuery") {
			startQuery = value;
		} else {
			destinationQuery = value;
		}

		if (fieldErrors[field]) {
			fieldErrors = {
				...fieldErrors,
				[field]: undefined,
			};
		}

		if (routeRequestError) {
			routeRequestError = null;
		}
	}

	function getWaypointError(index: number) {
		return fieldErrors.waypointQueries?.[index] || "";
	}

	function clearWaypointError(index: number) {
		if (!fieldErrors.waypointQueries?.[index]) {
			return;
		}

		fieldErrors = {
			...fieldErrors,
			waypointQueries: waypointQueries.map((_, waypointIndex) =>
				waypointIndex === index ? "" : fieldErrors.waypointQueries?.[waypointIndex] || "",
			),
		};
	}

	function updateWaypoint(index: number, value: string) {
		waypointQueries = waypointQueries.map((waypoint, waypointIndex) =>
			waypointIndex === index ? value : waypoint,
		);
		clearWaypointError(index);

		if (routeRequestError) {
			routeRequestError = null;
		}
	}

	function addWaypoint() {
		if (waypointQueries.length >= maxWaypoints) {
			return;
		}

		waypointQueries = [...waypointQueries, ""];
		fieldErrors = {
			...fieldErrors,
			waypointQueries: [...(fieldErrors.waypointQueries ?? []), ""],
		};

		if (routeRequestError) {
			routeRequestError = null;
		}
	}

	function removeWaypoint(index: number) {
		waypointQueries = waypointQueries.filter((_, waypointIndex) => waypointIndex !== index);
		fieldErrors = {
			...fieldErrors,
			waypointQueries: (fieldErrors.waypointQueries ?? []).filter(
				(_, waypointIndex) => waypointIndex !== index,
			),
		};

		if (routeRequestError) {
			routeRequestError = null;
		}
	}

	function moveWaypoint(index: number, direction: -1 | 1) {
		const nextIndex = index + direction;

		if (nextIndex < 0 || nextIndex >= waypointQueries.length) {
			return;
		}

		const nextWaypointQueries = [...waypointQueries];
		[nextWaypointQueries[index], nextWaypointQueries[nextIndex]] = [
			nextWaypointQueries[nextIndex] ?? "",
			nextWaypointQueries[index] ?? "",
		];
		waypointQueries = nextWaypointQueries;

		const nextWaypointErrors = [...(fieldErrors.waypointQueries ?? [])];
		[nextWaypointErrors[index], nextWaypointErrors[nextIndex]] = [
			nextWaypointErrors[nextIndex] ?? "",
			nextWaypointErrors[index] ?? "",
		];
		fieldErrors = {
			...fieldErrors,
			waypointQueries: nextWaypointErrors,
		};

		if (routeRequestError) {
			routeRequestError = null;
		}
	}

	async function handleGenerateRoute(event: SubmitEvent) {
		event.preventDefault();

		if (isRouting) {
			return;
		}

		if (!clientFetch) {
			routeRequestError = "Route requests are only available after the page has mounted.";
			return;
		}

		isRouting = true;
		activeSavedRouteId = null;
		isActiveRouteSaved = false;
		routeRequestError = null;
		fieldErrors = {};

		try {
			const response = await clientFetch("/api/route", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					startQuery,
					waypointQueries,
					destinationQuery,
				}),
			});

			if (!response.ok) {
				const errorPayload = (await response.json()) as RouteApiError;
				fieldErrors = errorPayload.fieldErrors ?? {};
				routeRequestError = errorPayload.error;
				return;
			}

			const payload = (await response.json()) as RouteApiSuccess;
			activeRoute = payload.route;
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			routeRequestError = null;
		} catch (error) {
			console.error("Failed to generate route", error);
			routeRequestError = "The route request failed before we heard back from GraphHopper.";
		} finally {
			isRouting = false;
		}
	}

	function handleSaveDraft() {
		if (!activeRoute) {
			return;
		}

		if (isActiveRouteSaved && activeSavedRouteId) {
			deleteSavedRoute(activeSavedRouteId);
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			return;
		}

		const savedRoute = addSavedRoute(activeRoute);
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
	}
</script>

<div class="relative flex h-full w-full flex-col overflow-hidden bg-background">
	<MapView routeGeoJson={routeGeoJson} routeBounds={activeRoute?.bounds ?? null} />

	<div class="pointer-events-none absolute inset-0 z-20">
		{#if sidebar.isMobile}
			<div class="pointer-events-auto absolute left-4 top-4">
				<Sidebar.Trigger
					class="size-9 rounded-lg border border-border/60 bg-background/85 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 focus-visible:ring-offset-0"
				/>
			</div>
		{/if}
		<div class="pointer-events-auto absolute right-4 top-4 md:right-5 md:top-5">
			<Button
				variant="ghost"
				size="icon"
				class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground"
				aria-label="Wind and conditions"
			>
				<Wind class="size-4" />
			</Button>
		</div>
	</div>

	<div
		class="pointer-events-none relative z-10 flex h-full min-h-0 w-full flex-col gap-3 p-4 md:p-5"
	>
		<div class="flex min-h-0 min-w-0 flex-1 gap-5 md:gap-6">
			<div
				class="pointer-events-auto flex w-full max-w-[340px] flex-col gap-3 max-md:ml-11 max-md:mt-10 md:ml-0 md:mt-4"
			>
				<form
					class="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg"
					onsubmit={handleGenerateRoute}
				>
					<div class="flex items-center justify-between gap-3">
						<h2 class="text-base font-semibold tracking-tight md:text-lg">Route Builder</h2>
						<Badge
							variant="secondary"
							class="h-5 shrink-0 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
						>
							Road bike bias
						</Badge>
					</div>

					<div class="flex min-w-0 flex-1 flex-col gap-3">
						<div class="space-y-2">
							<label
								for="start-point"
								class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
							>
								Start
							</label>
							<div class="relative">
								<MapPin
									class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									id="start-point"
									value={startQuery}
									placeholder="Enter starting point..."
									class="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
									aria-invalid={fieldErrors.startQuery ? "true" : undefined}
									oninput={(event) =>
										updateField(
											"startQuery",
											(event.currentTarget as HTMLInputElement).value,
										)}
								/>
							</div>
							{#if fieldErrors.startQuery}
								<p class="text-xs font-medium text-destructive">{fieldErrors.startQuery}</p>
							{/if}
						</div>

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
									disabled={waypointQueries.length >= maxWaypoints}
									onclick={addWaypoint}
								>
									<Plus class="size-3.5" />
									Add waypoint
								</Button>
							</div>

							{#if waypointQueries.length > 0}
								<div class="space-y-2">
									{#each waypointQueries as waypointQuery, index (`waypoint-${index}`)}
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
													<div class="relative">
														<MapPin
															class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-amber-600 dark:text-amber-300"
														/>
														<Input
															id={`waypoint-${index}`}
															value={waypointQuery}
															placeholder="Add a stop..."
															class="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
															aria-invalid={getWaypointError(index) ? "true" : undefined}
															oninput={(event) =>
																updateWaypoint(
																	index,
																	(event.currentTarget as HTMLInputElement).value,
																)}
														/>
													</div>
													{#if getWaypointError(index)}
														<p class="text-xs font-medium text-destructive">
															{getWaypointError(index)}
														</p>
													{/if}
												</div>
											</div>
											<div class="mt-2 flex flex-wrap justify-end gap-1.5">
												<Button
													variant="outline"
													size="sm"
													type="button"
													class="gap-1"
													disabled={index === 0}
													onclick={() => moveWaypoint(index, -1)}
												>
													<ArrowUp class="size-3.5" />
													Move up
												</Button>
												<Button
													variant="outline"
													size="sm"
													type="button"
													class="gap-1"
													disabled={index === waypointQueries.length - 1}
													onclick={() => moveWaypoint(index, 1)}
												>
													<ArrowDown class="size-3.5" />
													Move down
												</Button>
												<Button
													variant="ghost"
													size="sm"
													type="button"
													class="gap-1 text-muted-foreground hover:text-foreground"
													onclick={() => removeWaypoint(index)}
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

						<div class="space-y-2">
							<label
								for="destination"
								class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
							>
								Destination
							</label>
							<div class="relative">
								<Navigation
									class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary"
								/>
								<Input
									id="destination"
									value={destinationQuery}
									placeholder="Destination..."
									class="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
									aria-invalid={fieldErrors.destinationQuery ? "true" : undefined}
									oninput={(event) =>
										updateField(
											"destinationQuery",
											(event.currentTarget as HTMLInputElement).value,
										)}
								/>
							</div>
							{#if fieldErrors.destinationQuery}
								<p class="text-xs font-medium text-destructive">
									{fieldErrors.destinationQuery}
								</p>
							{/if}
						</div>
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
								Paved and smooth
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
						</div>
					</div>

					{#if routeRequestError}
						<div
							class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
							role="alert"
						>
							{routeRequestError}
						</div>
					{/if}

					<Button size="lg" type="submit" class="mt-1 w-full font-semibold shadow-sm">
						{isRouting ? "Calculating route..." : "Generate Route"}
					</Button>
				</form>
			</div>
		</div>

		<div class="pointer-events-auto relative w-full shrink-0">
			{#if selectedBasemap}
				<div
					class="absolute bottom-[calc(100%+0.5rem)] right-0 z-20 max-w-[23rem] rounded-md border border-white/10 bg-black/42 px-2 py-1 text-[10px] leading-none text-white/58 shadow-sm backdrop-blur-[6px] supports-[backdrop-filter]:bg-black/34 md:text-[11px]"
				>
					<span class="mr-1 uppercase tracking-wide text-white/42">Basemap</span>
					{@html selectedBasemap.attributionHtml}
				</div>
			{/if}

			<div
				class="rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm md:p-3.5"
			>
				<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
					{#if activeRoute}
						<div
							class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums sm:text-sm"
						>
							<span class="font-semibold text-foreground">
								<span class="font-heading text-base sm:text-lg">
									{formatDistance(activeRoute.distanceMeters).replace(" km", "")}
								</span>
								km
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1">
								<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
								<span class="font-semibold text-foreground">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(activeRoute.ascendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
							<span class="flex items-center gap-1 text-sky-600 dark:text-sky-400">
								<TrendingDown class="size-3.5 shrink-0 opacity-80" />
								<span class="font-semibold">
									<span class="font-heading text-base sm:text-lg">
										{Math.round(activeRoute.descendMeters).toLocaleString()}
									</span>
									m
								</span>
							</span>
							<span class="hidden text-border md:inline" aria-hidden="true">·</span>
							<span class="font-semibold text-foreground">
								<span class="font-heading text-base sm:text-lg">
									{formatDuration(activeRoute.durationMs).replace(" h", "")}
								</span>
								{formatDuration(activeRoute.durationMs).endsWith(" h") ? " h" : ""}
							</span>
						</div>
					{:else}
						<div class="flex min-w-0 flex-col gap-1">
							<span class="text-sm font-semibold text-foreground">
								{isRouting
									? "Calculating the road-bike route..."
									: "Generate a route to see live distance, climbing, and elevation."}
							</span>
							<span class="text-xs text-muted-foreground">
								{isRouting
									? "GraphHopper is resolving locations and building the route."
									: "The map overlay and summary will update once a route is found."}
							</span>
						</div>
					{/if}

					<div class="flex shrink-0 flex-col items-end gap-1.5">
						<div class="flex flex-wrap items-center justify-end gap-2">
							<Button
								variant={isActiveRouteSaved ? "secondary" : "outline"}
								size="sm"
								class="gap-1 font-semibold"
								disabled={!activeRoute}
								onclick={handleSaveDraft}
							>
								{#if isActiveRouteSaved}
									<Check class="size-3.5" />
									Saved
								{:else}
									Save Draft
								{/if}
							</Button>
							<Button size="sm" class="font-semibold" disabled={!activeRoute}>
								Send to Wahoo
							</Button>
							<Button
								variant="outline"
								size="sm"
								class="gap-1 font-semibold"
								disabled={!activeRoute}
								onclick={() => (routeAnalysisOpen = !routeAnalysisOpen)}
								aria-expanded={activeRoute ? routeAnalysisOpen : false}
								aria-controls="route-analysis-panel"
							>
								{routeAnalysisOpen ? "Less" : "Analysis"}
								{#if routeAnalysisOpen}
									<ChevronUp class="size-3.5 opacity-70" />
								{:else}
									<ChevronDown class="size-3.5 opacity-70" />
								{/if}
							</Button>
						</div>
					</div>
				</div>

				<div class="mt-2.5 min-w-0 rounded-md border border-border/40 bg-secondary/10">
					<div
						class="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-1.5"
					>
						<div
							class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/75"
						>
							<TrendingUp class="size-3 shrink-0" />
							Elevation
						</div>
						{#if elevationSamples.length > 0}
							<div
								class="flex flex-wrap items-center justify-end gap-x-2 gap-y-0 text-xs tabular-nums text-muted-foreground"
							>
								<span>min {formatElevation(elevMin)}</span>
								<span class="text-border">|</span>
								<span>max {formatElevation(elevMax)}</span>
								<span class="text-border">|</span>
								<span>delta {formatElevation(elevMax - elevMin)}</span>
							</div>
						{:else}
							<span class="text-xs text-muted-foreground">No route profile yet</span>
						{/if}
					</div>
					<div class="px-2 pb-1.5 pt-1">
						{#if elevationSamples.length > 0}
							<svg
								class="block w-full"
								viewBox="0 0 {chartW} {chartH}"
								preserveAspectRatio="none"
								role="img"
								aria-label="Elevation along route"
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
										y1={gridLine * chartH}
										x2={chartW}
										y2={gridLine * chartH}
										stroke="currentColor"
										class="text-border/40"
										stroke-width="1"
										vector-effect="non-scaling-stroke"
									/>
								{/each}
								<path d={areaD} fill="url(#elevFill)" class="text-emerald-500" />
								<polyline
									fill="none"
									stroke="rgb(16 185 129)"
									stroke-width="2.5"
									stroke-linejoin="round"
									stroke-linecap="round"
									points={linePoints}
									vector-effect="non-scaling-stroke"
								/>
							</svg>
							<div
								class="flex justify-between px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
							>
								<span>Start</span>
								<span class="hidden min-[480px]:inline">{distanceTickLabels[0]}</span>
								<span class="hidden min-[640px]:inline">{distanceTickLabels[1]}</span>
								<span class="hidden min-[900px]:inline">{distanceTickLabels[2]}</span>
								<span>{distanceTickLabels[3]}</span>
							</div>
						{:else}
							<div class="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
								Elevation and route profile will appear here after a route is generated.
							</div>
						{/if}
					</div>
				</div>

				{#if routeAnalysisOpen && activeRoute}
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
										Paved bias active
									</Badge>
								</div>

								<div class="space-y-2">
									<div class="flex items-center justify-between text-xs text-muted-foreground">
										<span class="flex items-center gap-1">
											<Route class="size-3" /> Surface mix
										</span>
									</div>
									{#if surfaceMix.length > 0}
										<div class="flex h-2 overflow-hidden rounded-full bg-secondary">
											{#each surfaceMix as surface}
												<div
													class="{surface.className} opacity-90"
													style="width: {surface.pct}%"
													title="{surface.label}: {surface.pct}%"
												></div>
											{/each}
										</div>
										<div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
											{#each surfaceMix as surface}
												<span class="flex items-center gap-1">
													<span class="size-1.5 rounded-full {surface.className}"></span>
													{surface.label} ({surface.pct}%)
												</span>
											{/each}
										</div>
									{:else}
										<p class="text-xs text-muted-foreground">
											Surface details were not available for this route.
										</p>
									{/if}
								</div>
							</div>

							<div class="grid grid-cols-1 gap-2.5 text-xs">
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Resolved start
									</div>
									<div class="font-medium text-foreground">{activeRoute.startLabel}</div>
								</div>
								{#if activeRoute.waypoints.length > 0}
									<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
										<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
											Resolved waypoints
										</div>
										<div class="space-y-1">
											{#each activeRoute.waypoints as waypoint, index}
												<div class="font-medium text-foreground">
													{index + 1}. {waypoint.label}
												</div>
											{/each}
										</div>
									</div>
								{/if}
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Resolved destination
									</div>
									<div class="font-medium text-foreground">{activeRoute.destinationLabel}</div>
								</div>
								<div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
									<div class="mb-1 font-semibold uppercase tracking-wide text-foreground/70">
										Routing profile
									</div>
									<div class="font-medium text-foreground">
										GraphHopper bike with road-bike friendly surface penalties.
									</div>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
