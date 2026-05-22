import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHandler, getByTokenHandler } from "./sharedRoutes";
import { serializeSavedRouteForRemote } from "../lib/saved-routes-core";
import type { PlannedRoute } from "../lib/route-planning";
import { MAX_REMOTE_ROUTE_JSON_BYTES } from "../lib/saved-route-size";

type SharedRouteRow = {
	_id: string;
	shareToken: string;
	ownerUserId: string;
	sourceRouteId?: string;
	createdAtMs: number;
	routeJson: string;
};
type IndexQuery = {
	eq: (field: "shareToken" | "userId" | "routeId", value: string) => IndexQuery;
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
const savedRoute = {
	id: "saved-route-1",
	createdAt: "2026-04-19T09:30:00.000Z",
	route,
};
const remoteSavedRoute = serializeSavedRouteForRemote(savedRoute);

function createOversizedRemoteSavedRoute() {
	const plannedRoute = JSON.parse(remoteSavedRoute.routeJson) as PlannedRoute;

	return {
		...remoteSavedRoute,
		routeJson: JSON.stringify({
			...plannedRoute,
			destinationLabel: "x".repeat(MAX_REMOTE_ROUTE_JSON_BYTES),
		}),
	};
}

function createCtx({
	ownedSourceRouteIds = ["saved-route-1"],
	rows = [],
	userId = "user_1",
}: {
	ownedSourceRouteIds?: string[];
	rows?: SharedRouteRow[];
	userId?: string | null;
} = {}) {
	const state = rows.map((row) => ({ ...row }));
	const sourceRouteIds = new Set(ownedSourceRouteIds);
	const ctx = {
		auth: {
			getUserIdentity: vi.fn(async () => (userId ? { subject: userId } : null)),
		},
		db: {
			query: vi.fn((table: "sharedRoutes" | "savedRoutes") => ({
				withIndex: vi.fn(
					(
						index: "by_shareToken" | "by_user_routeId",
						buildQuery: (query: IndexQuery) => IndexQuery,
					) => {
						const filter: Record<string, string> = {};
						const query: IndexQuery = {
							eq: (
								field: "shareToken" | "userId" | "routeId",
								value: string,
							) => {
								filter[field] = value;
								return query;
							},
						};
						buildQuery(query);

						return {
							unique: vi.fn(async () => {
								if (table === "savedRoutes" && index === "by_user_routeId") {
									return sourceRouteIds.has(filter.routeId)
										? {
												userId: filter.userId,
												routeId: filter.routeId,
											}
										: null;
								}

								return (
									state.find((row) => row.shareToken === filter.shareToken) ??
									null
								);
							}),
						};
					},
				),
			})),
			insert: vi.fn(
				async (_table: "sharedRoutes", row: Omit<SharedRouteRow, "_id">) => {
					state.push({ ...row, _id: `shared_${state.length + 1}` });
				},
			),
		},
	};

	return { ctx, state };
}

async function runCreate(ctx: unknown, args: object) {
	return await createHandler(
		ctx as Parameters<typeof createHandler>[0],
		args as Parameters<typeof createHandler>[1],
	);
}

async function runGetByToken(ctx: unknown, shareToken: string) {
	return await getByTokenHandler(
		ctx as Parameters<typeof getByTokenHandler>[0],
		{ shareToken },
	);
}

describe("sharedRoutes Convex functions", () => {
	beforeEach(() => {
		vi.spyOn(Date, "now").mockReturnValue(1778342400000);
	});

	it("stores a normalized snapshot for an authenticated user", async () => {
		const { ctx, state } = createCtx();

		await expect(
			runCreate(ctx, {
				shareToken: "abc123_DEF456-7890",
				sourceRouteId: "saved-route-1",
				savedRoute: remoteSavedRoute,
			}),
		).resolves.toEqual({
			shareToken: "abc123_DEF456-7890",
			urlPath: "/share/abc123_DEF456-7890",
		});

		expect(state).toEqual([
			{
				_id: "shared_1",
				shareToken: "abc123_DEF456-7890",
				ownerUserId: "user_1",
				sourceRouteId: "saved-route-1",
				createdAtMs: 1778342400000,
				routeJson: remoteSavedRoute.routeJson,
			},
		]);
	});

	it("rejects unauthenticated create", async () => {
		const { ctx } = createCtx({ userId: null });

		await expect(
			runCreate(ctx, {
				shareToken: "abc123_DEF456-7890",
				savedRoute: remoteSavedRoute,
			}),
		).rejects.toThrow("Authentication is required to share routes.");
	});

	it("rejects source routes not owned by the authenticated user", async () => {
		const { ctx } = createCtx({ ownedSourceRouteIds: [] });

		await expect(
			runCreate(ctx, {
				shareToken: "abc123_DEF456-7890",
				sourceRouteId: "saved-route-1",
				savedRoute: remoteSavedRoute,
			}),
		).rejects.toThrow(
			"Shared route source does not belong to the current user.",
		);
	});

	it("returns public payload without owner metadata", async () => {
		const { ctx } = createCtx({
			rows: [
				{
					_id: "shared_1",
					shareToken: "abc123_DEF456-7890",
					ownerUserId: "user_1",
					sourceRouteId: "saved-route-1",
					createdAtMs: 1778342400000,
					routeJson: remoteSavedRoute.routeJson,
				},
			],
		});

		await expect(runGetByToken(ctx, "abc123_DEF456-7890")).resolves.toEqual({
			id: "shared-route",
			createdAt: "2026-05-09T16:00:00.000Z",
			routeJson: remoteSavedRoute.routeJson,
		});
	});

	it("returns null for an invalid token", async () => {
		const { ctx } = createCtx();

		await expect(runGetByToken(ctx, "not valid")).resolves.toBeNull();
	});

	it("rejects invalid route payloads", async () => {
		const { ctx } = createCtx();

		await expect(
			runCreate(ctx, {
				shareToken: "abc123_DEF456-7890",
				savedRoute: {
					...remoteSavedRoute,
					routeJson: "{}",
				},
			}),
		).rejects.toThrow("Shared route payload is invalid.");
	});

	it("rejects oversized route payload creates without inserting", async () => {
		const { ctx, state } = createCtx();

		await expect(
			runCreate(ctx, {
				shareToken: "abc123_DEF456-7890",
				sourceRouteId: "saved-route-1",
				savedRoute: createOversizedRemoteSavedRoute(),
			}),
		).rejects.toThrow(
			"Shared route is too large to share. Maximum route payload size is 512 KiB.",
		);

		expect(state).toEqual([]);
		expect(ctx.db.query).not.toHaveBeenCalled();
		expect(ctx.db.insert).not.toHaveBeenCalled();
	});
});
