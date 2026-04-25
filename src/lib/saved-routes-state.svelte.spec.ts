import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import {
	addSavedRoute,
	deleteSavedRoute,
	resetSavedRoutesForTests,
	SAVED_ROUTES_STORAGE_KEY,
	savedRoutesState,
	type SavedRoutesRemoteAdapter,
} from "$lib/saved-routes.svelte";
import type { SavedRoute } from "$lib/saved-routes-core";

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
	surfaceDetails: [],
	smoothnessDetails: [],
};
const savedRoute: SavedRoute = {
	id: "saved-route-1",
	createdAt: "2026-04-19T09:30:00.000Z",
	route,
};

function userCacheKey(userId: string) {
	return `velix.savedRoutes.synced.${userId}`;
}

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("savedRoutesState", () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetSavedRoutesForTests();
	});

	it("keeps guest save and delete in anonymous localStorage", () => {
		const saved = addSavedRoute(route);

		expect(
			JSON.parse(window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY) ?? "[]"),
		).toEqual([saved]);

		expect(deleteSavedRoute(saved.id)).toBe(true);
		expect(window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBeNull();
	});

	it("replaces visible signed-in routes from remote snapshots and writes user cache", () => {
		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.applyRemoteRoutes("user_1", [savedRoute]);

		expect(savedRoutesState.savedRoutes).toEqual([savedRoute]);
		expect(
			JSON.parse(window.localStorage.getItem(userCacheKey("user_1")) ?? "[]"),
		).toEqual([savedRoute]);
	});

	it("switches back to anonymous local routes on sign-out", () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([{ ...savedRoute, id: "anonymous-route" }]),
		);

		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.applyRemoteRoutes("user_1", [savedRoute]);
		savedRoutesState.setAuthUser(null);

		expect(savedRoutesState.savedRoutes.map((entry) => entry.id)).toEqual([
			"anonymous-route",
		]);
	});

	it("auto-merges anonymous routes once per user and dedupes by route id", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([savedRoute, savedRoute]),
		);
		const mergeLocalRoutes = vi.fn().mockResolvedValue({
			inserted: 1,
			skipped: 0,
			invalid: 0,
			duplicate: 0,
		});

		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter({
			save: vi.fn(),
			delete: vi.fn(),
			mergeLocalRoutes,
		});

		await savedRoutesState.runLocalMergeOnce("user_1");
		await savedRoutesState.runLocalMergeOnce("user_1");

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		expect(mergeLocalRoutes).toHaveBeenCalledWith([savedRoute]);
	});

	it("reuses an in-flight anonymous route merge for concurrent calls", async () => {
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([savedRoute]),
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

		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter({
			save: vi.fn(),
			delete: vi.fn(),
			mergeLocalRoutes,
		});

		const firstMerge = savedRoutesState.runLocalMergeOnce("user_1");
		const secondMerge = savedRoutesState.runLocalMergeOnce("user_1");

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
		resolveMerge();
		await Promise.all([firstMerge, secondMerge]);

		expect(mergeLocalRoutes).toHaveBeenCalledTimes(1);
	});

	it("sets syncError after remote save failure without losing the optimistic route", async () => {
		const adapter: SavedRoutesRemoteAdapter = {
			save: vi.fn().mockRejectedValue(new Error("network down")),
			delete: vi.fn(),
			mergeLocalRoutes: vi.fn(),
		};

		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.setRemoteAdapter(adapter);
		const saved = addSavedRoute(route);
		await flushPromises();

		expect(savedRoutesState.savedRoutes.map((entry) => entry.id)).toContain(
			saved.id,
		);
		expect(savedRoutesState.syncError).toContain("network down");
	});

	it("sets syncError after remote delete failure while keeping the optimistic delete", async () => {
		const adapter: SavedRoutesRemoteAdapter = {
			save: vi.fn(),
			delete: vi.fn().mockRejectedValue(new Error("network down")),
			mergeLocalRoutes: vi.fn(),
		};

		savedRoutesState.setAuthUser("user_1");
		savedRoutesState.applyRemoteRoutes("user_1", [savedRoute]);
		savedRoutesState.setRemoteAdapter(adapter);

		expect(deleteSavedRoute(savedRoute.id)).toBe(true);
		await flushPromises();

		expect(savedRoutesState.savedRoutes).toEqual([]);
		expect(adapter.delete).toHaveBeenCalledWith(savedRoute.id);
		expect(savedRoutesState.syncError).toContain("network down");
	});
});
