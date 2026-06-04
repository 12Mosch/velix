import { Effect } from "effect";
import {
	parseRouteGpxEffect,
	type RouteGpxImportError,
} from "$lib/route-gpx-import";
import { downloadRouteFit, downloadRouteGpx } from "$lib/route-export";
import type { PlannedRoute } from "$lib/route-planning";
import { PlannerGpxFileReadError } from "./planner-controller-errors";

type PlannerImportExportControllerDependencies = {
	getActiveRoute: () => PlannedRoute | null;
	getRouteNeedsRecalculation: () => boolean;
	closeCompletionMenu: () => void;
	closeMapClickMenu: () => void;
	setSingleRouteState: (route: PlannedRoute) => void;
	setLastGeneratedRouteCount: (count: number | null) => void;
	syncStopsFromRoute: (route: PlannedRoute) => void;
	markImportedRouteReplaced: () => void;
	setRouteNeedsRecalculation: (value: boolean) => void;
	setRouteRequestError: (value: string | null) => void;
	clearFieldErrors: () => void;
	resetAnalysisState: () => void;
	clearRouteEditHistory: () => void;
	bumpRouteSaveRevision: () => void;
	scheduleActiveRouteAutosave: () => void;
};

export function createPlannerImportExportController(
	dependencies: PlannerImportExportControllerDependencies,
) {
	let routeImportError = $state<string | null>(null);
	let isImportingGpx = $state(false);
	let routeExportError = $state<string | null>(null);
	let gpxImportInput = $state<HTMLInputElement | null>(null);

	function setRouteImportError(value: string | null) {
		routeImportError = value;
	}

	function setRouteExportError(value: string | null) {
		routeExportError = value;
	}

	function handleExportGpx() {
		const activeRoute = dependencies.getActiveRoute();
		if (!activeRoute || dependencies.getRouteNeedsRecalculation()) {
			return;
		}

		routeExportError = null;

		try {
			downloadRouteGpx(activeRoute);
		} catch (error) {
			routeExportError =
				error instanceof Error
					? `Could not export GPX: ${error.message}`
					: "Could not export GPX.";
		}
	}

	function handleExportFit() {
		const activeRoute = dependencies.getActiveRoute();
		if (!activeRoute || dependencies.getRouteNeedsRecalculation()) {
			return;
		}

		routeExportError = null;

		try {
			downloadRouteFit(activeRoute);
		} catch (error) {
			routeExportError =
				error instanceof Error
					? `Could not export FIT: ${error.message}`
					: "Could not export FIT.";
		}
	}

	function openGpxImportPicker() {
		routeImportError = null;
		gpxImportInput?.click();
	}

	const readFileTextEffect = Effect.fn("readFileTextEffect")(function* (
		file: File,
	) {
		return yield* Effect.tryPromise({
			try: () => file.text(),
			catch: (cause) => new PlannerGpxFileReadError({ cause }),
		});
	});

	const handleGpxImportSelectionEffect = Effect.fn(
		"handleGpxImportSelectionEffect",
	)(function* (input: HTMLInputElement) {
		const selectedFile = input.files?.[0];

		if (!selectedFile) {
			return;
		}

		isImportingGpx = true;
		routeImportError = null;

		return yield* Effect.gen(function* () {
			const importedRoute = yield* readFileTextEffect(selectedFile).pipe(
				Effect.flatMap((text) =>
					parseRouteGpxEffect(text, {
						filename: selectedFile.name,
					}),
				),
			);

			dependencies.closeCompletionMenu();
			dependencies.closeMapClickMenu();
			dependencies.setSingleRouteState(importedRoute);
			dependencies.setLastGeneratedRouteCount(null);
			dependencies.syncStopsFromRoute(importedRoute);
			dependencies.markImportedRouteReplaced();
			dependencies.setRouteNeedsRecalculation(false);
			dependencies.setRouteRequestError(null);
			routeExportError = null;
			dependencies.clearFieldErrors();
			dependencies.resetAnalysisState();
			dependencies.clearRouteEditHistory();
			dependencies.bumpRouteSaveRevision();
			dependencies.scheduleActiveRouteAutosave();
		}).pipe(
			Effect.catchTags({
				PlannerGpxFileReadError: (error) =>
					Effect.sync(() => {
						console.error("Failed to read GPX file", error.cause);
						routeImportError = "Could not import the selected GPX file.";
					}),
				RouteGpxImportError: (error: RouteGpxImportError) =>
					Effect.sync(() => {
						console.error("Failed to import GPX", error);
						routeImportError = error.message;
					}),
			}),
			Effect.ensuring(
				Effect.sync(() => {
					isImportingGpx = false;
					input.value = "";
				}),
			),
		);
	});

	function handleGpxImportSelection(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		return handleGpxImportSelectionEffect(input);
	}

	return {
		get routeImportError() {
			return routeImportError;
		},
		get isImportingGpx() {
			return isImportingGpx;
		},
		get routeExportError() {
			return routeExportError;
		},
		get gpxImportInput() {
			return gpxImportInput;
		},
		set gpxImportInput(value) {
			gpxImportInput = value;
		},
		handleExportGpx,
		handleExportFit,
		openGpxImportPicker,
		handleGpxImportSelection,
		setRouteImportError,
		setRouteExportError,
	};
}

export type PlannerImportExportController = ReturnType<
	typeof createPlannerImportExportController
>;
