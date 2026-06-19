import { Cause, Effect, Exit, type Fiber, Semaphore } from "effect";
import type { PlannedRoute } from "$lib/route-planning";
import {
	deleteSavedRouteEffect,
	getSavedRouteByIdEffect,
	isPlannedRoute,
	type SavedRoute,
	savedRoutesState,
	upsertSavedRouteEffect,
} from "$lib/saved-routes.svelte";
import { cloneRoute } from "$lib/saved-routes-core";
import { PlannerSavedRouteError } from "./planner-controller-errors";

type PlannerSaveControllerDependencies = {
	isDestroyed: () => boolean;
	getRouteNeedsRecalculation: () => boolean;
	getActiveRoute: () => PlannedRoute | null;
	getActiveRouteForSaving: () => PlannedRoute | null;
	setSingleRouteState: (route: PlannedRoute) => void;
	setLastGeneratedRouteCount: (count: number | null) => void;
	syncStopsFromRoute: (route: PlannedRoute) => void;
	setRouteNeedsRecalculation: (value: boolean) => void;
	setRouteRequestError: (value: string | null) => void;
	clearFieldErrors: () => void;
	resetAnalysisState: () => void;
	clearRouteEditHistory: () => void;
};

type PendingSavedRouteRestore = {
	id: string;
	routeSaveRevision: number;
};

const autosaveDebounceMs = 750;

