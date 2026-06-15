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
	import type { PlannedRoute } from "$lib/route-planning";
	import {
		formatDuration,
		formatRoundCourseTarget,
		getRouteDurationText,
		getRouteLegText,
	} from "$lib/route-display";
	import {
		addSavedRoute,
		deleteSavedRoute,
		getSavedRouteById,
		initSavedRoutes,
		listSavedRouteVersions,
		loadSavedRouteSummaries,
		loadMoreSavedRouteSummaries,
		restoreLatestSavedRouteVersion,
		type SavedRoute,
		type SavedRouteSummary,
		type SavedRouteVersion,
		savedRoutesState,
	} from "$lib/saved-routes.svelte";
	import {
		serializeSavedRouteForRemote,
		summarizeSavedRoute,
	} from "$lib/saved-routes-core";
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

	const LOCAL_SAVED_ROUTE_PAGE_SIZE = 25;

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
	let hydratingRoutes = $state<Set<string>>(new Set());
	let restoreMessages = $state<Record<string, string>>({});
	let routeActionErrors = $state<Record<string, string>>({});
	let expandedHistoryRouteId = $state<string | null>(null);
	let loadingHistoryRoutes = $state<Set<string>>(new Set());
	let visibleLocalSavedRouteLimit = $state(LOCAL_SAVED_ROUTE_PAGE_SIZE);
	let savedRouteVersionsByRouteId = $state<Record<string, SavedRouteVersion[]>>(
		{},
	);
	let historyErrors = $state<Record<string, string>>({});
	const savedRouteSearchTextCache = new Map<
		string,
		SavedRouteSearchTextCacheEntry
	>();
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
	const remoteSummaryFilters = $derived({
		...(normalizedSearchQuery ? { searchQuery: normalizedSearchQuery } : {}),
		...(minDistanceMeters === null
			? {}
			: { minDistanceMeters }),
		...(maxDistanceMeters === null
			? {}
			: { maxDistanceMeters }),
		...(minElevationMeters === null
			? {}
			: { minElevationMeters }),
		...(maxElevationMeters === null
			? {}
			: { maxElevationMeters }),
	});
	const remoteSummaryFiltersSignature = $derived(
		JSON.stringify(remoteSummaryFilters),
	);
	const displayedSavedRouteSummaries = $derived(
		savedRoutesState.authStatus === "signedIn"
			? savedRoutesState.savedRouteSummaries
			: savedRoutesState.savedRoutes.map(summarizeSavedRoute),
	);
	const isLoadingSyncedRoutes = $derived(
		savedRoutesState.authStatus === "signedIn" &&
			!savedRoutesState.remoteReady &&
			!savedRoutesState.syncError &&
			displayedSavedRouteSummaries.length === 0,
	);
	const filteredSavedRouteSummaries = $derived(
		displayedSavedRouteSummaries.filter((summary) => {
			const matchesSearch =
				!normalizedSearchQuery ||
				getSavedRouteSummarySearchText(summary).includes(normalizedSearchQuery);

			return (
				matchesSearch &&
				matchesDistanceFilters(summary) &&
				matchesElevationFilters(summary)
			);
		}),
	);
	const displayedSavedRouteSetSignature = $derived(
		displayedSavedRouteSummaries.map((summary) => summary.id).join("|"),
	);
	const localPaginationResetSignature = $derived(
		[
			searchQuery,
			minDistanceInput,
			maxDistanceInput,
			minElevationInput,
			maxElevationInput,
			savedRoutesState.authStatus,
			displayedSavedRouteSetSignature,
		].join("\n"),
	);
	const visibleSavedRouteSummaries = $derived(
		savedRoutesState.authStatus === "signedIn"
			? filteredSavedRouteSummaries
			: filteredSavedRouteSummaries.slice(0, visibleLocalSavedRouteLimit),
	);
	const hasMoreLocalSavedRouteSummaries = $derived(
		savedRoutesState.authStatus !== "signedIn" &&
			visibleLocalSavedRouteLimit < filteredSavedRouteSummaries.length,
	);
	const canLoadMoreSavedRouteSummaries = $derived(
		Boolean(
			savedRoutesState.savedRouteSummariesContinueCursor ||
				hasMoreLocalSavedRouteSummaries,
		),
	);

	$effect(() => {
		const currentSavedRouteIds = new Set(
			displayedSavedRouteSummaries.map((summary) => summary.id),
		);

		for (const cachedSavedRouteId of savedRouteSearchTextCache.keys()) {
			if (!currentSavedRouteIds.has(cachedSavedRouteId)) {
				savedRouteSearchTextCache.delete(cachedSavedRouteId);
			}
		}
	});

	$effect(() => {
		remoteSummaryFiltersSignature;
		if (
			savedRoutesState.authStatus !== "signedIn" ||
			!savedRoutesState.remoteReady
		) {
			return;
		}

		void loadSavedRouteSummaries(remoteSummaryFilters);
	});

	$effect(() => {
		localPaginationResetSignature;
		visibleLocalSavedRouteLimit = LOCAL_SAVED_ROUTE_PAGE_SIZE;
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

	function isSummaryRoundCourse(summary: SavedRouteSummary): boolean {
		return summary.mode === "round_course";
	}

	function isSummaryOutAndBack(summary: SavedRouteSummary): boolean {
		return summary.mode === "out_and_back";
	}

	function isSummaryImported(summary: SavedRouteSummary): boolean {
		return summary.sourceKind === "gpx_import";
	}

	function getSummaryRoundCourseTarget(
		summary: SavedRouteSummary,
	): SavedRouteSummary["roundCourseTarget"] | null {
		if (!isSummaryRoundCourse(summary)) {
			return null;
		}

		return (
			summary.roundCourseTarget ??
			(summary.requestedDistanceMeters === undefined
				? null
				: { kind: "distance", distanceMeters: summary.requestedDistanceMeters })
		);
	}

	function getSummaryDurationText(summary: SavedRouteSummary): string {
		if (isSummaryImported(summary) && !summary.sourceHasDuration) {
			return "Time unavailable";
		}

		return formatDuration(summary.durationMs);
	}

	function getSummaryLegText(summary: SavedRouteSummary): string {
		if (isSummaryRoundCourse(summary)) {
			return "Returns to start";
		}

		if (isSummaryOutAndBack(summary)) {
			return `to ${summary.destinationLabel} and back`;
		}

		return `to ${summary.destinationLabel}`;
	}

	function formatSummaryWaypointLabels(labels: string[]): string | null {
		return labels.length === 0 ? null : `Via: ${labels.join(" -> ")}`;
	}

	function buildSavedRouteSummarySearchText(summary: SavedRouteSummary): string {
		const roundCourseTarget = getSummaryRoundCourseTarget(summary);
		const waypointSummary = formatSummaryWaypointLabels(summary.waypointLabels);

		return [
			`Saved ${formatSavedAt(summary.createdAt)}`,
			isSummaryRoundCourse(summary) ? "Round course" : null,
			isSummaryOutAndBack(summary) ? "Out and back" : null,
			isSummaryImported(summary) ? "Imported GPX" : null,
			summary.startLabel,
			summary.destinationLabel,
			getSummaryLegText(summary),
			waypointSummary,
			formatDistance(summary.distanceMeters),
			roundCourseTarget
				? `Target ${formatRoundCourseTarget(roundCourseTarget)}`
				: null,
			`${Math.round(summary.ascendMeters).toLocaleString()} m up`,
			getSummaryDurationText(summary),
		]
			.filter((value): value is string => Boolean(value))
			.join(" ");
	}

	function getSavedRouteSummarySearchCacheKey(summary: SavedRouteSummary): string {
		const waypointLabels = summary.waypointLabels.join("|");
		const roundCourseTarget = summary.roundCourseTarget
			? JSON.stringify(summary.roundCourseTarget)
			: "";
		const importedDurationFlag = isSummaryImported(summary)
			? String(summary.sourceHasDuration)
			: "";

		return [
			summary.id,
			unitPreference.selectedDistanceUnit,
			summary.createdAt,
			summary.mode,
			summary.startLabel,
			summary.destinationLabel,
			String(summary.distanceMeters),
			String(summary.ascendMeters),
			String(summary.durationMs),
			summary.requestedDistanceMeters == null
				? ""
				: String(summary.requestedDistanceMeters),
			roundCourseTarget,
			summary.sourceKind,
			importedDurationFlag,
			waypointLabels,
		].join(":");
	}

	function getSavedRouteSummarySearchText(summary: SavedRouteSummary): string {
		const cacheKey = getSavedRouteSummarySearchCacheKey(summary);
		const cachedSearchText = savedRouteSearchTextCache.get(summary.id);

		if (cachedSearchText?.cacheKey === cacheKey) {
			return cachedSearchText.searchText;
		}

		const normalizedSearchText = normalizeSearchText(
			buildSavedRouteSummarySearchText(summary),
		);
		savedRouteSearchTextCache.set(summary.id, {
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

	function handleLoadMoreSavedRouteSummaries() {
		if (savedRoutesState.savedRouteSummariesContinueCursor) {
			void loadMoreSavedRouteSummaries();
			return;
		}

		visibleLocalSavedRouteLimit += LOCAL_SAVED_ROUTE_PAGE_SIZE;
	}

	function matchesDistanceFilters(summary: SavedRouteSummary): boolean {
		if (
			minDistanceMeters !== null &&
			maxDistanceMeters !== null &&
			minDistanceMeters > maxDistanceMeters
		) {
			return false;
		}

		const distanceMeters = summary.distanceMeters;

		if (minDistanceMeters !== null && distanceMeters < minDistanceMeters) {
			return false;
		}

		if (maxDistanceMeters !== null && distanceMeters > maxDistanceMeters) {
			return false;
		}

		return true;
	}

	function matchesElevationFilters(summary: SavedRouteSummary): boolean {
		if (
			minElevationMeters !== null &&
			maxElevationMeters !== null &&
			minElevationMeters > maxElevationMeters
		) {
			return false;
		}

		const elevationMeters = summary.ascendMeters;

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

	async function handleDuplicateSavedRouteById(routeId: string) {
		const savedRoute = await hydrateSavedRouteForAction(routeId);
		if (!savedRoute) {
			return;
		}

		await addSavedRoute(savedRoute.route);
	}

	function setHydratingRoute(routeId: string, loading: boolean) {
		const nextHydratingRoutes = new Set(hydratingRoutes);
		if (loading) {
			nextHydratingRoutes.add(routeId);
		} else {
			nextHydratingRoutes.delete(routeId);
		}
		hydratingRoutes = nextHydratingRoutes;
	}

	function setRouteActionError(routeId: string, message: string | null) {
		const nextErrors = { ...routeActionErrors };
		if (message) {
			nextErrors[routeId] = message;
		} else {
			delete nextErrors[routeId];
		}
		routeActionErrors = nextErrors;
	}

	async function hydrateSavedRouteForAction(
		routeId: string,
	): Promise<SavedRoute | null> {
		setRouteActionError(routeId, null);
		setHydratingRoute(routeId, true);

		try {
			const savedRoute = await getSavedRouteById(routeId);
			if (!savedRoute) {
				setRouteActionError(routeId, "Saved route was not found.");
			}
			return savedRoute;
		} catch (error) {
			setRouteActionError(
				routeId,
				error instanceof Error
					? `Could not load route: ${error.message}`
					: "Could not load route.",
			);
			return null;
		} finally {
			setHydratingRoute(routeId, false);
		}
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

	async function handleToggleChangeHistory(routeId: string) {
		if (expandedHistoryRouteId === routeId) {
			expandedHistoryRouteId = null;
			return;
		}

		expandedHistoryRouteId = routeId;
		setHistoryError(routeId, null);
		setHistoryLoading(routeId, true);

		try {
			const versions = await listSavedRouteVersions(routeId);
			setSavedRouteVersions(routeId, versions);
		} catch (error) {
			setHistoryError(
				routeId,
				error instanceof Error
					? `Could not load change history: ${error.message}`
					: "Could not load change history.",
			);
		} finally {
			setHistoryLoading(routeId, false);
		}
	}

	async function handleRestorePreviousVersion(routeId: string) {
		setRestoreMessage(routeId, null);
		setRestoringRoute(routeId, true);

		try {
			const result = await restoreLatestSavedRouteVersion(routeId);
			if (!result.restored) {
				setRestoreMessage(
					routeId,
					result.reason === "no_version"
						? "No previous version available."
						: "Saved route was not found.",
				);
			}
		} catch (error) {
			setRestoreMessage(
				routeId,
				error instanceof Error
					? `Could not restore route: ${error.message}`
					: "Could not restore route.",
			);
		} finally {
			setRestoringRoute(routeId, false);
		}
	}

	function getHistoryRouteSummary(route: PlannedRoute): string {
		const waypointSummary = formatSummaryWaypointLabels(
			route.waypoints.map((waypoint) => waypoint.label),
		);
		return waypointSummary
			? `${getRouteLegText(route)} ${waypointSummary}`
			: getRouteLegText(route);
	}

	function getHistoryPanelId(savedRouteId: string): string {
		return `history-${savedRouteId}`;
	}

	async function handleExportSavedRoute(routeId: string) {
		exportError = null;
		const savedRoute = await hydrateSavedRouteForAction(routeId);
		if (!savedRoute) {
			return;
		}

		Effect.runSync(
			downloadRouteGpxEffect(savedRoute.route).pipe(
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

	async function handleExportSavedRouteFit(routeId: string) {
		exportError = null;
		const savedRoute = await hydrateSavedRouteForAction(routeId);
		if (!savedRoute) {
			return;
		}

		Effect.runSync(
			downloadRouteFitEffect(savedRoute.route).pipe(
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

	async function handleShareSavedRoute(routeId: string) {
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

		const savedRoute = await hydrateSavedRouteForAction(routeId);
		if (!savedRoute) {
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
		{:else if displayedSavedRouteSummaries.length === 0 && !hasActiveSearchOrFilters()}
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
							{`${filteredSavedRouteSummaries.length} of ${displayedSavedRouteSummaries.length}`}
							{displayedSavedRouteSummaries.length === 1 ? " route" : " routes"}
						{:else}
							{displayedSavedRouteSummaries.length}
							{displayedSavedRouteSummaries.length === 1 ? " route" : " routes"}
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
					<!-- biome-ignore lint/a11y/noLabelWithoutControl: Input renders a native input. -->
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
					<!-- biome-ignore lint/a11y/noLabelWithoutControl: Input renders a native input. -->
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
					<!-- biome-ignore lint/a11y/noLabelWithoutControl: Input renders a native input. -->
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
					<!-- biome-ignore lint/a11y/noLabelWithoutControl: Input renders a native input. -->
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

			{#if filteredSavedRouteSummaries.length === 0}
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
					{#each visibleSavedRouteSummaries as savedRoute (savedRoute.id)}
					<div class="rounded-xl border border-border bg-background p-4 shadow-lg md:p-5">
						<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
							<div class="min-w-0 flex-1 space-y-3">
								<div class="space-y-1">
									<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
										<span>Saved {formatSavedAt(savedRoute.createdAt)}</span>
										{#if isSummaryRoundCourse(savedRoute)}
											<Badge
												variant="secondary"
												class="h-5 border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
											>
												Round course
											</Badge>
										{/if}
										{#if isSummaryOutAndBack(savedRoute)}
											<Badge
												variant="secondary"
												class="h-5 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-primary"
											>
												Out and back
											</Badge>
										{/if}
										{#if isSummaryImported(savedRoute)}
											<Badge
												variant="secondary"
												class="h-5 border-sky-500/20 bg-sky-500/10 px-2 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
											>
												Imported GPX
											</Badge>
										{/if}
									</div>
									<h2 class="font-heading text-lg font-semibold tracking-tight text-foreground">
										{savedRoute.startLabel}
									</h2>
									{#if isSummaryRoundCourse(savedRoute)}
										<div class="flex items-center gap-2 text-sm text-muted-foreground">
											<Route class="size-4 shrink-0" />
											<span>Returns to start</span>
										</div>
									{:else if isSummaryOutAndBack(savedRoute)}
										<div class="flex items-center gap-2 text-sm text-muted-foreground">
											<Route class="size-4 shrink-0" />
											<span>{getSummaryLegText(savedRoute)}</span>
										</div>
									{:else}
										<div class="flex items-center gap-2 text-sm text-muted-foreground">
											<Route class="size-4 shrink-0" />
											<span>to</span>
											<span class="font-medium text-foreground">
												{savedRoute.destinationLabel}
											</span>
										</div>
									{/if}
									{#if formatSummaryWaypointLabels(savedRoute.waypointLabels)}
										<p class="text-xs text-muted-foreground">
											{formatSummaryWaypointLabels(savedRoute.waypointLabels)}
										</p>
									{/if}
								</div>

								<div class="flex flex-wrap gap-2.5 text-xs text-muted-foreground sm:text-sm">
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<MapPinned class="size-3.5 shrink-0 text-primary" />
										<span>{formatDistance(savedRoute.distanceMeters)}</span>
									</div>
									{#if isSummaryRoundCourse(savedRoute) && getSummaryRoundCourseTarget(savedRoute)}
										<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
											<Route class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
											<span>Target {formatRoundCourseTarget(getSummaryRoundCourseTarget(savedRoute))}</span>
										</div>
									{/if}
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
										<span>{Math.round(savedRoute.ascendMeters).toLocaleString()} m up</span>
									</div>
									<div class="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5">
										<Clock3 class="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
										<span>{getSummaryDurationText(savedRoute)}</span>
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
								{#if routeActionErrors[savedRoute.id]}
									<p
										class="basis-full rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-right text-xs text-destructive"
										role="status"
									>
										{routeActionErrors[savedRoute.id]}
									</p>
								{/if}
								<Button
									variant="outline"
									class="font-semibold"
									disabled={hydratingRoutes.has(savedRoute.id)}
									onclick={() => handleExportSavedRoute(savedRoute.id)}
								>
									Export GPX
								</Button>
								<Button
									variant="outline"
									class="font-semibold"
									disabled={hydratingRoutes.has(savedRoute.id)}
									onclick={() => handleExportSavedRouteFit(savedRoute.id)}
								>
									Export FIT
								</Button>
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									disabled={hydratingRoutes.has(savedRoute.id)}
									onclick={() => handleDuplicateSavedRouteById(savedRoute.id)}
								>
									<Copy class="size-3.5" />
									Duplicate
								</Button>
								<!-- biome-ignore-start lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									aria-expanded={expandedHistoryRouteId === savedRoute.id ? "true" : "false"}
									aria-controls={getHistoryPanelId(savedRoute.id)}
									disabled={hydratingRoutes.has(savedRoute.id)}
									onclick={() => handleToggleChangeHistory(savedRoute.id)}
								>
									<History class="size-3.5" />
									Change history
								</Button>
								<!-- biome-ignore-end lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									disabled={restoringRoutes.has(savedRoute.id) || hydratingRoutes.has(savedRoute.id)}
									onclick={() => handleRestorePreviousVersion(savedRoute.id)}
								>
									<RotateCcw class="size-3.5" />
									{restoringRoutes.has(savedRoute.id) ? "Restoring..." : "Restore previous"}
								</Button>
								<Button
									variant="outline"
									class="gap-1 font-semibold"
									disabled={sharingRouteId === savedRoute.id || hydratingRoutes.has(savedRoute.id)}
									onclick={() => handleShareSavedRoute(savedRoute.id)}
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
							<!-- biome-ignore lint/a11y/useSemanticElements: This collapsible panel is conditionally rendered inside a route card. -->
								<div
								id={getHistoryPanelId(savedRoute.id)}
								class="mt-4 border-t border-border pt-4"
								role="region"
								aria-label={`Change history for ${getSummaryLegText(savedRoute)}`}
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
												{getSummaryLegText(savedRoute)}
											</p>
											<div class="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
												<span>{formatDistance(savedRoute.distanceMeters)}</span>
												<span>{Math.round(savedRoute.ascendMeters).toLocaleString()} m up</span>
												<span>{getSummaryDurationText(savedRoute)}</span>
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
				{#if canLoadMoreSavedRouteSummaries}
					<div class="flex justify-center pt-2">
						<Button
							type="button"
							variant="outline"
							disabled={savedRoutesState.savedRouteSummariesLoading}
							onclick={handleLoadMoreSavedRouteSummaries}
						>
							{savedRoutesState.savedRouteSummariesLoading ? "Loading..." : "Load more"}
						</Button>
					</div>
				{/if}
			{/if}
		{/if}
	</div>
</div>
