import { Effect } from "effect";
import {
	desiredAlternativeRoutes,
	maxRouteEditGeometryHistoryEntries,
	maxRouteEditHistoryEntries,
} from "$lib/route-planner/constants";
import {
	buildCurrentRouteRequest as buildPlannerCurrentRouteRequest,
	capRouteEditSnapshotStack,
	captureRouteEditSnapshot as capturePlannerRouteEditSnapshot,
	getAvoidanceRequest as getPlannerAvoidanceRequest,
	getManualEditingRequest as getPlannerManualEditingRequest,
	getRoundCourseTarget,
	getActiveRouteForSaving as getSaveableActiveRoute,
	hydratePlannerStateFromRoute,
	type PlannerFormState,
	type PlannerRouteState,
	restoreRouteEditSnapshot as restorePlannerSnapshot,
	withAvoidancesState,
	withManualEditingState,
	withPlannerRouteState,
} from "$lib/route-planner/page/planner-state";
import type {
	RouteEditSnapshot,
	RouteEditSnapshotOptions,
} from "$lib/route-planner/types";
import {
	getRouteSegmentCount,
	getRouteTurnCount,
	isImportedRoute,
	isRouteStopLocked,
	type ManualRouteEditingState,
	type PlannedRoute,
	type ResolvedRouteAvoidance,
	type RouteApiError,
	type RouteApiSuccess,
	type RouteRequestPayload,
	sanitizeLockedSegmentIndexes,
} from "$lib/route-planning";
import {
	PlannerRouteRequestError,
	PlannerRouteResponseError,
} from "./planner-controller-errors";

type AsyncRouteEditResult = "committed" | "noop" | "rollback";

type SavedRouteEditMetadata = {
	activeSavedRouteId: string | null;
	plannerDraftRouteId: string | null;
	pendingSavedRouteId: string | null;
	pendingSavedRouteRestoreRevision: number | null;
	isActiveRouteSaved: boolean;
};

type PlannerRoutesControllerDependencies = {
	getFetch: () => typeof window.fetch | null;
	getPlannerFormState: () => PlannerFormState;
	applyPlannerFormState: (form: PlannerFormState) => void;
	getFieldErrors: () => NonNullable<RouteApiError["fieldErrors"]>;
	setFieldErrors: (errors: NonNullable<RouteApiError["fieldErrors"]>) => void;
	clearFieldErrors: () => void;
	closeCompletionMenu: () => void;
	closeMapClickMenu: () => void;
	resetAnalysisState: () => void;
	cancelAutosaveTimer: () => void;
	scheduleActiveRouteAutosave: () => void;
	bumpRouteSaveRevision: () => void;
	captureSavedRouteEditMetadata: () => SavedRouteEditMetadata;
	restoreSavedRouteEditMetadata: (metadata: SavedRouteEditMetadata) => void;
	markUnsaved: () => void;
	setPendingSavedRouteId: (id: string | null) => void;
	setRouteImportError: (error: string | null) => void;
	setRouteExportError: (error: string | null) => void;
	clearRouteShareState: (routeKey: string) => void;
	getActiveRouteShareKey: () => string | null;
	applyWorkoutPlanTarget: () => boolean;
	validateDistanceInputs: () => boolean;
};

