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
		buildRouteGeoJson,
		getSurfaceMix,
		sampleElevationProfile,
		type PlannedRoute,
		type RouteApiError,
		type RouteApiSuccess,
	} from "$lib/route-planning";
	import {
		ChevronDown,
		ChevronUp,
		MapPin,
		MountainSnow,
		Navigation,
		Route,
		ShieldCheck,
		TrendingDown,
		TrendingUp,
		Wind,
	} from "lucide-svelte";

	type RouteField = "startQuery" | "destinationQuery";

	const chartW = 800;
	const padY = 5;
	const sidebar = useSidebar();

	let routeAnalysisOpen = $state(false);
	let startQuery = $state("");
	let destinationQuery = $state("");
	let routeRequestError = $state<string | null>(null);
	let fieldErrors = $state<Partial<Record<RouteField, string>>>({});
	let isRouting = $state(false);
	let activeRoute = $state<PlannedRoute | null>(null);
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
	});

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
			routeRequestError = null;
		} catch (error) {
			console.error("Failed to generate route", error);
			routeRequestError = "The route request failed before we heard back from GraphHopper.";
		} finally {
			isRouting = false;
		}
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

					<div class="flex gap-3.5">
						<div class="flex w-[11px] shrink-0 flex-col items-center" aria-hidden="true">
							<div class="h-[calc(1.125rem+0.5rem+1.125rem-0.25rem)] shrink-0"></div>
							<div
								class="size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_2px_var(--color-background)] ring-1 ring-primary/30"
							></div>
							<div class="h-2.5 w-0.5 shrink-0 rounded-full bg-border/85"></div>
							<div class="flex flex-col items-center py-2">
								<div class="h-2 w-0.5 shrink-0 rounded-full bg-border/85"></div>
								<div
									class="my-1.5 size-1.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground/45 bg-background shadow-[0_0_0_2px_var(--color-background)]"
								></div>
								<div class="h-2 w-0.5 shrink-0 rounded-full bg-border/85"></div>
							</div>
							<div class="h-2.5 w-0.5 shrink-0 rounded-full bg-border/85"></div>
							<div class="h-[calc(1.125rem+0.5rem+1.125rem-0.25rem)] shrink-0"></div>
							<div
								class="size-2 shrink-0 rounded-full border-2 border-primary bg-background shadow-[0_0_0_2px_var(--color-background)] ring-1 ring-border/40"
							></div>
						</div>

						<div class="flex min-w-0 flex-1 flex-col">
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

							<div class="flex items-center py-2">
								<Button
									variant="ghost"
									size="sm"
									type="button"
									disabled
									class="h-8 w-full justify-start gap-2 pl-2 text-muted-foreground"
								>
									<span
										class="flex size-5 items-center justify-center rounded-md border border-dashed border-border/70 text-xs font-semibold leading-none text-muted-foreground"
										aria-hidden="true"
									>
										+
									</span>
									Waypoints next
								</Button>
							</div>

							<div class="space-y-2 pt-2.5">
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

					<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
						<Button variant="outline" size="sm" class="font-semibold" disabled={!activeRoute}>
							Save Draft
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