export function createPlannerSaveController(
	dependencies: PlannerSaveControllerDependencies,
) {
	let saveSyncError = $state<string | null>(null);
	let activeSavedRouteId = $state<string | null>(null);
	let plannerDraftRouteId = $state<string | null>(null);
	let isActiveRouteSaved = $state(false);
	let pendingSavedRouteRestore = $state<PendingSavedRouteRestore | null>(null);
	let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
	let isSaveControllerDestroyed = false;
	let routeSaveRevision = 0;
	let lastAutosavedRouteId: string | null = null;
	let lastAutosavedRevision: number | null = null;
	const saveSemaphore = Semaphore.makeUnsafe(1);
	const inFlightSaveFibers = new Set<Fiber.Fiber<unknown, unknown>>();

	$effect(() => {
		saveSyncError = savedRoutesState.syncError;
	});

	$effect(() => {
		if (!pendingSavedRouteRestore) {
			return;
		}

		savedRoutesState.savedRoutes;
		runSaveEffect(
			restorePendingSavedRoute(),
			"Failed to restore pending saved route.",
		);
	});

	function reportSaveEffectFailure(message: string, cause: unknown) {
		console.error(message, cause);
		saveSyncError =
			cause instanceof Error
				? cause.message
				: typeof cause === "string"
					? cause
					: message;
	}

	function runSaveEffect(
		effect: Effect.Effect<unknown, unknown>,
		errorMessage: string,
	) {
		const fiber = Effect.runFork(effect);
		inFlightSaveFibers.add(fiber);
		fiber.addObserver((exit) => {
			inFlightSaveFibers.delete(fiber);
			if (!isSaveControllerDestroyed && Exit.isFailure(exit)) {
				reportSaveEffectFailure(errorMessage, Cause.squash(exit.cause));
			}
		});
	}

	function destroy() {
		isSaveControllerDestroyed = true;
		cancelAutosaveTimer();
		for (const fiber of inFlightSaveFibers) {
			fiber.interruptUnsafe();
		}
		inFlightSaveFibers.clear();
	}

	function bumpRouteSaveRevision() {
		pendingSavedRouteRestore = null;
		routeSaveRevision += 1;
	}

	function getPendingSavedRouteId() {
		return pendingSavedRouteRestore?.id ?? null;
	}

	function setPendingSavedRouteRestore(id: string | null) {
		pendingSavedRouteRestore = id === null ? null : { id, routeSaveRevision };
	}

	function isPendingSavedRouteRestoreCurrent(token: PendingSavedRouteRestore) {
		return (
			pendingSavedRouteRestore?.id === token.id &&
			pendingSavedRouteRestore.routeSaveRevision === token.routeSaveRevision &&
			routeSaveRevision === token.routeSaveRevision
		);
	}

	function clearPendingSavedRouteRestore(token: PendingSavedRouteRestore) {
		if (
			pendingSavedRouteRestore?.id === token.id &&
			pendingSavedRouteRestore.routeSaveRevision === token.routeSaveRevision
		) {
			pendingSavedRouteRestore = null;
		}
	}

	function captureSavedRouteEditMetadata() {
		return {
			activeSavedRouteId,
			plannerDraftRouteId,
			pendingSavedRouteId: getPendingSavedRouteId(),
			pendingSavedRouteRestoreRevision:
				pendingSavedRouteRestore?.routeSaveRevision ?? null,
			isActiveRouteSaved,
		};
	}

	function restoreSavedRouteEditMetadata(metadata: {
		activeSavedRouteId: string | null;
		plannerDraftRouteId: string | null;
		pendingSavedRouteId: string | null;
		pendingSavedRouteRestoreRevision: number | null;
		isActiveRouteSaved: boolean;
	}) {
		activeSavedRouteId = metadata.activeSavedRouteId;
		plannerDraftRouteId = metadata.plannerDraftRouteId;
		pendingSavedRouteRestore =
			metadata.pendingSavedRouteId === null ||
			metadata.pendingSavedRouteRestoreRevision === null
				? null
				: {
						id: metadata.pendingSavedRouteId,
						routeSaveRevision: metadata.pendingSavedRouteRestoreRevision,
					};
		isActiveRouteSaved = metadata.isActiveRouteSaved;
	}

	function markUnsaved() {
		activeSavedRouteId = null;
		isActiveRouteSaved = false;
		bumpRouteSaveRevision();
	}

	function markReplaced() {
		activeSavedRouteId = null;
		plannerDraftRouteId = null;
		isActiveRouteSaved = false;
		lastAutosavedRouteId = null;
		lastAutosavedRevision = null;
		bumpRouteSaveRevision();
	}

	function setPendingSavedRouteId(id: string | null) {
		setPendingSavedRouteRestore(id);
	}

	function queueSavedRouteRestoreFromLocation(location: Location) {
		const savedRouteId = new URLSearchParams(location.search).get("savedRoute");

		setPendingSavedRouteRestore(savedRouteId);
	}

	function cancelAutosaveTimer() {
		if (!autosaveTimer) {
			return;
		}

		clearTimeout(autosaveTimer);
		autosaveTimer = null;
	}

	function getActiveRouteForSaving(): PlannedRoute | null {
		return dependencies.getActiveRouteForSaving();
	}

	const saveActiveRouteDraftUnserializedEffect = Effect.fn(
		"saveActiveRouteDraftUnserializedEffect",
	)(function* (
		options: {
			force?: boolean;
			source?: "autosave" | "explicit" | "share";
		} = {},
	) {
		cancelAutosaveTimer();
		if (isSaveControllerDestroyed || dependencies.isDestroyed()) {
			return null;
		}
		if (dependencies.getRouteNeedsRecalculation()) {
			return null;
		}

		const routeId = plannerDraftRouteId ?? activeSavedRouteId;
		const createdNewRoute = !routeId;

		if (
			!options.force &&
			options.source === "autosave" &&
			routeId === lastAutosavedRouteId &&
			routeSaveRevision === lastAutosavedRevision
		) {
			return null;
		}

		const activeRouteForSaving = getActiveRouteForSaving();

		if (!activeRouteForSaving) {
			return null;
		}
		const routeForSaving = cloneRoute(activeRouteForSaving);
		const savedRevision = routeSaveRevision;

		const savedRoute = yield* upsertSavedRouteEffect(
			routeForSaving,
			plannerDraftRouteId ?? activeSavedRouteId ?? undefined,
			{ source: options.source },
		).pipe(
			Effect.mapError(
				(cause) => new PlannerSavedRouteError({ operation: "upsert", cause }),
			),
		);
		if (isSaveControllerDestroyed || dependencies.isDestroyed()) {
			if (createdNewRoute) {
				yield* deleteSavedRouteEffect(savedRoute.id);
			}
			return null;
		}
		plannerDraftRouteId = savedRoute.id;
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
		if (savedRevision === routeSaveRevision) {
			lastAutosavedRouteId = savedRoute.id;
			lastAutosavedRevision = savedRevision;
		} else if (options.source === "autosave") {
			scheduleActiveRouteAutosave();
		}
		return savedRoute;
	});

	const saveActiveRouteDraftEffect = Effect.fn("saveActiveRouteDraftEffect")(
		function* (
			options: {
				force?: boolean;
				source?: "autosave" | "explicit" | "share";
			} = {},
		) {
			return yield* saveSemaphore.withPermit(
				saveActiveRouteDraftUnserializedEffect(options),
			);
		},
	);

	function saveActiveRouteDraft(
		options: {
			force?: boolean;
			source?: "autosave" | "explicit" | "share";
		} = {},
	) {
		return saveActiveRouteDraftEffect(options);
	}

	function scheduleActiveRouteAutosave() {
		cancelAutosaveTimer();
		if (
			isSaveControllerDestroyed ||
			dependencies.isDestroyed() ||
			dependencies.getRouteNeedsRecalculation()
		) {
			return;
		}

		autosaveTimer = setTimeout(() => {
			runSaveEffect(
				saveActiveRouteDraft({ source: "autosave" }),
				"Failed to autosave route.",
			);
		}, autosaveDebounceMs);
	}

	const restoreSavedRouteFromLocationEffect = Effect.fn(
		"restoreSavedRouteFromLocationEffect",
	)(function* (location: Location) {
		queueSavedRouteRestoreFromLocation(location);
		yield* restorePendingSavedRouteEffect();
	});

	function restoreSavedRouteFromLocation(location: Location) {
		return restoreSavedRouteFromLocationEffect(location);
	}

	const restorePendingSavedRouteEffect = Effect.fn(
		"restorePendingSavedRouteEffect",
	)(function* () {
		const pendingRestore = pendingSavedRouteRestore;

		if (!pendingRestore) {
			return;
		}

		if (!isPendingSavedRouteRestoreCurrent(pendingRestore)) {
			clearPendingSavedRouteRestore(pendingRestore);
			return;
		}

		const savedRoute = yield* getSavedRouteByIdEffect(pendingRestore.id).pipe(
			Effect.mapError(
				(cause) => new PlannerSavedRouteError({ operation: "read", cause }),
			),
		);

		if (!isPendingSavedRouteRestoreCurrent(pendingRestore)) {
			clearPendingSavedRouteRestore(pendingRestore);
			return;
		}

		if (!savedRoute) {
			return;
		}

		restoreSavedRoute(savedRoute);
		clearPendingSavedRouteRestore(pendingRestore);
	});

	function restorePendingSavedRoute() {
		return restorePendingSavedRouteEffect();
	}

	function restoreSavedRoute(savedRoute: SavedRoute) {
		if (!isPlannedRoute(savedRoute.route)) {
			return;
		}

		dependencies.setSingleRouteState(savedRoute.route);
		dependencies.setLastGeneratedRouteCount(null);
		dependencies.syncStopsFromRoute(savedRoute.route);
		activeSavedRouteId = savedRoute.id;
		plannerDraftRouteId = savedRoute.id;
		isActiveRouteSaved = true;
		dependencies.setRouteNeedsRecalculation(false);
		dependencies.setRouteRequestError(null);
		dependencies.clearFieldErrors();
		dependencies.resetAnalysisState();
		dependencies.clearRouteEditHistory();
	}

	const handleSaveDraftUnserializedEffect = Effect.fn(
		"handleSaveDraftUnserializedEffect",
	)(function* () {
		if (isSaveControllerDestroyed || dependencies.isDestroyed()) {
			return;
		}
		if (
			!dependencies.getActiveRoute() ||
			dependencies.getRouteNeedsRecalculation()
		) {
			return;
		}

		if (isActiveRouteSaved && activeSavedRouteId) {
			const deletedRouteId = activeSavedRouteId;
			cancelAutosaveTimer();
			yield* deleteSavedRouteEffect(deletedRouteId).pipe(
				Effect.mapError(
					(cause) => new PlannerSavedRouteError({ operation: "delete", cause }),
				),
			);
			if (plannerDraftRouteId === deletedRouteId) {
				plannerDraftRouteId = null;
			}
			activeSavedRouteId = null;
			isActiveRouteSaved = false;
			return;
		}

		const savedRoute = yield* saveActiveRouteDraftUnserializedEffect({
			force: true,
			source: "explicit",
		});
		if (!savedRoute) {
			return;
		}
		plannerDraftRouteId = savedRoute.id;
		activeSavedRouteId = savedRoute.id;
		isActiveRouteSaved = true;
	});

	const handleSaveDraftEffect = Effect.fn("handleSaveDraftEffect")(
		function* () {
			return yield* saveSemaphore.withPermit(
				handleSaveDraftUnserializedEffect(),
			);
		},
	);

	function handleSaveDraft() {
		return handleSaveDraftEffect();
	}

	return {
		get saveSyncError() {
			return saveSyncError;
		},
		get activeSavedRouteId() {
			return activeSavedRouteId;
		},
		get plannerDraftRouteId() {
			return plannerDraftRouteId;
		},
		get isActiveRouteSaved() {
			return isActiveRouteSaved;
		},
		get pendingSavedRouteId() {
			return getPendingSavedRouteId();
		},
		get routeSaveRevision() {
			return routeSaveRevision;
		},
		destroy,
		cancelAutosaveTimer,
		getActiveRouteForSaving,
		saveActiveRouteDraft,
		scheduleActiveRouteAutosave,
		queueSavedRouteRestoreFromLocation,
		restoreSavedRouteFromLocation,
		restorePendingSavedRoute,
		restoreSavedRoute,
		handleSaveDraft,
		bumpRouteSaveRevision,
		markUnsaved,
		markReplaced,
		setPendingSavedRouteId,
		captureSavedRouteEditMetadata,
		restoreSavedRouteEditMetadata,
	};
}

export type PlannerSaveController = ReturnType<
	typeof createPlannerSaveController
>;
