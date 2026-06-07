<script lang="ts">
	import {
		ArrowLeft,
		Bookmark,
		Clock3,
		Copy,
		History,
		Link,
		MapPinned,
		MountainSnow,
		Route,
		RotateCcw,
		Search,
		Trash2,
		X,
	} from "@lucide/svelte";
	import { env } from "$env/dynamic/public";
	import { Cause, Data, Effect } from "effect";
	import { onMount } from "svelte";
	import { api } from "../../convex/_generated/api";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { getOptionalConvexClient } from "$lib/convex-client.svelte";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import {
		downloadRouteFitEffect,
		downloadRouteGpxEffect,
	} from "$lib/route-export";
	import { isImportedRoute, type PlannedRoute } from "$lib/route-planning";
	import {
		formatRoundCourseTarget,
		formatWaypointSummary,
		getRoundCourseTarget,
		getRouteDurationText,
		getRouteLegText,
		isOutAndBackRoute,
		isRoundCourseRoute,
	} from "$lib/route-display";
	import {
		addSavedRoute,
		deleteSavedRoute,
		initSavedRoutes,
		listSavedRouteVersions,
		restoreLatestSavedRouteVersion,
		type SavedRoute,
		type SavedRouteVersion,
		savedRoutesState,
	} from "$lib/saved-routes.svelte";
	import { serializeSavedRouteForRemote } from "$lib/saved-routes-core";
	import {
		buildShareUrl,
		copyTextToClipboardEffect,
		generateShareTokenEffect,
	} from "$lib/shared-routes";
	import {
		formatDistance,
		initUnitPreference,
		parseDistanceInputToMeters,
		unitPreference,
	} from "$lib/unit-settings.svelte";

	const convexClient = Effect.runSync(getOptionalConvexClient());

	class ShareSavedRouteMutationError extends Data.TaggedError(
		"ShareSavedRouteMutationError",
	)<{
		readonly cause: unknown;
	}> {}

	function formatShareFailure(error: unknown): string {
		const cause =
			typeof error === "object" && error !== null && "cause" in error
				? (error as { cause?: unknown }).cause
				: error;

		if (cause instanceof Error) {
			return `Could not share route: ${cause.message}`;
		}

		return error instanceof Error
			? `Could not share route: ${error.message}`
			: "Could not share route.";
	}

	function formatUnexpectedExportError(cause: Cause.Cause<unknown>): string {
		const error = Cause.squash(cause);
		return error instanceof Error ? error.message : "unexpected error";
	}

	type SavedRouteSearchTextCacheEntry = {
		cacheKey: string;
		searchText: string;
	};

	onMount(() => {
		Effect.runSync(
			initUnitPreference().pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						console.error("Failed to initialize unit preference", error);
						return unitPreference.selectedDistanceUnit;
					}),
				),
			),
		);
		void initSavedRoutes();
	});

	let exportError = $state<string | null>(null);
	let searchQuery = $state("");
	let minDistanceInput = $state("");
	let maxDistanceInput = $state("");
	let minElevationInput = $state("");
	let maxElevationInput = $state("");
	let sharingRouteId = $state<string | null>(null);
	let shareError = $state<string | null>(null);
	let pendingShareUrl = $state<string | null>(null);
	let copiedShareRouteId = $state<string | null>(null);
	let restoringRoutes = $state<Set<string>>(new Set());
	let restoreMessages = $state<Record<string, string>>({});
	let expandedHistoryRouteId = $state<string | null>(null);
	let loadingHistoryRoutes = $state<Set<string>>(new Set());
	let savedRouteVersionsByRouteId = $state<Record<string, SavedRouteVersion[]>>(
		{},
	);
	let historyErrors = $state<Record<string, string>>({});
	const savedRouteSearchTextCache = new Map<
		string,
		SavedRouteSearchTextCacheEntry
	>();
	const isLoadingSyncedRoutes = $derived(
		savedRoutesState.authStatus === "signedIn" &&
			!savedRoutesState.remoteReady &&
			!savedRoutesState.syncError &&
			savedRoutesState.savedRoutes.length === 0,
	);
	const normalizedSearchQuery = $derived(normalizeSearchText(searchQuery));
	const minDistanceMeters = $derived(
		parseSavedRouteDistanceFilter(minDistanceInput),
	);
	const maxDistanceMeters = $derived(
		parseSavedRouteDistanceFilter(maxDistanceInput),
	);
	const minElevationMeters = $derived(
		parseSavedRouteElevationFilter(minElevationInput),
	);
	const maxElevationMeters = $derived(
		parseSavedRouteElevationFilter(maxElevationInput),
	);
	const hasActiveFilters = $derived(
		Boolean(
			minDistanceInput.trim() ||
				maxDistanceInput.trim() ||
				minElevationInput.trim() ||
				maxElevationInput.trim(),
		),
	);
	const filteredSavedRoutes = $derived(
		savedRoutesState.savedRoutes.filter((savedRoute) => {
			const matchesSearch =
				!normalizedSearchQuery ||
				getSavedRouteSearchText(savedRoute).includes(normalizedSearchQuery);

			return (
				matchesSearch &&
				matchesDistanceFilters(savedRoute) &&
				matchesElevationFilters(savedRoute)
			);
		}),
	);

	$effect(() => {
		const currentSavedRouteIds = new Set(
			savedRoutesState.savedRoutes.map((savedRoute) => savedRoute.id),
		);

		for (const cachedSavedRouteId of savedRouteSearchTextCache.keys()) {
			if (!currentSavedRouteIds.has(cachedSavedRouteId)) {
				savedRouteSearchTextCache.delete(cachedSavedRouteId);
			}
		}
	});

	function formatSavedAt(createdAt: string): string {
		return new Date(createdAt).toLocaleString(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		});
	}

	function normalizeSearchText(value: string): string {
		return value.trim().toLocaleLowerCase();
	}

	function parseSavedRouteDistanceFilter(value: string): number | null {
		return parseDistanceInputToMeters(value);
	}

	function parseSavedRouteElevationFilter(value: string): number | null {
		const trimmedValue = value.trim();
		if (!trimmedValue) return null;

		const numericValue = Number(trimmedValue.replace(",", "."));
		if (!Number.isFinite(numericValue) || numericValue < 0) return null;

		return numericValue;
	}

	function getRouteTypeBadges(route: PlannedRoute): string[] {
		const badges: string[] = [];

		if (isRoundCourseRoute(route)) {
			badges.push("Round course");
		}

		if (isOutAndBackRoute(route)) {
			badges.push("Out and back");
		}

		if (isImportedRoute(route)) {
			badges.push("Imported GPX");
		}

		return badges;
	}

	function buildSavedRouteSearchText(savedRoute: SavedRoute): string {
		const route = savedRoute.route;
		const roundCourseTarget = getRoundCourseTarget(route);
		const waypointSummary = formatWaypointSummary(route.waypoints);

		return [
			`Saved ${formatSavedAt(savedRoute.createdAt)}`,
			...getRouteTypeBadges(route),
			route.startLabel,
			route.destinationLabel,
			getRouteLegText(route),
			waypointSummary,
			formatDistance(route.distanceMeters),
			roundCourseTarget
				? `Target ${formatRoundCourseTarget(roundCourseTarget)}`
				: null,
			`${Math.round(route.ascendMeters).toLocaleString()} m up`,
			getRouteDurationText(route),
		]
			.filter((value): value is string => Boolean(value))
			.join(" ");
	}

	function getSavedRouteSearchCacheKey(savedRoute: SavedRoute): string {
		const route = savedRoute.route;
		const waypointLabels = route.waypoints.map((waypoint) => waypoint.label).join("|");
		const roundCourseTarget = route.roundCourseTarget
			? JSON.stringify(route.roundCourseTarget)
			: "";
		const importedDurationFlag = isImportedRoute(route)
			? String(route.source.hasDuration)
			: "";

		return [
			savedRoute.id,
			unitPreference.selectedDistanceUnit,
			savedRoute.createdAt,
			route.mode,
			route.startLabel,
			route.destinationLabel,
			String(route.distanceMeters),
			String(route.ascendMeters),
			String(route.durationMs),
			route.requestedDistanceMeters == null
				? ""
				: String(route.requestedDistanceMeters),
			roundCourseTarget,
			route.source.kind,
			importedDurationFlag,
			waypointLabels,
		].join(":");
	}

	function getSavedRouteSearchText(savedRoute: SavedRoute): string {
		const cacheKey = getSavedRouteSearchCacheKey(savedRoute);
		const cachedSearchText = savedRouteSearchTextCache.get(savedRoute.id);

		if (cachedSearchText?.cacheKey === cacheKey) {
			return cachedSearchText.searchText;
		}

		const normalizedSearchText = normalizeSearchText(
			buildSavedRouteSearchText(savedRoute),
		);
		savedRouteSearchTextCache.set(savedRoute.id, {
			cacheKey,
			searchText: normalizedSearchText,
		});
		return normalizedSearchText;
	}

	function clearSearch() {
		searchQuery = "";
	}

	function hasActiveSearchOrFilters(): boolean {
		return Boolean(normalizedSearchQuery || hasActiveFilters);
	}

	function clearFilters() {
		minDistanceInput = "";
		maxDistanceInput = "";
		minElevationInput = "";
		maxElevationInput = "";
	}

	function clearSearchAndFilters() {
		clearSearch();
		clearFilters();
	}

	function matchesDistanceFilters(savedRoute: SavedRoute): boolean {
		if (
			minDistanceMeters !== null &&
			maxDistanceMeters !== null &&
			minDistanceMeters > maxDistanceMeters
		) {
			return false;
		}

		const distanceMeters = savedRoute.route.distanceMeters;

		if (minDistanceMeters !== null && distanceMeters < minDistanceMeters) {
			return false;
		}

		if (maxDistanceMeters !== null && distanceMeters > maxDistanceMeters) {
			return false;
		}

		return true;
	}

	function matchesElevationFilters(savedRoute: SavedRoute): boolean {
		if (
			minElevationMeters !== null &&
			maxElevationMeters !== null &&
			minElevationMeters > maxElevationMeters
		) {
			return false;
		}

		const elevationMeters = savedRoute.route.ascendMeters;

		if (minElevationMeters !== null && elevationMeters < minElevationMeters) {
			return false;
		}

		if (maxElevationMeters !== null && elevationMeters > maxElevationMeters) {
			return false;
		}

		return true;
	}

	async function handleDeleteSavedRoute(id: string) {
		await deleteSavedRoute(id);
	}

	async function handleDuplicateSavedRoute(route: PlannedRoute) {
		await addSavedRoute(route);
	}

	function setRestoreMessage(routeId: string, message: string | null) {
		const nextMessages = { ...restoreMessages };
		if (message) {
			nextMessages[routeId] = message;
		} else {
			delete nextMessages[routeId];
		}
		restoreMessages = nextMessages;
	}

	function setRestoringRoute(routeId: string, restoring: boolean) {
		const nextRestoringRoutes = new Set(restoringRoutes);
		if (restoring) {
			nextRestoringRoutes.add(routeId);
		} else {
			nextRestoringRoutes.delete(routeId);
		}
		restoringRoutes = nextRestoringRoutes;
	}

	function setHistoryLoading(routeId: string, loading: boolean) {
		const nextLoadingRoutes = new Set(loadingHistoryRoutes);
		if (loading) {
			nextLoadingRoutes.add(routeId);
		} else {
			nextLoadingRoutes.delete(routeId);
		}
		loadingHistoryRoutes = nextLoadingRoutes;
	}

	function setHistoryError(routeId: string, message: string | null) {
		const nextErrors = { ...historyErrors };
		if (message) {
			nextErrors[routeId] = message;
		} else {
			delete nextErrors[routeId];
		}
		historyErrors = nextErrors;
	}

	function setSavedRouteVersions(
		routeId: string,
		versions: SavedRouteVersion[],
	) {
		savedRouteVersionsByRouteId = {
			...savedRouteVersionsByRouteId,
			[routeId]: versions.slice(0, 10),
		};
	}

	async function handleToggleChangeHistory(savedRoute: SavedRoute) {
		if (expandedHistoryRouteId === savedRoute.id) {
			expandedHistoryRouteId = null;
			return;
		}

		expandedHistoryRouteId = savedRoute.id;
		setHistoryError(savedRoute.id, null);
		setHistoryLoading(savedRoute.id, true);

		try {
			const versions = await listSavedRouteVersions(savedRoute.id);
			setSavedRouteVersions(savedRoute.id, versions);
		} catch (error) {
			setHistoryError(
				savedRoute.id,
				error instanceof Error
					? `Could not load change history: ${error.message}`
					: "Could not load change history.",
			);
		} finally {
			setHistoryLoading(savedRoute.id, false);
		}
	}

	async function handleRestorePreviousVersion(savedRoute: SavedRoute) {
		setRestoreMessage(savedRoute.id, null);
		setRestoringRoute(savedRoute.id, true);

		try {
			const result = await restoreLatestSavedRouteVersion(savedRoute.id);
			if (!result.restored) {
				setRestoreMessage(
					savedRoute.id,
					result.reason === "no_version"
						? "No previous version available."
						: "Saved route was not found.",
				);
			}
		} catch (error) {
			setRestoreMessage(
				savedRoute.id,
				error instanceof Error
					? `Could not restore route: ${error.message}`
					: "Could not restore route.",
			);
		} finally {
			setRestoringRoute(savedRoute.id, false);
		}
	}

	function getHistoryRouteSummary(route: PlannedRoute): string {
		const waypointSummary = formatWaypointSummary(route.waypoints);
		return waypointSummary
			? `${getRouteLegText(route)} ${waypointSummary}`
			: getRouteLegText(route);
	}

	function getHistoryPanelId(savedRouteId: string): string {
		return `history-${savedRouteId}`;
	}

	function handleExportSavedRoute(route: PlannedRoute) {
		exportError = null;

		Effect.runSync(
			downloadRouteGpxEffect(route).pipe(
				Effect.catchTag("RouteExportError", (error) =>
					Effect.sync(() => {
						exportError = `Could not export GPX: ${error.message}`;
					}),
				),
				Effect.catchCause((cause) =>
					Effect.sync(() => {
						console.error("Unexpected GPX export failure", cause);
						exportError = `Could not export GPX: ${formatUnexpectedExportError(cause)}`;
					}),
				),
			),
		);
	}

	function handleExportSavedRouteFit(route: PlannedRoute) {
		exportError = null;

		Effect.runSync(
			downloadRouteFitEffect(route).pipe(
				Effect.catchTag("RouteExportError", (error) =>
					Effect.sync(() => {
						exportError = `Could not export FIT: ${error.message}`;
					}),
				),
				Effect.catchCause((cause) =>
					Effect.sync(() => {
						console.error("Unexpected FIT export failure", cause);
						exportError = `Could not export FIT: ${formatUnexpectedExportError(cause)}`;
					}),
				),
			),
		);
	}

	async function handleShareSavedRoute(savedRoute: SavedRoute) {
		shareError = null;
		pendingShareUrl = null;
		copiedShareRouteId = null;

		if (!convexClient || !env.PUBLIC_CONVEX_URL) {
			shareError = "Route sharing needs Convex to be configured.";
			return;
		}

		if (savedRoutesState.authStatus !== "signedIn") {
			shareError = "Sign in to share routes.";
			return;
		}

		sharingRouteId = savedRoute.id;

		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const shareToken = yield* generateShareTokenEffect();
					const result = yield* Effect.tryPromise({
						try: () =>
							convexClient.mutation(api.sharedRoutes.create, {
								shareToken,
								sourceRouteId: savedRoute.id,
								savedRoute: serializeSavedRouteForRemote(savedRoute),
							}),
						catch: (cause) => new ShareSavedRouteMutationError({ cause }),
					});
					const shareUrl = buildShareUrl(
						window.location.origin,
						result.shareToken,
					);
					const copied = yield* copyTextToClipboardEffect(shareUrl);

					if (!copied) {
						pendingShareUrl = shareUrl;
						shareError = "Share link created, but copying failed.";
						return;
					}

					pendingShareUrl = null;
					copiedShareRouteId = savedRoute.id;
				}),
			);
		} catch (error) {
			shareError = formatShareFailure(error);
		} finally {
			sharingRouteId = null;
		}
	}
