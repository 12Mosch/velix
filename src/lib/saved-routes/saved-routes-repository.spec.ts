import { describe, expect, it } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	dedupeSavedRoutesById,
	getSyncedRoutesStorageKey,
	SYNCED_MIGRATIONS_STORAGE_KEY,
} from "$lib/saved-routes/saved-routes-repository";
import {
	buildSavedRoute,
	SAVED_ROUTES_STORAGE_KEY,
} from "$lib/saved-routes-core";
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
	it("reads and writes anonymous and user-scoped route caches", () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route, {
			id: "route-1",
			createdAt: "2026-04-19T09:30:00.000Z",
		});

		repository.writeAnonymousRoutes([savedRoute]);
		repository.writeUserRoutes("user_1", [savedRoute]);

		expect(repository.readAnonymousRoutes()).toEqual([savedRoute]);
		expect(repository.readUserRoutes("user_1")).toEqual([savedRoute]);
		expect(storage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBeTruthy();
		expect(storage.getItem(getSyncedRoutesStorageKey("user_1"))).toBeTruthy();
	});

	it("removes caches when writing an empty route list", () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route);

		repository.writeAnonymousRoutes([savedRoute]);
		repository.writeUserRoutes("user_1", [savedRoute]);
		repository.writeAnonymousRoutes([]);
		repository.writeUserRoutes("user_1", []);

		expect(storage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBeNull();
		expect(storage.getItem(getSyncedRoutesStorageKey("user_1"))).toBeNull();
	});

	it("clears anonymous, migration, and all user-scoped route caches", () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);
		const savedRoute = buildSavedRoute(route);

		repository.writeAnonymousRoutes([savedRoute]);
		repository.writeUserRoutes("user_1", [savedRoute]);
		repository.writeUserRoutes("user_2", [savedRoute]);
		repository.writeMergedUserIds(new Set(["user_1"]));

		repository.clear();

		expect(repository.readAnonymousRoutes()).toEqual([]);
		expect(repository.readUserRoutes("user_1")).toEqual([]);
		expect(repository.readUserRoutes("user_2")).toEqual([]);
		expect(repository.readMergedUserIds()).toEqual(new Set());
	});

	it("tracks merged user ids and ignores malformed migration state", () => {
		const storage = createMemoryStorage();
		const repository = createSavedRoutesRepository(storage);

		repository.writeMergedUserIds(new Set(["user_1", "user_2"]));
		expect(repository.readMergedUserIds()).toEqual(
			new Set(["user_1", "user_2"]),
		);

		storage.setItem(SYNCED_MIGRATIONS_STORAGE_KEY, "{broken");
		expect(repository.readMergedUserIds()).toEqual(new Set());
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
});
