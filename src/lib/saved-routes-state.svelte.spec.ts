import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import type { PlannedRoute } from "$lib/route-planning";
import {
	addSavedRoute,
	deleteSavedRoute,
	readSavedRoutesForTests,
	resetSavedRoutesForTests,
	seedSavedRoutesForTests,
	savedRoutesState,
	type SavedRoutesRemoteAdapter,
	upsertSavedRoute,
} from "$lib/saved-routes.svelte";
import {
	serializeSavedRouteForRemote,
	type SavedRoute,
} from "$lib/saved-routes-core";

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
		[11.62, 48.1, 545],
		[11.8598, 47.7362, 785],
	],
	instructions: [],
	surfaceDetails: [],
	smoothnessDetails: [],
};
const savedRoute: SavedRoute = {
	id: "saved-route-1",
	createdAt: "2026-04-19T09:30:00.000Z",
	route,
};

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

class TestRemoteError extends Error {
	readonly _tag = "TestRemoteError";
}

describe("savedRoutesState", () => {
	beforeEach(async () => {
		window.localStorage.clear();
		await resetSavedRoutesForTests();
	});

	it("keeps guest save and delete in anonymous IndexedDB", async () => {
		const saved = await addSavedRoute(route);

		expect(await readSavedRoutesForTests()).toEqual([saved]);

		expect(await deleteSavedRoute(saved.id)).toBe(true);
		expect(await readSavedRoutesForTests()).toEqual([]);
	});

	it("upsertSavedRoute creates a saved route when no ID is supplied", async () => {
		const saved = await upsertSavedRoute(route);

		expect(savedRoutesState.savedRoutes).toEqual([saved]);
		expect(await readSavedRoutesForTests()).toEqual([saved]);
	});

	it("upsertSavedRoute updates an existing saved route by ID without adding a duplicate", async () => {
		const saved = await upsertSavedRoute(route);
		const updatedRoute = {
			...route,
			destinationLabel: "Garmisch-Partenkirchen, Germany",
			distanceMeters: 81234,
		};

		const updatedSaved = await upsertSavedRoute(updatedRoute, saved.id);

		expect(savedRoutesState.savedRoutes).toHaveLength(1);
		expect(savedRoutesState.savedRoutes[0]).toEqual(updatedSaved);
		expect(savedRoutesState.savedRoutes[0]?.route.destinationLabel).toBe(
			"Garmisch-Partenkirchen, Germany",
		);
		expect(await readSavedRoutesForTests()).toEqual([updatedSaved]);
	});

	it("upsertSavedRoute preserves the existing id and createdAt when updating", async () => {
		await seedSavedRoutesForTests([savedRoute]);

		const updatedSaved = await upsertSavedRoute(
			{
				...route,
				distanceMeters: 71234,
			},
			savedRoute.id,
		);

		expect(updatedSaved.id).toBe(savedRoute.id);
		expect(updatedSaved.createdAt).toBe(savedRoute.createdAt);
		expect(updatedSaved.route.distanceMeters).toBe(71234);
	});

	it("replaces visible signed-in routes from remote snapshots and writes user cache", async () => {
		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", [
			serializeSavedRouteForRemote(savedRoute),
		]);

		expect(savedRoutesState.savedRoutes).toEqual([savedRoute]);
		expect(await readSavedRoutesForTests({ userId: "user_1" })).toEqual([
			savedRoute,
		]);
	});

	it("switches back to anonymous local routes on sign-out", async () => {
		await seedSavedRoutesForTests([{ ...savedRoute, id: "anonymous-route" }]);

		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", [
			serializeSavedRouteForRemote(savedRoute),
		]);
		await savedRoutesState.setAuthUser(null);

		expect(savedRoutesState.savedRoutes.map((entry) => entry.id)).toEqual([
			"anonymous-route",
		]);
	});

	it("auto-merges anonymous routes once per user and dedupes by route id", async () => {
		await seedSavedRoutesForTests([savedRoute, savedRoute]);
		const mergeLocalRoutes = vi.fn(() =>
			Effect.succeed({
				inserted: 1,
				skipped: 0,
				invalid: 0,
				duplicate: 0,
			}),
		);

		await savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter({
			save: vi.fn(() => Effect.void),
			delete: vi.fn(() => Effect.void),
			mergeLocalRoutes,
		});

		await savedRoutesState.runLocalMergeOnce("user_1");
		await savedRoutesState.runLocalMergeOnce("user_1");

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		expect(mergeLocalRoutes).toHaveBeenCalledWith([
			serializeSavedRouteForRemote(savedRoute),
		]);
	});

	it("falls back to anonymous routes when signed-in remote sync is unavailable", async () => {
		await seedSavedRoutesForTests([savedRoute]);

		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.setRemoteSyncUnavailable(
			"Could not authenticate synced routes.",
		);

		expect(savedRoutesState.remoteReady).toBe(true);
		expect(savedRoutesState.syncError).toBe(
			"Could not authenticate synced routes.",
		);
		expect(savedRoutesState.savedRoutes).toEqual([savedRoute]);
		expect(await readSavedRoutesForTests({ userId: "user_1" })).toEqual([
			savedRoute,
		]);
		expect(await readSavedRoutesForTests()).toEqual([]);
	});

	it("reuses an in-flight anonymous route merge for concurrent calls", async () => {
		await seedSavedRoutesForTests([savedRoute]);
		let resolveMerge: () => void = () => {};
		const mergeLocalRoutes = vi.fn(() =>
			Effect.callback<{
				inserted: number;
				skipped: number;
				invalid: number;
				duplicate: number;
			}>((resume) => {
				resolveMerge = () =>
					resume(
						Effect.succeed({
							inserted: 1,
							skipped: 0,
							invalid: 0,
							duplicate: 0,
						}),
					);
			}),
		);

		await savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter({
			save: vi.fn(() => Effect.void),
			delete: vi.fn(() => Effect.void),
			mergeLocalRoutes,
		});

		const firstMerge = savedRoutesState.runLocalMergeOnce("user_1");
		const secondMerge = savedRoutesState.runLocalMergeOnce("user_1");

		await vi.waitFor(() => {
			expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		});
		resolveMerge();
		await Promise.all([firstMerge, secondMerge]);

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
	});

	it("sets syncError after remote save failure without losing the optimistic route", async () => {
		const adapter: SavedRoutesRemoteAdapter = {
			save: vi.fn(() => Effect.fail(new TestRemoteError("network down"))),
			delete: vi.fn(() => Effect.void),
			mergeLocalRoutes: vi.fn(() =>
				Effect.succeed({ inserted: 0, skipped: 0, invalid: 0, duplicate: 0 }),
			),
		};

		await savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter(adapter);
		const saved = await addSavedRoute(route);
		await flushPromises();

		expect(savedRoutesState.savedRoutes.map((entry) => entry.id)).toContain(
			saved.id,
		);
		expect(savedRoutesState.syncError).toContain("network down");
	});

	it("signed-in upsert calls the remote adapter save with the updated saved route", async () => {
		const save = vi.fn(() => Effect.void);
		const adapter: SavedRoutesRemoteAdapter = {
			save,
			delete: vi.fn(() => Effect.void),
			mergeLocalRoutes: vi.fn(() =>
				Effect.succeed({ inserted: 0, skipped: 0, invalid: 0, duplicate: 0 }),
			),
		};

		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", [
			serializeSavedRouteForRemote(savedRoute),
		]);
		savedRoutesState.setRemoteAdapter(adapter);

		const updatedSaved = await upsertSavedRoute(
			{
				...route,
				destinationLabel: "Garmisch-Partenkirchen, Germany",
			},
			savedRoute.id,
		);
		await flushPromises();

		expect(save).toHaveBeenCalledWith(
			serializeSavedRouteForRemote(updatedSaved),
		);
		expect(updatedSaved.id).toBe(savedRoute.id);
		expect(updatedSaved.createdAt).toBe(savedRoute.createdAt);
	});

	it("remote upsert failure leaves the optimistic updated route and sets syncError", async () => {
		const adapter: SavedRoutesRemoteAdapter = {
			save: vi.fn(() => Effect.fail(new TestRemoteError("network down"))),
			delete: vi.fn(() => Effect.void),
			mergeLocalRoutes: vi.fn(() =>
				Effect.succeed({ inserted: 0, skipped: 0, invalid: 0, duplicate: 0 }),
			),
		};

		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", [
			serializeSavedRouteForRemote(savedRoute),
		]);
		savedRoutesState.setRemoteAdapter(adapter);

		await upsertSavedRoute(
			{
				...route,
				destinationLabel: "Garmisch-Partenkirchen, Germany",
			},
			savedRoute.id,
		);
		await flushPromises();

		expect(savedRoutesState.savedRoutes).toHaveLength(1);
		expect(savedRoutesState.savedRoutes[0]?.id).toBe(savedRoute.id);
		expect(savedRoutesState.savedRoutes[0]?.route.destinationLabel).toBe(
			"Garmisch-Partenkirchen, Germany",
		);
		expect(savedRoutesState.syncError).toContain("network down");
	});

	it("sets syncError after remote delete failure while keeping the optimistic delete", async () => {
		const adapter: SavedRoutesRemoteAdapter = {
			save: vi.fn(() => Effect.void),
			delete: vi.fn(() => Effect.fail(new TestRemoteError("network down"))),
			mergeLocalRoutes: vi.fn(() =>
				Effect.succeed({ inserted: 0, skipped: 0, invalid: 0, duplicate: 0 }),
			),
		};

		await savedRoutesState.setAuthUser("user_1");
		await savedRoutesState.applyRemoteRoutes("user_1", [
			serializeSavedRouteForRemote(savedRoute),
		]);
		savedRoutesState.setRemoteAdapter(adapter);

		expect(await deleteSavedRoute(savedRoute.id)).toBe(true);
		await flushPromises();

		expect(savedRoutesState.savedRoutes).toEqual([]);
		expect(adapter.delete).toHaveBeenCalledWith(savedRoute.id);
		expect(savedRoutesState.syncError).toContain("network down");
	});
});