</script>

{#snippet savedRouteCardSkeleton()}
	<div class="rounded-xl border border-border bg-background p-4 shadow-lg md:p-5">
		<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
			<div class="min-w-0 flex-1 space-y-3">
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<Skeleton class="h-3 w-24 rounded-md" />
						<Skeleton class="h-5 w-20 rounded-full" />
					</div>
					<Skeleton class="h-6 w-56 max-w-full rounded-md" />
					<div class="flex items-center gap-2">
						<Skeleton class="size-4 rounded-full" />
						<Skeleton class="h-4 w-48 max-w-full rounded-md" />
					</div>
				</div>
				<div class="flex flex-wrap gap-2.5">
					<Skeleton class="h-8 w-24 rounded-md" />
					<Skeleton class="h-8 w-28 rounded-md" />
					<Skeleton class="h-8 w-24 rounded-md" />
				</div>
			</div>
			<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
				<Skeleton class="h-9 w-24 rounded-md" />
				<Skeleton class="h-9 w-20 rounded-md" />
				<Skeleton class="h-9 w-24 rounded-md" />
				<Skeleton class="h-9 w-20 rounded-md" />
			</div>
		</div>
	</div>
{/snippet}

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

		{#if savedRoutesState.syncError}
			<div
				class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{savedRoutesState.syncError}
			</div>
		{/if}

		{#if shareError}
			<div
				class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{shareError}
				{#if pendingShareUrl}
					<input
						class="mt-2 w-full rounded-md border border-destructive/20 bg-background px-2 py-1 font-mono text-xs text-foreground"
						readonly
						value={pendingShareUrl}
						aria-label="Share link"
						onfocus={(event) => event.currentTarget.select()}
					/>
				{/if}
			</div>
		{/if}

		{#if isLoadingSyncedRoutes}
			<div
				class="grid gap-3"
				role="status"
				aria-live="polite"
				aria-label="Loading saved routes"
			>
				<span class="sr-only">Loading saved routes</span>
				{#each [0, 1, 2] as _}
					{@render savedRouteCardSkeleton()}
				{/each}
			</div>
		{:else if savedRoutesState.savedRoutes.length === 0}
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
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex items-center gap-2">
					<Badge
						variant="secondary"
						class="h-6 border-primary/20 bg-primary/10 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
					>
						{#if hasActiveSearchOrFilters()}
							{`${filteredSavedRoutes.length} of ${savedRoutesState.savedRoutes.length}`}
							{savedRoutesState.savedRoutes.length === 1 ? " route" : " routes"}
						{:else}
							{savedRoutesState.savedRoutes.length}
							{savedRoutesState.savedRoutes.length === 1 ? " route" : " routes"}
						{/if}
					</Badge>
				</div>
				<div class="relative w-full sm:max-w-xs">
					<Search
						class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Search saved routes"
						placeholder="Search saved routes"
						class="pr-9 pl-9"
						bind:value={searchQuery}
					/>
					{#if normalizedSearchQuery}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="absolute right-1 top-1/2 size-7 -translate-y-1/2"
							aria-label="Clear route search"
							onclick={clearSearch}
						>
							<X class="size-4" />
						</Button>
					{/if}
				</div>
			</div>

			<div class="rounded-xl border border-border bg-background p-3 shadow-sm">
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<label class="grid gap-1.5 text-xs font-medium text-muted-foreground">
						<span>Min distance ({unitPreference.selectedDistanceUnit})</span>
						<Input
							type="text"
							inputmode="decimal"
							autocomplete="off"
							placeholder="Any"
							aria-label={`Min distance (${unitPreference.selectedDistanceUnit})`}
							bind:value={minDistanceInput}
						/>
					</label>
					<label class="grid gap-1.5 text-xs font-medium text-muted-foreground">
						<span>Max distance ({unitPreference.selectedDistanceUnit})</span>
						<Input
							type="text"
							inputmode="decimal"
							autocomplete="off"
							placeholder="Any"
							aria-label={`Max distance (${unitPreference.selectedDistanceUnit})`}
							bind:value={maxDistanceInput}
						/>
					</label>
					<label class="grid gap-1.5 text-xs font-medium text-muted-foreground">
						<span>Min elevation (m)</span>
						<Input
							type="text"
							inputmode="decimal"
							autocomplete="off"
							placeholder="Any"
							aria-label="Min elevation (m)"
							bind:value={minElevationInput}
						/>
					</label>
					<label class="grid gap-1.5 text-xs font-medium text-muted-foreground">
						<span>Max elevation (m)</span>
						<Input
							type="text"
							inputmode="decimal"
							autocomplete="off"
							placeholder="Any"
							aria-label="Max elevation (m)"
							bind:value={maxElevationInput}
						/>
					</label>
				</div>
				{#if hasActiveFilters}
					<div class="mt-3 flex justify-end">
						<Button type="button" variant="outline" size="sm" onclick={clearFilters}>
							Clear filters
						</Button>
					</div>
				{/if}
			</div>

			{#if filteredSavedRoutes.length === 0}
				<div class="rounded-xl border border-border bg-background p-6 shadow-lg md:p-8">
					<div class="flex flex-col items-start gap-4">
						<div class="rounded-lg border border-primary/20 bg-primary/10 p-3 text-primary">
							<Search class="size-5" />
						</div>
						<div class="space-y-1.5">
							<h2 class="font-heading text-lg font-semibold tracking-tight text-foreground">
								No routes match your filters
							</h2>
							<p class="max-w-xl text-sm leading-6 text-muted-foreground">
								Adjust the search, distance, or elevation filters to find saved routes.
							</p>
						</div>
						<Button type="button" variant="outline" onclick={clearSearchAndFilters}>
							Clear search and filters
						</Button>
					</div>
				</div>
			{:else}
				<div class="grid gap-3">
					{#each filteredSavedRoutes as savedRoute (savedRoute.id)}
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
										{#if isOutAndBackRoute(savedRoute.route)}
											<Badge
												variant="secondary"
												class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
											>
												Out and back
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
									{:else if isOutAndBackRoute(savedRoute.route)}
										<div class="flex items-center gap-2 text-sm text-muted-foreground">
											<Route class="size-4 shrink-0" />
											<span>{getRouteLegText(savedRoute.route)}</span>
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
								{#if restoreMessages[savedRoute.id]}
									<p
										class="basis-full rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-right text-xs text-muted-foreground"
										role="status"
									>
										{restoreMessages[savedRoute.id]}
									</p>
								{/if}
								<Button
									variant="outline"
									class="font-semibold"
									onclick={() => handleExportSavedRoute(savedRoute.route)}
								>
									Export GPX
								</Button>
								<Button
									variant="outline"
									class="font-semibold"
									onclick={() => handleExportSavedRouteFit(savedRoute.route)}
								>
									Export FIT
								</Button>
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									onclick={() => handleDuplicateSavedRoute(savedRoute.route)}
								>
									<Copy class="size-3.5" />
									Duplicate
								</Button>
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									aria-expanded={expandedHistoryRouteId === savedRoute.id}
									aria-controls={getHistoryPanelId(savedRoute.id)}
									onclick={() => handleToggleChangeHistory(savedRoute)}
								>
									<History class="size-3.5" />
									Change history
								</Button>
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									disabled={restoringRoutes.has(savedRoute.id)}
									onclick={() => handleRestorePreviousVersion(savedRoute)}
								>
									<RotateCcw class="size-3.5" />
									{restoringRoutes.has(savedRoute.id) ? "Restoring..." : "Restore previous"}
								</Button>
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									disabled={sharingRouteId === savedRoute.id}
									onclick={() => handleShareSavedRoute(savedRoute)}
								>
									<Link class="size-3.5" />
									{#if sharingRouteId === savedRoute.id}
										Sharing...
									{:else if copiedShareRouteId === savedRoute.id}
										Copied
									{:else}
										Share
									{/if}
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
						{#if expandedHistoryRouteId === savedRoute.id}
							<div
								id={getHistoryPanelId(savedRoute.id)}
								class="mt-4 border-t border-border pt-4"
								role="region"
								aria-label={`Change history for ${getRouteLegText(savedRoute.route)}`}
							>
								<div class="mb-3 flex items-center justify-between gap-3">
									<h2 class="text-sm font-semibold text-foreground">
										Change history
									</h2>
									<span class="text-xs text-muted-foreground">
										Current plus up to 10 stored entries
									</span>
								</div>

								{#if loadingHistoryRoutes.has(savedRoute.id)}
									<p
										class="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground"
										role="status"
									>
										Loading change history...
									</p>
								{:else if historyErrors[savedRoute.id]}
									<p
										class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
										role="status"
									>
										{historyErrors[savedRoute.id]}
									</p>
								{:else}
									<div class="space-y-2">
										<div class="rounded-md border border-primary/25 bg-primary/5 p-3">
											<div class="flex flex-wrap items-center justify-between gap-2">
												<p class="text-sm font-semibold text-foreground">
													Current version
												</p>
												<p class="text-xs text-muted-foreground">
													Saved {formatSavedAt(savedRoute.createdAt)}
												</p>
											</div>
											<p class="mt-1 text-sm text-muted-foreground">
												{getHistoryRouteSummary(savedRoute.route)}
											</p>
											<div class="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
												<span>{formatDistance(savedRoute.route.distanceMeters)}</span>
												<span>{Math.round(savedRoute.route.ascendMeters).toLocaleString()} m up</span>
												<span>{getRouteDurationText(savedRoute.route)}</span>
											</div>
										</div>

										{#if (savedRouteVersionsByRouteId[savedRoute.id] ?? []).length === 0}
											<p class="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
												No previous versions yet
											</p>
										{:else}
											{#each savedRouteVersionsByRouteId[savedRoute.id] ?? [] as version}
												<div class="rounded-md border border-border bg-background p-3">
													<div class="flex flex-wrap items-center justify-between gap-2">
														<p class="text-sm font-semibold text-foreground">
															Previous version
														</p>
														<p class="text-xs text-muted-foreground">
															Captured {formatSavedAt(version.capturedAt)}
														</p>
													</div>
													<p class="mt-1 text-sm text-muted-foreground">
														{getHistoryRouteSummary(version.savedRoute.route)}
													</p>
													<div class="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
														<span>{formatDistance(version.savedRoute.route.distanceMeters)}</span>
														<span>{Math.round(version.savedRoute.route.ascendMeters).toLocaleString()} m up</span>
														<span>{getRouteDurationText(version.savedRoute.route)}</span>
													</div>
												</div>
											{/each}
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
