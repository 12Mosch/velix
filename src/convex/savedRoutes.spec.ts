import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	listForCurrentUserHandler,
	mergeLocalRoutesHandler,
	removeHandler,
	upsertHandler,
} from "./savedRoutes";
import type { PlannedRoute } from "../lib/route-planning";
import { serializeSavedRouteForRemote } from "../lib/saved-routes-core";

type SavedRouteRow = {
	_id: string;
	userId: string;
	routeId: string;
	createdAtMs: number;
	updatedAtMs: number;
	routeJson?: string;
	route?: unknown;
};
type IndexQuery = {
	eq: (field: "userId" | "routeId", value: string) => IndexQuery;
};

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
const remoteSavedRoute = serializeSavedRouteForRemote({
	id: "saved-route-1",
	createdAt: "2026-04-19T09:30:00.000Z",
	route,
});

function createCtx({
	rows = [],
	userId = "user_1",
}: {
	rows?: SavedRouteRow[];
	userId?: string | null;
} = {}) {
	const state = rows.map((row) => ({ ...row }));
	const ctx = {
		auth: {
			getUserIdentity: vi.fn(async () => (userId ? { subject: userId } : null)),
		},
		db: {
			query: vi.fn((_table: "savedRoutes") => ({
				withIndex: vi.fn(
					(
						_index: "by_user_createdAt" | "by_user_routeId",
						buildQuery: (query: IndexQuery) => IndexQuery,
					) => {
						const filter: Record<string, string> = {};
						const query: IndexQuery = {
							eq: (field, value) => {
								filter[field] = value;
								return query;
							},
						};
						buildQuery(query);
						const collectRows = () =>
							state.filter((row) => row.userId === filter.userId);
						const collection = {
							collect: vi.fn(async () => collectRows()),
							order: vi.fn((_direction: "desc") => collection),
							unique: vi.fn(
								async () =>
									state.find(
										(row) =>
											row.userId === filter.userId &&
											row.routeId === filter.routeId,
									) ?? null,
							),
						};

						return collection;
					},
				),
			})),
			delete: vi.fn(async (id: string) => {
				const index = state.findIndex((row) => row._id === id);
				if (index >= 0) {
					state.splice(index, 1);
				}
			}),
			insert: vi.fn(
				async (_table: "savedRoutes", row: Omit<SavedRouteRow, "_id">) => {
					state.push({ ...row, _id: `route_${state.length + 1}` });
				},
			),
			replace: vi.fn(async (id: string, row: Omit<SavedRouteRow, "_id">) => {
				const index = state.findIndex((candidate) => candidate._id === id);
				if (index < 0) {
					throw new Error(`Missing row: ${id}`);
				}

				state[index] = { ...row, _id: id };
			}),
		},
	};

	return { ctx, state };
}

async function runListForCurrentUser(ctx: unknown) {
	return await listForCurrentUserHandler(
		ctx as Parameters<typeof listForCurrentUserHandler>[0],
	);
}

async function runUpsert(ctx: unknown, savedRoute: object) {
	return await upsertHandler(ctx as Parameters<typeof upsertHandler>[0], {
		savedRoute: savedRoute as Parameters<typeof upsertHandler>[1]["savedRoute"],
	});
}

async function runRemove(ctx: unknown, routeId: string) {
	return await removeHandler(ctx as Parameters<typeof removeHandler>[0], {
		routeId,
	});
}

async function runMergeLocalRoutes(ctx: unknown, savedRoutes: unknown[]) {
	return await mergeLocalRoutesHandler(
		ctx as Parameters<typeof mergeLocalRoutesHandler>[0],
		{ savedRoutes },
	);
}

describe("savedRoutes Convex functions", () => {
	beforeEach(() => {
		vi.spyOn(Date, "now").mockReturnValue(1778342400000);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lists normalized route payloads for the authenticated user", async () => {
		const { ctx } = createCtx({
			rows: [
				{
					_id: "route_1",
					userId: "user_1",
					routeId: remoteSavedRoute.id,
					createdAtMs: Date.parse(remoteSavedRoute.createdAt),
					updatedAtMs: 1,
					routeJson: remoteSavedRoute.routeJson,
				},
				{
					_id: "route_2",
					userId: "user_2",
					routeId: "other",
					createdAtMs: 1,
					updatedAtMs: 1,
					routeJson: remoteSavedRoute.routeJson,
				},
			],
		});

		await expect(runListForCurrentUser(ctx)).resolves.toEqual([
			remoteSavedRoute,
		]);
	});

	it("upserts a route snapshot through the Effect handler", async () => {
		const { ctx, state } = createCtx();

		await expect(runUpsert(ctx, remoteSavedRoute)).resolves.toEqual({
			inserted: true,
		});

		expect(state).toEqual([
			{
				_id: "route_1",
				userId: "user_1",
				routeId: remoteSavedRoute.id,
				createdAtMs: Date.parse(remoteSavedRoute.createdAt),
				updatedAtMs: 1778342400000,
				routeJson: remoteSavedRoute.routeJson,
			},
		]);
	});

	it("rejects invalid saved route payloads", async () => {
		const { ctx } = createCtx();

		await expect(
			runUpsert(ctx, {
				...remoteSavedRoute,
				routeJson: "{}",
			}),
		).rejects.toThrow("Saved route payload is invalid.");
	});

	it("merges local routes while counting skipped, invalid, and duplicate rows", async () => {
		const { ctx, state } = createCtx({
			rows: [
				{
					_id: "route_1",
					userId: "user_1",
					routeId: "existing-route",
					createdAtMs: 1,
					updatedAtMs: 1,
					routeJson: remoteSavedRoute.routeJson,
				},
			],
		});
		const existingRoute = {
			...remoteSavedRoute,
			id: "existing-route",
		};
		const secondRoute = {
			...remoteSavedRoute,
			id: "new-route",
		};

		await expect(
			runMergeLocalRoutes(ctx, [
				existingRoute,
				secondRoute,
				secondRoute,
				{ bad: true },
			]),
		).resolves.toEqual({
			inserted: 1,
			skipped: 1,
			invalid: 1,
			duplicate: 1,
		});
		expect(state.map((row) => row.routeId)).toEqual([
			"existing-route",
			"new-route",
		]);
	});

	it("rejects unauthenticated access and blank deletes", async () => {
		const unauthenticated = createCtx({ userId: null });
		await expect(runListForCurrentUser(unauthenticated.ctx)).rejects.toThrow(
			"Authentication is required to sync saved routes.",
		);

		const { ctx } = createCtx();
		await expect(runRemove(ctx, " ")).rejects.toThrow(
			"Saved route id is required.",
		);
	});
});
