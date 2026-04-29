import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	type SavedRoutesRepository,
} from "$lib/saved-routes/saved-routes-repository";
import {
	type SavedRoutesStateModel,
	SavedRoutesUseCases,
} from "$lib/saved-routes/saved-routes-use-cases";
import type { BrowserStorage } from "$lib/storage/browser-storage";

const route: PlannedRoute = {
	mode: "point_to_point",
	source: {
		kind: "graphhopper",
	},
	startLabel: "Marienplatz, Munich, Germany",
	destinationLabel: "Schliersee, Germany",
	waypoints: [],
	bounds: [11.5755, 47.7362, 11.8598, 48.1374],
	distanceMeters: 61234,
	durationMs: 9876000,
	ascendMeters: 820,
	descendMeters: 740,
	coordinates: [
		[11.5755, 48.1374, 520],
		[11.8598, 47.7362, 785],
	],
	surfaceDetails: [],
	smoothnessDetails: [],
};

function createState(): SavedRoutesStateModel {
	return {
		initialized: false,
		savedRoutes: [],
		authStatus: "signedOut",
		authUserId: null,
		remoteReady: false,
		syncError: null,
		pendingRemoteRouteIds: new Set(),
	};
}

function createMemoryStorage(): BrowserStorage {
	const values = new Map<string, string>();

	return {
		get length() {
			return values.size;
		},
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("saved routes use cases", () => {
	let repository: SavedRoutesRepository;
	let useCases: SavedRoutesUseCases;
	let state: SavedRoutesStateModel;

	beforeEach(() => {
		repository = createSavedRoutesRepository(createMemoryStorage());
		useCases = new SavedRoutesUseCases(repository);
		state = createState();
	});

	it("optimistically saves signed-in routes and clears pending state after remote success", async () => {
		const save = vi.fn().mockResolvedValue(undefined);

		useCases.setAuthUser(state, "user_1");
		useCases.setRemoteRepository({
			save,
			delete: vi.fn(),
			mergeLocalRoutes: vi.fn(),
		});

		const savedRoute = useCases.createSavedRoute(state, route);

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		await flushPromises();

		expect(save).toHaveBeenCalledWith(savedRoute);
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBeNull();
	});

	it("applies sorted remote snapshots only for the active signed-in user", () => {
		vi.useFakeTimers();

		try {
			useCases.setAuthUser(state, "user_1");
			vi.setSystemTime(new Date("2026-04-19T09:30:00.000Z"));
			const older = useCases.createSavedRoute(state, route);
			vi.setSystemTime(new Date("2026-04-20T09:30:00.000Z"));
			const newer = {
				...useCases.createSavedRoute(state, route),
				id: "newer",
			};

			useCases.applyRemoteSavedRoutes(state, "other_user", [newer]);
			expect(state.savedRoutes.map((savedRoute) => savedRoute.id)).not.toEqual([
				"newer",
			]);

			useCases.applyRemoteSavedRoutes(state, "user_1", [older, newer]);
			expect(state.savedRoutes.map((savedRoute) => savedRoute.id)).toEqual([
				"newer",
				older.id,
			]);
			expect(state.remoteReady).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("runs anonymous route merge once per signed-in user", async () => {
		const anonymous = useCases.createSavedRoute(state, route);
		const mergeLocalRoutes = vi.fn().mockResolvedValue({
			inserted: 1,
			skipped: 0,
			invalid: 0,
			duplicate: 0,
		});

		useCases.setAuthUser(state, "user_1");
		useCases.setRemoteRepository({
			save: vi.fn(),
			delete: vi.fn(),
			mergeLocalRoutes,
		});

		await useCases.runLocalSavedRoutesMergeOnce(state, "user_1");
		await useCases.runLocalSavedRoutesMergeOnce(state, "user_1");

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		expect(mergeLocalRoutes).toHaveBeenCalledWith([anonymous]);
	});
});
