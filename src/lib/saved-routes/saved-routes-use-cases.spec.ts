import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	SavedRoutesRepositoryError,
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
	instructions: [],
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
		localRoutesReady: false,
		localSaveError: null,
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

function createDeferred<T = void>() {
	let resolve: (value: T | PromiseLike<T>) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, resolve, reject };
}

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
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

		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
			useCases.setRemoteRepository({
				save,
				delete: vi.fn(),
				mergeLocalRoutes: vi.fn(),
			}),
		);

		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		await flushPromises();

		expect(save).toHaveBeenCalledWith(serializeSavedRouteForRemote(savedRoute));
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBeNull();
	});

	it("applies sorted remote snapshots only for the active signed-in user", async () => {
		vi.useFakeTimers();

		try {
			await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
			vi.setSystemTime(new Date("2026-04-19T09:30:00.000Z"));
			const older = await Effect.runPromise(
				useCases.createSavedRoute(state, route),
			);
			vi.setSystemTime(new Date("2026-04-20T09:30:00.000Z"));
			const newer = {
				...(await Effect.runPromise(useCases.createSavedRoute(state, route))),
				id: "newer",
			};

			await Effect.runPromise(
				useCases.applyRemoteSavedRoutes(state, "other_user", [
					serializeSavedRouteForRemote(newer),
				]),
			);
			expect(state.savedRoutes.map((savedRoute) => savedRoute.id)).not.toEqual([
				"newer",
			]);

			await Effect.runPromise(
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

	it("keeps pending optimistic saves when applying a remote snapshot", async () => {
		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
			useCases.setRemoteRepository({
				save: vi.fn(() => new Promise<void>(() => {})),
				delete: vi.fn(),
				mergeLocalRoutes: vi.fn(),
			}),
		);
		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);

		await Effect.runPromise(
			useCases.applyRemoteSavedRoutes(state, "user_1", []),
		);

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));
		expect(
			await Effect.runPromise(
				repository.readRoutes({ kind: "user", userId: "user_1" }),
			),
		).toEqual([savedRoute]);
	});

	it("does not resurrect pending optimistic deletes from a remote snapshot", async () => {
		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
			useCases.setRemoteRepository({
				save: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn(() => new Promise<void>(() => {})),
				mergeLocalRoutes: vi.fn(),
			}),
		);
		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);
		await flushPromises();

		await Effect.runPromise(useCases.deleteSavedRoute(state, savedRoute.id));
		await Effect.runPromise(
			useCases.applyRemoteSavedRoutes(state, "user_1", [
				serializeSavedRouteForRemote(savedRoute),
			]),
		);

		expect(state.savedRoutes).toEqual([]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));
		expect(
			await Effect.runPromise(
				repository.readRoutes({ kind: "user", userId: "user_1" }),
			),
		).toEqual([]);
	});

	it("runs anonymous route merge once per signed-in user", async () => {
		const anonymous = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);
		const mergeLocalRoutes = vi.fn().mockResolvedValue({
			inserted: 1,
			skipped: 0,
			invalid: 0,
			duplicate: 0,
		});

		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
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
		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
			useCases.setRemoteRepository({
				save: vi.fn().mockRejectedValue(new Error("network down")),
				delete: vi.fn(),
				mergeLocalRoutes: vi.fn(),
			}),
		);

		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);
		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		await flushPromises();

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBe("Could not sync saved route: network down");
	});

	it("sets localSaveError after local persistence failure without losing the optimistic route", async () => {
		const failingRepository: SavedRoutesRepository = {
			...repository,
			upsertRoute: vi.fn(() =>
				Effect.fail(
					new SavedRoutesRepositoryError({
						operation: "upsertRoute",
						cause: new Error("idb down"),
					}),
				),
			),
		};
		useCases = new SavedRoutesUseCases(failingRepository);

		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.localSaveError).toBe("Could not save route locally: idb down");
	});

	it("updates optimistic state before local persistence completes", async () => {
		const deferred = createDeferred();
		const slowRepository: SavedRoutesRepository = {
			...repository,
			upsertRoute: vi.fn(() =>
				Effect.callback<void>((resume) => {
					void deferred.promise.then(() => resume(Effect.void));
				}),
			),
		};
		useCases = new SavedRoutesUseCases(slowRepository);

		const savePromise = Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);

		await vi.waitFor(() => {
			expect(state.savedRoutes).toHaveLength(1);
		});

		deferred.resolve();
		const savedRoute = await savePromise;

		expect(state.savedRoutes).toEqual([savedRoute]);
		expect(state.localSaveError).toBeNull();
	});

	it("coalesces autosave remote writes to the latest route per id", async () => {
		vi.useFakeTimers();

		try {
			const save = vi.fn().mockResolvedValue(undefined);
			await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
			await Effect.runPromise(
				useCases.setRemoteRepository({
					save,
					delete: vi.fn(),
					mergeLocalRoutes: vi.fn(),
				}),
			);
			await Effect.runPromise(
				useCases.applyRemoteSavedRoutes(state, "user_1", [
					serializeSavedRouteForRemote({
						id: "route-1",
						createdAt: "2026-04-19T09:30:00.000Z",
						route,
					}),
				]),
			);

			await Effect.runPromise(
				useCases.upsertSavedRoute(
					state,
					{ ...route, destinationLabel: "First update" },
					"route-1",
					{ source: "autosave" },
				),
			);
			await Effect.runPromise(
				useCases.upsertSavedRoute(
					state,
					{ ...route, destinationLabel: "Latest update" },
					"route-1",
					{ source: "autosave" },
				),
			);

			await vi.advanceTimersByTimeAsync(999);
			expect(save).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			await Promise.resolve();

			expect(save).toHaveBeenCalledTimes(1);
			expect(save).toHaveBeenCalledWith(
				serializeSavedRouteForRemote(state.savedRoutes[0]),
			);
			expect(state.savedRoutes[0]?.route.destinationLabel).toBe(
				"Latest update",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not apply stale remote save failures after sign-out", async () => {
		let rejectSave: (error: Error) => void = () => {};
		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
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
		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);
		expect(state.pendingRemoteRouteIds).toEqual(new Set([savedRoute.id]));

		await Effect.runPromise(useCases.setAuthUser(state, null));
		rejectSave(new Error("late failure"));
		await flushPromises();

		expect(state.authStatus).toBe("signedOut");
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBeNull();
	});

	it("reuses an in-flight anonymous route merge for concurrent calls", async () => {
		const anonymous = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);
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

		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
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
		await Effect.runPromise(useCases.createSavedRoute(state, route));
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

		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
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

		await Effect.runPromise(useCases.setAuthUser(state, null));
		rejectMerge(new Error("late merge failure"));
		await merge;

		expect(state.authStatus).toBe("signedOut");
		expect(state.syncError).toBeNull();
		expect(
			(await Effect.runPromise(repository.readMergedUserIds())).has("user_1"),
		).toBe(false);
	});

	it("keeps optimistic delete and sets syncError after remote delete failure", async () => {
		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
			useCases.setRemoteRepository({
				save: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockRejectedValue(new Error("delete down")),
				mergeLocalRoutes: vi.fn(),
			}),
		);
		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);
		await flushPromises();

		const deleted = await Effect.runPromise(
			useCases.deleteSavedRoute(state, savedRoute.id),
		);

		expect(deleted).toBe(true);
		expect(state.savedRoutes).toEqual([]);

		await flushPromises();

		expect(state.savedRoutes).toEqual([]);
		expect(state.pendingRemoteRouteIds).toEqual(new Set());
		expect(state.syncError).toBe("Could not delete synced route: delete down");
	});

	it("creates a previous version for changed upserts but not identical upserts", async () => {
		const savedRoute = await Effect.runPromise(
			useCases.upsertSavedRoute(state, route, "route-1"),
		);

		await Effect.runPromise(
			useCases.upsertSavedRoute(state, route, savedRoute.id),
		);
		expect(
			await Effect.runPromise(
				repository.readRouteVersions({ kind: "anonymous" }, savedRoute.id),
			),
		).toEqual([]);

		await Effect.runPromise(
			useCases.upsertSavedRoute(
				state,
				{ ...route, destinationLabel: "Garmisch-Partenkirchen" },
				savedRoute.id,
			),
		);

		const versions = await Effect.runPromise(
			repository.readRouteVersions({ kind: "anonymous" }, savedRoute.id),
		);
		expect(versions).toHaveLength(1);
		expect(versions[0]?.savedRoute.route.destinationLabel).toBe(
			"Schliersee, Germany",
		);
	});

	it("restores the latest previous version and makes the current route recoverable", async () => {
		const original = await Effect.runPromise(
			useCases.upsertSavedRoute(state, route, "route-1"),
		);
		await Effect.runPromise(
			useCases.upsertSavedRoute(
				state,
				{ ...route, destinationLabel: "Garmisch-Partenkirchen" },
				original.id,
			),
		);

		const restored = await Effect.runPromise(
			useCases.restoreLatestSavedRouteVersion(state, original.id),
		);

		expect(restored.restored).toBe(true);
		expect(state.savedRoutes[0]?.id).toBe(original.id);
		expect(state.savedRoutes[0]?.createdAt).toBe(original.createdAt);
		expect(state.savedRoutes[0]?.route.destinationLabel).toBe(
			"Schliersee, Germany",
		);
		const versions = await Effect.runPromise(
			repository.readRouteVersions({ kind: "anonymous" }, original.id),
		);
		expect(versions[0]?.savedRoute.route.destinationLabel).toBe(
			"Garmisch-Partenkirchen",
		);
	});

	it("loads remote versions on demand before signed-in restore", async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const listVersions = vi.fn().mockResolvedValue([
			{
				versionId: "remote-version-1",
				routeId: "route-1",
				capturedAt: "2026-04-20T09:30:00.000Z",
				savedRoute: serializeSavedRouteForRemote({
					id: "route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route,
				}),
			},
		]);

		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
			useCases.setRemoteRepository({
				save,
				delete: vi.fn(),
				listVersions,
				mergeLocalRoutes: vi.fn(),
			}),
		);
		await Effect.runPromise(
			useCases.applyRemoteSavedRoutes(state, "user_1", [
				serializeSavedRouteForRemote({
					id: "route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: { ...route, destinationLabel: "Current remote" },
				}),
			]),
		);

		await expect(
			Effect.runPromise(
				useCases.restoreLatestSavedRouteVersion(state, "route-1"),
			),
		).resolves.toMatchObject({ restored: true });

		expect(listVersions).toHaveBeenCalledWith("route-1");
		expect(state.savedRoutes[0]?.route.destinationLabel).toBe(
			"Schliersee, Germany",
		);

		await flushPromises();
		expect(save).toHaveBeenCalledWith(
			serializeSavedRouteForRemote(state.savedRoutes[0]),
		);
	});

	it("loads remote versions on demand before listing signed-in history", async () => {
		const listVersions = vi.fn().mockResolvedValue([
			{
				versionId: "remote-version-1",
				routeId: "route-1",
				capturedAt: "2026-04-20T09:30:00.000Z",
				savedRoute: serializeSavedRouteForRemote({
					id: "route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route,
				}),
			},
		]);

		await Effect.runPromise(useCases.setAuthUser(state, "user_1"));
		await Effect.runPromise(
			useCases.setRemoteRepository({
				save: vi.fn(),
				delete: vi.fn(),
				listVersions,
				mergeLocalRoutes: vi.fn(),
			}),
		);
		await Effect.runPromise(
			useCases.applyRemoteSavedRoutes(state, "user_1", [
				serializeSavedRouteForRemote({
					id: "route-1",
					createdAt: "2026-04-19T09:30:00.000Z",
					route: { ...route, destinationLabel: "Current remote" },
				}),
			]),
		);
		await Effect.runPromise(
			repository.addRouteVersion(
				{ kind: "user", userId: "user_1" },
				{
					versionId: "local-version-older",
					routeId: "route-1",
					capturedAt: "2026-04-19T09:30:00.000Z",
					savedRoute: {
						id: "route-1",
						createdAt: "2026-04-19T09:30:00.000Z",
						route: { ...route, destinationLabel: "Older local version" },
					},
				},
			),
		);

		const versions = await Effect.runPromise(
			useCases.listSavedRouteVersions(state, "route-1"),
		);

		expect(listVersions).toHaveBeenCalledWith("route-1");
		expect(versions.map((version) => version.versionId)).toEqual([
			"remote-version-1",
			"local-version-older",
		]);
		expect(versions.map((version) => version.capturedAt)).toEqual([
			"2026-04-20T09:30:00.000Z",
			"2026-04-19T09:30:00.000Z",
		]);
	});

	it("reports no version when restore history is empty", async () => {
		const savedRoute = await Effect.runPromise(
			useCases.createSavedRoute(state, route),
		);

		await expect(
			Effect.runPromise(
				useCases.restoreLatestSavedRouteVersion(state, savedRoute.id),
			),
		).resolves.toEqual({ restored: false, reason: "no_version" });
	});
});
