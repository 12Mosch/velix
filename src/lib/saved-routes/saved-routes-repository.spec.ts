import { describe, expect, it } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	dedupeSavedRoutesById,
	SYNCED_MIGRATIONS_STORAGE_KEY,
} from "$lib/saved-routes/saved-routes-repository";
import {
	buildSavedRouteVersion,
	buildSavedRoute,
	SAVED_ROUTES_STORAGE_KEY,
} from "$lib/saved-routes-core";
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

describe("saved routes repository", () => {
	it("reads and writes anonymous and user-scoped route caches", async () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route, {
			id: "route-1",
			createdAt: "2026-04-19T09:30:00.000Z",
		});

		await Effect.runPromise(
			repository.replaceRoutes({ kind: "anonymous" }, [savedRoute]),
		);
		await Effect.runPromise(
			repository.replaceRoutes({ kind: "user", userId: "user_1" }, [
				savedRoute,
			]),
		);

		expect(
			await Effect.runPromise(repository.readRoutes({ kind: "anonymous" })),
		).toEqual([savedRoute]);
		expect(
			await Effect.runPromise(
				repository.readRoutes({ kind: "user", userId: "user_1" }),
			),
		).toEqual([savedRoute]);
		expect(storage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBeNull();
	});

	it("removes scoped rows when replacing with an empty route list", async () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route);

		await Effect.runPromise(
			repository.replaceRoutes({ kind: "anonymous" }, [savedRoute]),
		);
		await Effect.runPromise(
			repository.replaceRoutes({ kind: "user", userId: "user_1" }, [
				savedRoute,
			]),
		);
		await Effect.runPromise(
			repository.replaceRoutes({ kind: "anonymous" }, []),
		);
		await Effect.runPromise(
			repository.replaceRoutes({ kind: "user", userId: "user_1" }, []),
		);

		expect(
			await Effect.runPromise(repository.readRoutes({ kind: "anonymous" })),
		).toEqual([]);
		expect(
			await Effect.runPromise(
				repository.readRoutes({ kind: "user", userId: "user_1" }),
			),
		).toEqual([]);
	});

	it("clears anonymous, migration, and all user-scoped route caches", async () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route);

		await Effect.runPromise(
			repository.replaceRoutes({ kind: "anonymous" }, [savedRoute]),
		);
		await Effect.runPromise(
			repository.replaceRoutes({ kind: "user", userId: "user_1" }, [
				savedRoute,
			]),
		);
		await Effect.runPromise(
			repository.replaceRoutes({ kind: "user", userId: "user_2" }, [
				savedRoute,
			]),
		);
		await Effect.runPromise(repository.writeMergedUserIds(new Set(["user_1"])));

		await Effect.runPromise(repository.clear());

		expect(
			await Effect.runPromise(repository.readRoutes({ kind: "anonymous" })),
		).toEqual([]);
		expect(
			await Effect.runPromise(
				repository.readRoutes({ kind: "user", userId: "user_1" }),
			),
		).toEqual([]);
		expect(
			await Effect.runPromise(
				repository.readRoutes({ kind: "user", userId: "user_2" }),
			),
		).toEqual([]);
		expect(await Effect.runPromise(repository.readMergedUserIds())).toEqual(
			new Set(),
		);
	});

	it("tracks merged user ids and ignores malformed migration state", async () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);

		await Effect.runPromise(
			repository.writeMergedUserIds(new Set(["user_1", "user_2"])),
		);
		expect(await Effect.runPromise(repository.readMergedUserIds())).toEqual(
			new Set(["user_1", "user_2"]),
		);

		storage.setItem(SYNCED_MIGRATIONS_STORAGE_KEY, "{broken");
		expect(await Effect.runPromise(repository.readMergedUserIds())).toEqual(
			new Set(),
		);
	});

	it("dedupes routes by id while preserving first occurrence order", () => {
		const first = buildSavedRoute(route, { id: "route-1" });
		const duplicate = buildSavedRoute(
			{ ...route, destinationLabel: "Garmisch-Partenkirchen, Germany" },
			{ id: "route-1" },
		);
		const second = buildSavedRoute(route, { id: "route-2" });

		expect(dedupeSavedRoutesById([first, duplicate, second])).toEqual([
			first,
			second,
		]);
	});

	it("stores route versions newest first, scoped by user, and prunes to ten", async () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route, {
			id: "route-1",
			createdAt: "2026-04-19T09:30:00.000Z",
		});

		for (let index = 0; index < 12; index += 1) {
			await Effect.runPromise(
				repository.addRouteVersion(
					{ kind: "anonymous" },
					buildSavedRouteVersion(
						{
							...savedRoute,
							route: {
								...savedRoute.route,
								destinationLabel: `Version ${index}`,
							},
						},
						{
							versionId: `version-${index}`,
							capturedAt: new Date(
								Date.UTC(2026, 3, 19, 9, index),
							).toISOString(),
						},
					),
				),
			);
		}
		await Effect.runPromise(
			repository.addRouteVersion(
				{ kind: "user", userId: "user_1" },
				buildSavedRouteVersion(savedRoute, {
					versionId: "user-version",
					capturedAt: "2026-04-21T09:30:00.000Z",
				}),
			),
		);

		const anonymousVersions = await Effect.runPromise(
			repository.readRouteVersions({ kind: "anonymous" }, savedRoute.id),
		);

		expect(anonymousVersions).toHaveLength(10);
		expect(anonymousVersions.map((version) => version.versionId)).toEqual([
			"version-11",
			"version-10",
			"version-9",
			"version-8",
			"version-7",
			"version-6",
			"version-5",
			"version-4",
			"version-3",
			"version-2",
		]);
		expect(
			await Effect.runPromise(
				repository.readRouteVersions(
					{ kind: "user", userId: "user_1" },
					savedRoute.id,
				),
			),
		).toHaveLength(1);
	});

	it("deletes route versions with their parent route", async () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route, { id: "route-1" });

		await Effect.runPromise(
			repository.upsertRoute({ kind: "anonymous" }, savedRoute),
		);
		await Effect.runPromise(
			repository.addRouteVersion(
				{ kind: "anonymous" },
				buildSavedRouteVersion(savedRoute, { versionId: "version-1" }),
			),
		);
		await Effect.runPromise(
			repository.deleteRoute({ kind: "anonymous" }, savedRoute.id),
		);

		expect(
			await Effect.runPromise(
				repository.readRouteVersions({ kind: "anonymous" }, savedRoute.id),
			),
		).toEqual([]);
	});

	it("keeps replacement versions scoped to the requested route id", async () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route, { id: "route-1" });
		const otherRoute = buildSavedRoute(route, { id: "route-2" });

		await Effect.runPromise(
			repository.replaceRouteVersions({ kind: "anonymous" }, "route-1", [
				buildSavedRouteVersion(otherRoute, {
					versionId: "version-from-other-route",
				}),
				buildSavedRouteVersion(savedRoute, {
					versionId: "version-from-route-1",
				}),
			]),
		);

		expect(
			(
				await Effect.runPromise(
					repository.readRouteVersions({ kind: "anonymous" }, "route-1"),
				)
			).map((version) => version.routeId),
		).toEqual(["route-1", "route-1"]);
		expect(
			await Effect.runPromise(
				repository.readRouteVersions({ kind: "anonymous" }, "route-2"),
			),
		).toEqual([]);
	});
});