export function createPlannerRoutesController(
	dependencies: PlannerRoutesControllerDependencies,
) {
	let routeRequestError = $state<string | null>(null);
	let isRouting = $state(false);
	let routeAlternatives = $state<PlannedRoute[]>([]);
	let selectedRouteIndex = $state<number | null>(null);
	let routeNeedsRecalculation = $state(false);
	let lockedSegmentIndexes = $state<number[]>([]);
	let avoidedRoads = $state<ResolvedRouteAvoidance[]>([]);
	let lastGeneratedRouteCount = $state<number | null>(null);
	let routeRequestRevision = 0;
	let activeRouteRequestRevision: number | null = null;
	let fitInitialSavedRouteBounds = $state(false);
	let undoStack = $state<RouteEditSnapshot[]>([]);
	let redoStack = $state<RouteEditSnapshot[]>([]);

	function getActiveRoute() {
		return selectedRouteIndex === null
			? null
			: (routeAlternatives[selectedRouteIndex] ?? null);
	}

	function getActiveDirections() {
		return getActiveRoute()?.instructions ?? [];
	}

	function getActiveTurnCount() {
		const activeRoute = getActiveRoute();
		return activeRoute ? getRouteTurnCount(activeRoute) : 0;
	}

	function getActiveRoundCourseTarget() {
		return getRoundCourseTarget(getActiveRoute());
	}

	function getActiveImportedRouteSource() {
		const activeRoute = getActiveRoute();
		return isImportedRoute(activeRoute) ? activeRoute.source : null;
	}

	function getAlternativeInfoMessage() {
		return lastGeneratedRouteCount !== null &&
			lastGeneratedRouteCount < desiredAlternativeRoutes
			? `Found ${lastGeneratedRouteCount} distinct route${lastGeneratedRouteCount === 1 ? "" : "s"} for this request.`
			: null;
	}

	function getCanUndoRouteEdit() {
		return undoStack.length > 0 && !isRouting;
	}

	function getCanRedoRouteEdit() {
		return redoStack.length > 0 && !isRouting;
	}

	function getPlannerRouteState(): PlannerRouteState {
		return {
			routeAlternatives,
			selectedRouteIndex,
			routeNeedsRecalculation,
			lockedSegmentIndexes,
			avoidedRoads,
			lastGeneratedRouteCount,
		};
	}

	function applyPlannerRouteState(state: PlannerRouteState) {
		routeAlternatives = state.routeAlternatives;
		selectedRouteIndex = state.selectedRouteIndex;
		routeNeedsRecalculation = state.routeNeedsRecalculation;
		lockedSegmentIndexes = state.lockedSegmentIndexes;
		avoidedRoads = state.avoidedRoads;
		lastGeneratedRouteCount = state.lastGeneratedRouteCount;
	}

	function setRouteRequestError(value: string | null) {
		routeRequestError = value;
	}

	function setRouteNeedsRecalculation(value: boolean) {
		routeNeedsRecalculation = value;
	}

	function setLastGeneratedRouteCount(value: number | null) {
		lastGeneratedRouteCount = value;
	}

	function setLockedSegmentIndexes(indexes: number[]) {
		lockedSegmentIndexes = indexes;
	}

	function setAvoidedRoads(avoidances: ResolvedRouteAvoidance[]) {
		avoidedRoads = avoidances;
	}

	function clearManualRouteState() {
		lockedSegmentIndexes = [];
		avoidedRoads = [];
	}

	function invalidateRouteRequests() {
		routeRequestRevision += 1;
	}

	function startRouteRequest() {
		invalidateRouteRequests();
		activeRouteRequestRevision = routeRequestRevision;
		isRouting = true;
		return routeRequestRevision;
	}

	function isCurrentRouteRequest(revision: number) {
		return (
			routeRequestRevision === revision &&
			activeRouteRequestRevision === revision
		);
	}

	function finishRouteRequest(revision: number) {
		if (activeRouteRequestRevision !== revision) {
			return;
		}

		activeRouteRequestRevision = null;
		isRouting = false;
	}

	function syncStopsFromRoute(route: PlannedRoute) {
		const hydratedState = Effect.runSync(hydratePlannerStateFromRoute(route));
		dependencies.applyPlannerFormState({
			...hydratedState.form,
			fieldErrors: dependencies.getFieldErrors(),
		});
		avoidedRoads = hydratedState.avoidedRoads;
	}

	function syncActiveRouteManualEditing(indexes: number[]) {
		if (selectedRouteIndex === null) {
			return;
		}

		const selectedRoute = routeAlternatives[selectedRouteIndex];

		if (!selectedRoute) {
			return;
		}

		const nextRoute = Effect.runSync(
			withManualEditingState(selectedRoute, indexes),
		);
		const currentIndexes =
			selectedRoute.manualEditing?.lockedSegmentIndexes ?? [];
		const nextIndexes = nextRoute.manualEditing?.lockedSegmentIndexes ?? [];

		if (
			currentIndexes.length === nextIndexes.length &&
			currentIndexes.every(
				(index, itemIndex) => index === nextIndexes[itemIndex],
			)
		) {
			return;
		}

		routeAlternatives = routeAlternatives.map((route, index) =>
			index === selectedRouteIndex ? nextRoute : route,
		);
	}

	function setRouteAlternativesState(
		routes: PlannedRoute[],
		nextSelectedRouteIndex: number,
	) {
		const nextIndex =
			routes.length === 0
				? null
				: Math.min(Math.max(nextSelectedRouteIndex, 0), routes.length - 1);
		const selectedRoute = nextIndex === null ? null : routes[nextIndex];
		const nextLockedSegmentIndexes = selectedRoute
			? sanitizeLockedSegmentIndexes(
					lockedSegmentIndexes,
					getRouteSegmentCount(selectedRoute),
				)
			: [];
		const nextAvoidedRoads = selectedRoute?.avoidances ?? avoidedRoads;
		routeAlternatives = routes.map((route, index) =>
			Effect.runSync(
				index === nextIndex
					? withPlannerRouteState(
							route,
							nextLockedSegmentIndexes,
							nextAvoidedRoads,
						)
					: withAvoidancesState(route, nextAvoidedRoads),
			),
		);
		selectedRouteIndex = nextIndex;
		lockedSegmentIndexes = nextLockedSegmentIndexes;
		avoidedRoads = nextAvoidedRoads.map((avoidance) => ({ ...avoidance }));
	}

	function setSingleRouteState(route: PlannedRoute) {
		lockedSegmentIndexes = sanitizeLockedSegmentIndexes(
			route.manualEditing?.lockedSegmentIndexes ?? [],
			getRouteSegmentCount(route),
		);
		avoidedRoads = route.avoidances ?? [];
		setRouteAlternativesState([route], 0);
	}

	function selectRouteAlternative(index: number) {
		if (index < 0 || index >= routeAlternatives.length) {
			return;
		}

		const selectedRoute = routeAlternatives[index] as PlannedRoute;
		const nextLockedSegmentIndexes = sanitizeLockedSegmentIndexes(
			lockedSegmentIndexes,
			getRouteSegmentCount(selectedRoute),
		);

		selectedRouteIndex = index;
		lockedSegmentIndexes = nextLockedSegmentIndexes;
		avoidedRoads = selectedRoute.avoidances ?? avoidedRoads;
		routeAlternatives = routeAlternatives.map((route, routeIndex) =>
			Effect.runSync(
				routeIndex === index
					? withPlannerRouteState(route, nextLockedSegmentIndexes, avoidedRoads)
					: withAvoidancesState(route, avoidedRoads),
			),
		);
		dependencies.resetAnalysisState();
		clearRouteEditHistory();
		dependencies.bumpRouteSaveRevision();
		dependencies.scheduleActiveRouteAutosave();
	}

	function markPlannerEdited(
		options: { requiresRecalculation?: boolean } = {},
	) {
		const requiresRecalculation = options.requiresRecalculation ?? true;
		const staleRouteShareKey = dependencies.getActiveRouteShareKey();

		if (isRouting || (requiresRecalculation && getActiveRoute())) {
			invalidateRouteRequests();
		}

		if (routeRequestError) {
			routeRequestError = null;
		}

		dependencies.setRouteImportError(null);
		dependencies.markUnsaved();
		if (requiresRecalculation && getActiveRoute()) {
			routeNeedsRecalculation = true;
			dependencies.cancelAutosaveTimer();
			dependencies.setRouteExportError(null);
			if (staleRouteShareKey) {
				dependencies.clearRouteShareState(staleRouteShareKey);
			}
		}
	}

	function getActiveRouteForSaving(): PlannedRoute | null {
		return Effect.runSync(
			getSaveableActiveRoute({
				activeRoute: getActiveRoute(),
				lockedSegmentIndexes,
				avoidedRoads,
			}),
		);
	}

	function captureRouteEditSnapshot(
		options: RouteEditSnapshotOptions = {},
	): RouteEditSnapshot {
		return Effect.runSync(
			capturePlannerRouteEditSnapshot(
				dependencies.getPlannerFormState(),
				getPlannerRouteState(),
				options,
			),
		);
	}

	function applyRestoredRouteEditSnapshot(snapshot: RouteEditSnapshot) {
		dependencies.closeCompletionMenu();
		dependencies.closeMapClickMenu();
		const restoredState = Effect.runSync(restorePlannerSnapshot(snapshot));
		applyPlannerRouteState(restoredState.routeState);
		dependencies.applyPlannerFormState(restoredState.form);
		dependencies.resetAnalysisState();
	}

	function restoreRouteEditSnapshot(snapshot: RouteEditSnapshot) {
		applyRestoredRouteEditSnapshot(snapshot);
		routeRequestError = null;
		dependencies.setRouteImportError(null);
		dependencies.setRouteExportError(null);
		markPlannerEdited({ requiresRecalculation: false });
		if (!routeNeedsRecalculation) {
			dependencies.scheduleActiveRouteAutosave();
		}
	}

	function rollbackRouteEditSnapshot(
		snapshot: RouteEditSnapshot,
		savedRouteMetadata: SavedRouteEditMetadata,
		preservedRouteRequestError: string | null,
	) {
		applyRestoredRouteEditSnapshot(snapshot);
		dependencies.restoreSavedRouteEditMetadata(savedRouteMetadata);
		routeRequestError = preservedRouteRequestError;
		dependencies.setRouteImportError(null);
		dependencies.setRouteExportError(null);
		dependencies.bumpRouteSaveRevision();
		if (!routeNeedsRecalculation) {
			dependencies.scheduleActiveRouteAutosave();
		}
	}

	function pushRouteEditUndoSnapshot(snapshot: RouteEditSnapshot) {
		undoStack = capRouteEditSnapshotStack([...undoStack, snapshot], {
			maxEntries: maxRouteEditHistoryEntries,
			maxGeometryEntries: maxRouteEditGeometryHistoryEntries,
		});
	}

	function pushRouteEditRedoSnapshot(snapshot: RouteEditSnapshot) {
		redoStack = capRouteEditSnapshotStack([...redoStack, snapshot], {
			maxEntries: maxRouteEditHistoryEntries,
			maxGeometryEntries: maxRouteEditGeometryHistoryEntries,
		});
	}

	function clearRouteEditHistory() {
		undoStack = [];
		redoStack = [];
	}

	function performRouteEdit(editFn: () => boolean | undefined) {
		if (isRouting) {
			return;
		}

		if (!getActiveRoute()) {
			editFn();
			return;
		}

		const previousSnapshot = captureRouteEditSnapshot();
		const changed = editFn();

		if (changed === false) {
			return;
		}

		pushRouteEditUndoSnapshot(previousSnapshot);
		redoStack = [];
	}

	const performAsyncRouteEdit = Effect.fn("performAsyncRouteEdit")(function* (
		editFn: () => Effect.Effect<AsyncRouteEditResult>,
		options: RouteEditSnapshotOptions = {},
	) {
		if (!getActiveRoute()) {
			return yield* editFn();
		}

		const previousSnapshot = captureRouteEditSnapshot(options);
		const savedRouteMetadata = dependencies.captureSavedRouteEditMetadata();
		const result = yield* editFn();

		if (result === "noop") {
			return;
		}

		if (result === "rollback") {
			const preservedRouteRequestError = routeRequestError;
			rollbackRouteEditSnapshot(
				previousSnapshot,
				savedRouteMetadata,
				preservedRouteRequestError,
			);
			return;
		}

		pushRouteEditUndoSnapshot(previousSnapshot);
		redoStack = [];
		return result;
	});

	function undoRouteEdit() {
		const previousSnapshot = undoStack[undoStack.length - 1];

		if (!previousSnapshot || isRouting) {
			return;
		}

		undoStack = undoStack.slice(0, -1);
		pushRouteEditRedoSnapshot(
			captureRouteEditSnapshot({ includeRoutesGeometry: true }),
		);
		restoreRouteEditSnapshot(previousSnapshot);
	}

	function redoRouteEdit() {
		const nextSnapshot = redoStack[redoStack.length - 1];

		if (!nextSnapshot || isRouting) {
			return;
		}

		redoStack = redoStack.slice(0, -1);
		pushRouteEditUndoSnapshot(
			captureRouteEditSnapshot({ includeRoutesGeometry: true }),
		);
		restoreRouteEditSnapshot(nextSnapshot);
	}

	function isRouteEditKeyboardShortcutAllowed(event: KeyboardEvent) {
		if (!event.metaKey && !event.ctrlKey) {
			return false;
		}

		if (event.altKey) {
			return false;
		}

		const key = event.key.toLowerCase();

		if (key !== "z" && key !== "y") {
			return false;
		}

		const target = event.target;

		if (!(target instanceof HTMLElement)) {
			return true;
		}

		return !target.closest("input, textarea, select, [contenteditable]");
	}

	function handleRouteEditKeydown(event: KeyboardEvent) {
		if (!isRouteEditKeyboardShortcutAllowed(event)) {
			return;
		}

		const key = event.key.toLowerCase();

		if ((event.metaKey || event.ctrlKey) && key === "z" && event.shiftKey) {
			event.preventDefault();
			redoRouteEdit();
			return;
		}

		if ((event.metaKey || event.ctrlKey) && key === "y") {
			event.preventDefault();
			redoRouteEdit();
			return;
		}

		if ((event.metaKey || event.ctrlKey) && key === "z") {
			event.preventDefault();
			undoRouteEdit();
		}
	}

	const applyManualEditingToRoutes = Effect.fn("applyManualEditingToRoutes")(
		function* (routes: PlannedRoute[]) {
			const manualEditing = yield* getPlannerManualEditingRequest(
				getActiveRoute(),
				lockedSegmentIndexes,
			);

			const nextRoutes: PlannedRoute[] = [];

			for (const route of routes) {
				nextRoutes.push({
					...(yield* withAvoidancesState(
						route,
						route.avoidances ?? avoidedRoads,
					)),
					...(manualEditing ? { manualEditing } : {}),
				});
			}

			return nextRoutes;
		},
	);

	const requestRouteCalculationEffect = Effect.fn(
		"requestRouteCalculationEffect",
	)(function* (
		routeRequest: RouteRequestPayload & {
			manualEditing?: ManualRouteEditingState;
		},
		requestRevision?: number,
	) {
		const clientFetch = dependencies.getFetch();
		if (!clientFetch) {
			return yield* new PlannerRouteRequestError({
				cause: new Error(
					"Route requests are only available after the page has mounted.",
				),
			});
		}

		const response = yield* Effect.tryPromise({
			try: () =>
				clientFetch("/api/route", {
					method: "POST",
					headers: {
						"content-type": "application/json",
					},
					body: JSON.stringify(routeRequest),
				}),
			catch: (cause) => new PlannerRouteRequestError({ cause }),
		});

		if (!response.ok) {
			const errorPayload = yield* Effect.tryPromise({
				try: () => response.json() as Promise<RouteApiError>,
				catch: (cause) => new PlannerRouteRequestError({ cause }),
			});
			if (
				requestRevision !== undefined &&
				!isCurrentRouteRequest(requestRevision)
			) {
				return null;
			}

			dependencies.setFieldErrors(errorPayload.fieldErrors ?? {});
			routeRequestError = errorPayload.error;
			return null;
		}

		if (
			requestRevision !== undefined &&
			!isCurrentRouteRequest(requestRevision)
		) {
			return null;
		}

		return yield* Effect.tryPromise({
			try: () => response.json() as Promise<RouteApiSuccess>,
			catch: (cause) => new PlannerRouteRequestError({ cause }),
		});
	});

	function requestRouteCalculation(
		routeRequest: RouteRequestPayload & {
			manualEditing?: ManualRouteEditingState;
		},
	) {
		return requestRouteCalculationEffect(routeRequest);
	}

	function isLockedStopIndex(stopIndex: number) {
		const activeRoute = getActiveRoute();
		return activeRoute
			? isRouteStopLocked(
					stopIndex,
					sanitizeLockedSegmentIndexes(
						lockedSegmentIndexes,
						getRouteSegmentCount(activeRoute),
					),
					getRouteSegmentCount(activeRoute),
					activeRoute.mode === "round_course",
				)
			: false;
	}

	const applyRouteCalculationPayloadEffect = Effect.fn(
		"applyRouteCalculationPayloadEffect",
	)(function* (payload: RouteApiSuccess, resetHistory: boolean) {
		const nextRoutes = yield* applyManualEditingToRoutes(payload.routes ?? []);
		const nextSelectedRoute =
			nextRoutes[payload.selectedRouteIndex] ?? nextRoutes[0] ?? null;

		if (!nextSelectedRoute) {
			return yield* new PlannerRouteResponseError({
				message: "Route API returned no routes.",
			});
		}

		setRouteAlternativesState(nextRoutes, payload.selectedRouteIndex);
		lastGeneratedRouteCount = nextRoutes.length;
		syncStopsFromRoute(nextSelectedRoute);
		routeNeedsRecalculation = false;
		routeRequestError = null;
		dependencies.setRouteExportError(null);
		dependencies.resetAnalysisState();
		if (resetHistory) {
			clearRouteEditHistory();
		}
		dependencies.bumpRouteSaveRevision();
		dependencies.scheduleActiveRouteAutosave();
	});

	const rerouteAfterManualEditEffect = Effect.fn(
		"rerouteAfterManualEditEffect",
	)(function* () {
		if (isRouting) {
			return false;
		}

		const requestRevision = startRouteRequest();
		dependencies.setPendingSavedRouteId(null);
		dependencies.markUnsaved();
		routeNeedsRecalculation = true;
		routeRequestError = null;
		dependencies.setRouteImportError(null);
		dependencies.clearFieldErrors();
		dependencies.setRouteExportError(null);

		return yield* Effect.gen(function* () {
			const payload = yield* requestRouteCalculationEffect(
				yield* buildPlannerCurrentRouteRequest(
					dependencies.getPlannerFormState(),
					yield* getPlannerManualEditingRequest(
						getActiveRoute(),
						lockedSegmentIndexes,
					),
					yield* getPlannerAvoidanceRequest(avoidedRoads),
				),
				requestRevision,
			);

			if (!payload) {
				return false;
			}

			if (!isCurrentRouteRequest(requestRevision)) {
				return false;
			}

			yield* applyRouteCalculationPayloadEffect(payload, false);
			return true;
		}).pipe(
			Effect.catchTags({
				PlannerRouteRequestError: (error) =>
					Effect.sync(() => {
						console.error("Failed to reroute manual edit", error.cause);
						routeRequestError =
							"The manual route edit could not be recalculated.";
						return false;
					}),
				PlannerRouteResponseError: (error) =>
					Effect.sync(() => {
						console.error("Failed to reroute manual edit", error.message);
						routeRequestError =
							"The manual route edit could not be recalculated.";
						return false;
					}),
			}),
			Effect.ensuring(
				Effect.sync(() => {
					finishRouteRequest(requestRevision);
				}),
			),
		);
	});

	function rerouteAfterManualEdit() {
		return rerouteAfterManualEditEffect();
	}

	const removeAvoidedRoad = Effect.fn("removeAvoidedRoad")(function* (
		index: number,
	) {
		if (
			index < 0 ||
			index >= avoidedRoads.length ||
			isRouting ||
			routeNeedsRecalculation
		) {
			return;
		}

		yield* performAsyncRouteEdit(
			() =>
				Effect.gen(function* () {
					avoidedRoads = avoidedRoads.filter(
						(_, itemIndex) => itemIndex !== index,
					);
					return (yield* rerouteAfterManualEdit()) ? "committed" : "rollback";
				}),
			{ includeRoutesGeometry: true },
		);
	});

	const handleGenerateRouteEffect = Effect.fn("handleGenerateRouteEffect")(
		function* () {
			if (isRouting) {
				return;
			}

			if (!dependencies.getFetch()) {
				routeRequestError =
					"Route requests are only available after the page has mounted.";
				return;
			}

			dependencies.closeCompletionMenu();
			dependencies.setPendingSavedRouteId(null);
			dependencies.markUnsaved();
			routeRequestError = null;
			dependencies.clearFieldErrors();

			if (!dependencies.applyWorkoutPlanTarget()) {
				return;
			}

			if (!dependencies.validateDistanceInputs()) {
				return;
			}

			const requestRevision = startRouteRequest();

			return yield* Effect.gen(function* () {
				const payload = yield* requestRouteCalculationEffect(
					yield* buildPlannerCurrentRouteRequest(
						dependencies.getPlannerFormState(),
						yield* getPlannerManualEditingRequest(
							getActiveRoute(),
							lockedSegmentIndexes,
						),
						yield* getPlannerAvoidanceRequest(avoidedRoads),
					),
					requestRevision,
				);

				if (!payload) {
					return;
				}

				if (!isCurrentRouteRequest(requestRevision)) {
					return;
				}

				yield* applyRouteCalculationPayloadEffect(payload, true);
				dependencies.markUnsaved();
			}).pipe(
				Effect.catchTags({
					PlannerRouteRequestError: (error) =>
						Effect.sync(() => {
							console.error("Failed to generate route", error.cause);
							const plannerMode =
								dependencies.getPlannerFormState().plannerMode;
							routeRequestError =
								plannerMode === "round_course"
									? "The round-course request failed before we heard back from GraphHopper."
									: plannerMode === "out_and_back"
										? "The out-and-back request failed before we heard back from GraphHopper."
										: "The route request failed before we heard back from GraphHopper.";
						}),
					PlannerRouteResponseError: (error) =>
						Effect.sync(() => {
							console.error("Failed to generate route", error.message);
							const plannerMode =
								dependencies.getPlannerFormState().plannerMode;
							routeRequestError =
								plannerMode === "round_course"
									? "The round-course request failed before we heard back from GraphHopper."
									: plannerMode === "out_and_back"
										? "The out-and-back request failed before we heard back from GraphHopper."
										: "The route request failed before we heard back from GraphHopper.";
						}),
				}),
				Effect.ensuring(
					Effect.sync(() => {
						finishRouteRequest(requestRevision);
					}),
				),
			);
		},
	);

	function handleGenerateRoute(event: SubmitEvent) {
		event.preventDefault();
		return handleGenerateRouteEffect();
	}

	return {
		get routeRequestError() {
			return routeRequestError;
		},
		get isRouting() {
			return isRouting;
		},
		get routeAlternatives() {
			return routeAlternatives;
		},
		get selectedRouteIndex() {
			return selectedRouteIndex;
		},
		get routeNeedsRecalculation() {
			return routeNeedsRecalculation;
		},
		get lockedSegmentIndexes() {
			return lockedSegmentIndexes;
		},
		get avoidedRoads() {
			return avoidedRoads;
		},
		get lastGeneratedRouteCount() {
			return lastGeneratedRouteCount;
		},
		get fitInitialSavedRouteBounds() {
			return fitInitialSavedRouteBounds;
		},
		set fitInitialSavedRouteBounds(value) {
			fitInitialSavedRouteBounds = value;
		},
		get undoStack() {
			return undoStack;
		},
		get redoStack() {
			return redoStack;
		},
		get activeRoute() {
			return getActiveRoute();
		},
		get activeDirections() {
			return getActiveDirections();
		},
		get activeTurnCount() {
			return getActiveTurnCount();
		},
		get activeRoundCourseTarget() {
			return getActiveRoundCourseTarget();
		},
		get activeImportedRouteSource() {
			return getActiveImportedRouteSource();
		},
		get alternativeInfoMessage() {
			return getAlternativeInfoMessage();
		},
		get canUndoRouteEdit() {
			return getCanUndoRouteEdit();
		},
		get canRedoRouteEdit() {
			return getCanRedoRouteEdit();
		},
		getPlannerRouteState,
		applyPlannerRouteState,
		syncStopsFromRoute,
		syncActiveRouteManualEditing,
		setRouteAlternativesState,
		setSingleRouteState,
		selectRouteAlternative,
		markPlannerEdited,
		captureRouteEditSnapshot,
		performRouteEdit,
		performAsyncRouteEdit,
		undoRouteEdit,
		redoRouteEdit,
		clearRouteEditHistory,
		removeAvoidedRoad,
		requestRouteCalculation,
		rerouteAfterManualEdit,
		isLockedStopIndex,
		handleGenerateRoute,
		handleRouteEditKeydown,
		getActiveRouteForSaving,
		setRouteRequestError,
		setRouteNeedsRecalculation,
		setLastGeneratedRouteCount,
		setLockedSegmentIndexes,
		setAvoidedRoads,
		clearManualRouteState,
	};
}

export type PlannerRoutesController = ReturnType<
	typeof createPlannerRoutesController
>;
