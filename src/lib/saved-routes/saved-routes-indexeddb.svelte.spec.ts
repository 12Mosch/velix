import { beforeEach, describe, expect, it } from "vitest";

import type { PlannedRoute } from "$lib/route-planning";
import {
	createSavedRoutesRepository,
	getSyncedRoutesStorageKey,
} from "$lib/saved-routes/saved-routes-repository";
import {
	buildSavedRoute,
	SAVED_ROUTES_STORAGE_KEY,
	type SavedRoute,
} from "$lib/saved-routes-core";

const route: PlannedRoute = {
	mode: "point_to_point",
	source: { kind: "graphhopper" },
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

function createRoute(id: string, createdAt: string): SavedRoute {
	return buildSavedRoute(route, { id, createdAt });
}

async function createRepository() {
	const repository = createSavedRoutesRepository(window.localStorage);
	await repository.init();
	return repository;
}

describe("saved routes IndexedDB repository", () => {
	beforeEach(async () => {
		window.localStorage.clear();
		const repository = await createRepository();
		await repository.clear();
	});

	it("writes and reads anonymous routes sorted newest first", async () => {
		const repository = await createRepository();
		const older = createRoute("older", "2026-04-19T09:30:00.000Z");
		const newer = createRoute("newer", "2026-04-20T09:30:00.000Z");

		await repository.upsertRoute({ kind: "anonymous" }, older);
		await repository.upsertRoute({ kind: "anonymous" }, newer);

		expect(await repository.readRoutes({ kind: "anonymous" })).toEqual([
			newer,
			older,
		]);
	});

	it("keeps user-scoped routes separate", async () => {
		const repository = await createRepository();
		const first = createRoute("route-1", "2026-04-19T09:30:00.000Z");
		const second = createRoute("route-2", "2026-04-20T09:30:00.000Z");

		await repository.upsertRoute({ kind: "user", userId: "user_1" }, first);
		await repository.upsertRoute({ kind: "user", userId: "user_2" }, second);

		expect(
			await repository.readRoutes({ kind: "user", userId: "user_1" }),
		).toEqual([first]);
		expect(
			await repository.readRoutes({ kind: "user", userId: "user_2" }),
		).toEqual([second]);
	});

	it("upserts and deletes one row without touching unrelated rows", async () => {
		const repository = await createRepository();
		const first = createRoute("route-1", "2026-04-19T09:30:00.000Z");
		const updated = {
			...first,
			route: { ...first.route, destinationLabel: "Garmisch-Partenkirchen" },
		};
		const second = createRoute("route-2", "2026-04-20T09:30:00.000Z");

		await repository.replaceRoutes({ kind: "anonymous" }, [first, second]);
		await repository.upsertRoute({ kind: "anonymous" }, updated);
		await repository.deleteRoute({ kind: "anonymous" }, "route-2");

		expect(await repository.readRoutes({ kind: "anonymous" })).toEqual([
			updated,
		]);
	});

	it("full replacement clears missing routes for that scope only", async () => {
		const repository = await createRepository();
		const first = createRoute("route-1", "2026-04-19T09:30:00.000Z");
		const second = createRoute("route-2", "2026-04-20T09:30:00.000Z");

		await repository.replaceRoutes({ kind: "anonymous" }, [first, second]);
		await repository.replaceRoutes({ kind: "anonymous" }, [second]);

		expect(await repository.readRoutes({ kind: "anonymous" })).toEqual([
			second,
		]);
	});

	it("migrates legacy anonymous and user localStorage arrays", async () => {
		const anonymous = createRoute(
			"anonymous-route",
			"2026-04-19T09:30:00.000Z",
		);
		const user = createRoute("user-route", "2026-04-20T09:30:00.000Z");
		window.localStorage.setItem(
			SAVED_ROUTES_STORAGE_KEY,
			JSON.stringify([anonymous]),
		);
		window.localStorage.setItem(
			getSyncedRoutesStorageKey("user_1"),
			JSON.stringify([user]),
		);

		const repository = await createRepository();

		expect(await repository.readRoutes({ kind: "anonymous" })).toEqual([
			anonymous,
		]);
		expect(
			await repository.readRoutes({ kind: "user", userId: "user_1" }),
		).toEqual([user]);
		expect(window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBeNull();
		expect(
			window.localStorage.getItem(getSyncedRoutesStorageKey("user_1")),
		).toBeNull();
	});

	it("ignores malformed legacy values without crashing init", async () => {
		window.localStorage.setItem(SAVED_ROUTES_STORAGE_KEY, "{broken");

		const repository = await createRepository();

		expect(await repository.readRoutes({ kind: "anonymous" })).toEqual([]);
		expect(window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY)).toBe(
			"{broken",
		);
	});
});
