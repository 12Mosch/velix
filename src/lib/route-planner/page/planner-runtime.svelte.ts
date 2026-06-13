import { Effect } from "effect";
import { initSavedRoutes } from "$lib/saved-routes.svelte";
import { initUnitPreference } from "$lib/unit-settings.svelte";

type PlannerRuntimeDependencies = {
	resetSpatialConstraintDefaults: () => void;
	restoreSavedRouteFromLocation: (
		location: Location,
	) => Effect.Effect<void, unknown>;
	handleRouteEditKeydown: (event: KeyboardEvent) => void;
	runCleanup?: () => void;
};

export function createPlannerRuntime(dependencies: PlannerRuntimeDependencies) {
	let clientFetch = $state<typeof window.fetch | null>(null);
	let browserWindow = $state<Window | null>(null);
	let destroyed = $state(true);
	let mountRevision = 0;
	let detachRouteEditKeyboardListener = () => {};
	const cleanupCallbacks: Array<() => void> = [];

	function registerCleanup(callback: () => void) {
		cleanupCallbacks.push(callback);
		return () => {
			const index = cleanupCallbacks.indexOf(callback);
			if (index >= 0) {
				cleanupCallbacks.splice(index, 1);
			}
		};
	}

	function mount(nextWindow: Window) {
		destroyed = false;
		mountRevision += 1;
		const currentMountRevision = mountRevision;
		browserWindow = nextWindow;
		clientFetch = nextWindow.fetch.bind(nextWindow);
		Effect.runSync(initUnitPreference());
		dependencies.resetSpatialConstraintDefaults();
		void initSavedRoutes()
			.then(() => {
				if (destroyed || currentMountRevision !== mountRevision) {
					return;
				}

				return Effect.runPromise(
					dependencies.restoreSavedRouteFromLocation(nextWindow.location),
				);
			})
			.catch((error) => {
				console.error("Failed to initialize saved routes.", error);
			});

		nextWindow.addEventListener("keydown", dependencies.handleRouteEditKeydown);
		detachRouteEditKeyboardListener = () => {
			nextWindow.removeEventListener(
				"keydown",
				dependencies.handleRouteEditKeydown,
			);
			detachRouteEditKeyboardListener = () => {};
		};
	}

	function destroy() {
		destroyed = true;
		mountRevision += 1;
		try {
			detachRouteEditKeyboardListener();
		} catch (error) {
			console.error("Failed to detach route edit keyboard listener.", error);
		}

		for (const cleanup of cleanupCallbacks.toReversed()) {
			try {
				cleanup();
			} catch (error) {
				console.error("Failed to run planner cleanup callback.", error);
			}
		}
		cleanupCallbacks.length = 0;
		try {
			dependencies.runCleanup?.();
		} catch (error) {
			console.error("Failed to run planner runtime cleanup.", error);
		}
		browserWindow = null;
		clientFetch = null;
	}

	function getFetch() {
		return clientFetch;
	}

	function getWindow() {
		return browserWindow;
	}

	function isDestroyed() {
		return destroyed;
	}

	return {
		mount,
		destroy,
		getFetch,
		getWindow,
		isDestroyed,
		registerCleanup,
		get clientFetch() {
			return clientFetch;
		},
		get browserWindow() {
			return browserWindow;
		},
	};
}

export type PlannerRuntime = ReturnType<typeof createPlannerRuntime>;
