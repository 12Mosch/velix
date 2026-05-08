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
import { serializeSavedRouteForRemote } from "$lib/saved-routes-core";
import type { BrowserStorage } from "$lib/storage/browser-storage";
import { Effect } from "effect";

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

		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save,
				delete: vi.fn(),
				mergeLocalRoutes: vi.fn(),
			}),
		);

		const savedRoute = Effect.runSync(useCases.createSavedRoute(state, route));

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		await flushPromises();

		expect(save).toHaveBeenCalledWith(serializeSavedRouteForRemote(savedRoute));
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBeNull();
	});

	it("applies sorted remote snapshots only for the active signed-in user", () => {
		vi.useFakeTimers();

		try {
			Effect.runSync(useCases.setAuthUser(state, "user_1"));
			vi.setSystemTime(new Date("2026-04-19T09:30:00.000Z"));
			const older = Effect.runSync(useCases.createSavedRoute(state, route));
			vi.setSystemTime(new Date("2026-04-20T09:30:00.000Z"));
			const newer = {
				...Effect.runSync(useCases.createSavedRoute(state, route)),
				id: "newer",
			};

			Effect.runSync(
				useCases.applyRemoteSavedRoutes(state, "other_user", [
					serializeSavedRouteForRemote(newer),
				]),
			);
			expect(state.savedRoutes.map((savedRoute) => savedRoute.id)).not.toEqual([
				"newer",
			]);

			Effect.runSync(
				useCases.applyRemoteSavedRoutes(state, "user_1", [
					serializeSavedRouteForRemote(older),
					serializeSavedRouteForRemote(newer),
				]),
			);
			expect(state.savedRoutes.map((savedRoute) => savedRoute.id)).toEqual([
				"newer",
				older.id,
			]);
			expect(state.remoteReady).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps pending optimistic saves when applying a remote snapshot", () => {
		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn(() => new Promise<void>(() => {})),
				delete: vi.fn(),
				mergeLocalRoutes: vi.fn(),
			}),
		);
		const savedRoute = Effect.runSync(useCases.createSavedRoute(state, route));

		Effect.runSync(useCases.applyRemoteSavedRoutes(state, "user_1", []));

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));
		expect(repository.readUserRoutes("user_1")).toEqual([savedRoute]);
	});

	it("does not resurrect pending optimistic deletes from a remote snapshot", async () => {
		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn(() => new Promise<void>(() => {})),
				mergeLocalRoutes: vi.fn(),
			}),
		);
		const savedRoute = Effect.runSync(useCases.createSavedRoute(state, route));
		await flushPromises();

		Effect.runSync(useCases.deleteSavedRoute(state, savedRoute.id));
		Effect.runSync(
			useCases.applyRemoteSavedRoutes(state, "user_1", [
				serializeSavedRouteForRemote(savedRoute),
			]),
		);

		expect(state.savedRoutes).toEqual([]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));
		expect(repository.readUserRoutes("user_1")).toEqual([]);
	});

	it("runs anonymous route merge once per signed-in user", async () => {
		const anonymous = Effect.runSync(useCases.createSavedRoute(state, route));
		const mergeLocalRoutes = vi.fn().mockResolvedValue({
			inserted: 1,
			skipped: 0,
			invalid: 0,
			duplicate: 0,
		});

		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn(),
				delete: vi.fn(),
				mergeLocalRoutes,
			}),
		);

		await Effect.runPromise(
			useCases.runLocalSavedRoutesMergeOnce(state, "user_1"),
		);
		await Effect.runPromise(
			useCases.runLocalSavedRoutesMergeOnce(state, "user_1"),
		);

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		expect(mergeLocalRoutes).toHaveBeenCalledWith([
			serializeSavedRouteForRemote(anonymous),
		]);
	});

	it("sets syncError after remote save failure without losing the optimistic route", async () => {
		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn().mockRejectedValue(new Error("network down")),
				delete: vi.fn(),
				mergeLocalRoutes: vi.fn(),
			}),
		);

		const savedRoute = Effect.runSync(useCases.createSavedRoute(state, route));
		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		await flushPromises();

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBe("Could not sync saved route: network down");
	});

	it("does not apply stale remote save failures after sign-out", async () => {
		let rejectSave: (error: Error) => void = () => {};
		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn(
					() =>
						new Promise<void>((_, reject) => {
							rejectSave = reject;
						}),
				),
				delete: vi.fn(),
				mergeLocalRoutes: vi.fn(),
			}),
		);
		const savedRoute = Effect.runSync(useCases.createSavedRoute(state, route));
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		Effect.runSync(useCases.setAuthUser(state, null));
		rejectSave(new Error("late failure"));
		await flushPromises();

		expect(state.authStatus).toBe("signedOut");
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBeNull();
	});

	it("reuses an in-flight anonymous route merge for concurrent calls", async () => {
		const anonymous = Effect.runSync(useCases.createSavedRoute(state, route));
		let resolveMerge: () => void = () => {};
		const mergeLocalRoutes = vi.fn(
			() =>
				new Promise<{
					inserted: number;
					skipped: number;
					invalid: number;
					duplicate: number;
				}>((resolve) => {
					resolveMerge = () =>
						resolve({
							inserted: 1,
							skipped: 0,
							invalid: 0,
							duplicate: 0,
						});
				}),
		);

		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn(),
				delete: vi.fn(),
				mergeLocalRoutes,
			}),
		);

		const firstMerge = Effect.runPromise(
			useCases.runLocalSavedRoutesMergeOnce(state, "user_1"),
		);
		const secondMerge = Effect.runPromise(
			useCases.runLocalSavedRoutesMergeOnce(state, "user_1"),
		);

		await vi.waitFor(() => {
			expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		});
		resolveMerge();
		await Promise.all([firstMerge, secondMerge]);

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		expect(mergeLocalRoutes).toHaveBeenCalledWith([
			serializeSavedRouteForRemote(anonymous),
		]);
	});

	it("does not apply stale local merge failures after sign-out", async () => {
		Effect.runSync(useCases.createSavedRoute(state, route));
		let rejectMerge: (error: Error) => void = () => {};
		const mergeLocalRoutes = vi.fn(
			() =>
				new Promise<{
					inserted: number;
					skipped: number;
					invalid: number;
					duplicate: number;
				}>((_, reject) => {
					rejectMerge = reject;
				}),
		);

		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn(),
				delete: vi.fn(),
				mergeLocalRoutes,
			}),
		);

		const merge = Effect.runPromise(
			useCases.runLocalSavedRoutesMergeOnce(state, "user_1"),
		);
		await vi.waitFor(() => {
			expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		});

		Effect.runSync(useCases.setAuthUser(state, null));
		rejectMerge(new Error("late merge failure"));
		await merge;

		expect(state.authStatus).toBe("signedOut");
		expect(state.syncError).toBeNull();
		expect(repository.readMergedUserIds().has("user_1")).toBe(false);
	});

	it("keeps optimistic delete and sets syncError after remote delete failure", async () => {
		Effect.runSync(useCases.setAuthUser(state, "user_1"));
		Effect.runSync(
			useCases.setRemoteRepository({
				save: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockRejectedValue(new Error("delete down")),
				mergeLocalRoutes: vi.fn(),
			}),
		);
		const savedRoute = Effect.runSync(useCases.createSavedRoute(state, route));
		await flushPromises();

		const deleted = Effect.runSync(
			useCases.deleteSavedRoute(state, savedRoute.id),
		);

		expect(deleted).toBe(true);
		expect(state.savedRoutes).toEqual([]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		await flushPromises();

		expect(state.savedRoutes).toEqual([]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBe("Could not delete synced route: delete down");
	});
});
