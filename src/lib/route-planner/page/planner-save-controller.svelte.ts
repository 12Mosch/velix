import { Cause, Effect, Exit } from "effect";
import {
	deleteSavedRouteEffect,
	getSavedRouteByIdEffect,
	isPlannedRoute,
	savedRoutesState,
	type SavedRoute,
	upsertSavedRouteEffect,
} from "$lib/saved-routes.svelte";
import { cloneRoute } from "$lib/saved-routes-core";
import type { PlannedRoute } from "$lib/route-planning";
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

const autosaveDebounceMs = 750;

export function createPlannerSaveController(
	dependencies: PlannerSaveControllerDependencies,
) {
	let saveSyncError = $state<string | null>(null);
	let activeSavedRouteId = $state<string | null>(null);
	let plannerDraftRouteId = $state<string | null>(null);
	let isActiveRouteSaved = $state(false);
	let pendingSavedRouteId = $state<string | null>(null);
	let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
	let routeSaveRevision = 0;
	let lastAutosavedRouteId: string | null = null;
	let lastAutosavedRevision: number | null = null;

	$effect(() => {
		saveSyncError = savedRoutesState.syncError;
	});

	$effect(() => {
		if (!pendingSavedRouteId) {
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
		void Effect.runPromiseExit(effect).then((exit) => {
			if (Exit.isFailure(exit)) {
				reportSaveEffectFailure(errorMessage, Cause.squash(exit.cause));
			}
		});
	}

	function bumpRouteSaveRevision() {
		routeSaveRevision += 1;
	}

	function captureSavedRouteEditMetadata() {
		return {
			activeSavedRouteId,
			plannerDraftRouteId,
			pendingSavedRouteId,
			isActiveRouteSaved,
		};
	}

	function restoreSavedRouteEditMetadata(metadata: {
		activeSavedRouteId: string | null;
		plannerDraftRouteId: string | null;
		pendingSavedRouteId: string | null;
		isActiveRouteSaved: boolean;
	}) {
		activeSavedRouteId = metadata.activeSavedRouteId;
		plannerDraftRouteId = metadata.plannerDraftRouteId;
		pendingSavedRouteId = metadata.pendingSavedRouteId;
		isActiveRouteSaved = metadata.isActiveRouteSaved;
	}

	function markUnsaved() {
		activeSavedRouteId = null;
		isActiveRouteSaved = false;
		pendingSavedRouteId = null;
		bumpRouteSaveRevision();
	}

	function markReplaced() {
		activeSavedRouteId = null;
		plannerDraftRouteId = null;
		isActiveRouteSaved = false;
		pendingSavedRouteId = null;
		lastAutosavedRouteId = null;
		lastAutosavedRevision = null;
		bumpRouteSaveRevision();
	}

	function setPendingSavedRouteId(id: string | null) {
		pendingSavedRouteId = id;
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

	const saveActiveRouteDraftEffect = Effect.fn("saveActiveRouteDraftEffect")(
		function* (
			options: {
				force?: boolean;
				source?: "autosave" | "explicit" | "share";
			} = {},
		) {
			cancelAutosaveTimer();
			if (dependencies.isDestroyed()) {
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
			if (dependencies.isDestroyed()) {
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
		const savedRouteId = new URLSearchParams(location.search).get("savedRoute");

		if (!savedRouteId) {
			return;
		}

		const savedRoute = yield* getSavedRouteByIdEffect(savedRouteId).pipe(
			Effect.mapError(
				(cause) => new PlannerSavedRouteError({ operation: "read", cause }),
			),
		);

		if (!savedRoute) {
			pendingSavedRouteId = savedRouteId;
			return;
		}

		restoreSavedRoute(savedRoute);
	});

	function restoreSavedRouteFromLocation(location: Location) {
		return restoreSavedRouteFromLocationEffect(location);
	}

	const restorePendingSavedRouteEffect = Effect.fn(
		"restorePendingSavedRouteEffect",
	)(function* () {
		if (!pendingSavedRouteId) {
			return;
		}

		const savedRoute = yield* getSavedRouteByIdEffect(pendingSavedRouteId).pipe(
			Effect.mapError(
				(cause) => new PlannerSavedRouteError({ operation: "read", cause }),
			),
		);

		if (!savedRoute) {
			return;
		}

		restoreSavedRoute(savedRoute);
		pendingSavedRouteId = null;
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

	const handleSaveDraftEffect = Effect.fn("handleSaveDraftEffect")(
		function* () {
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
						(cause) =>
							new PlannerSavedRouteError({ operation: "delete", cause }),
					),
				);
				if (plannerDraftRouteId === deletedRouteId) {
					plannerDraftRouteId = null;
				}
				activeSavedRouteId = null;
				isActiveRouteSaved = false;
				return;
			}

			const savedRoute = yield* saveActiveRouteDraftEffect({
				force: true,
				source: "explicit",
			});
			if (!savedRoute) {
				return;
			}
			plannerDraftRouteId = savedRoute.id;
			activeSavedRouteId = savedRoute.id;
			isActiveRouteSaved = true;
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
			return pendingSavedRouteId;
		},
		get routeSaveRevision() {
			return routeSaveRevision;
		},
		cancelAutosaveTimer,
		getActiveRouteForSaving,
		saveActiveRouteDraft,
		scheduleActiveRouteAutosave,
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
