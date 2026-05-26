import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	calculateRouteQuality,
	type PlannedRoute,
} from "../lib/route-planning";
import { MAX_REMOTE_ROUTE_JSON_BYTES } from "../lib/saved-route-size";
import { serializeSavedRouteForRemote } from "../lib/saved-routes-core";
import {
	listForCurrentUserHandler,
	mergeLocalRoutesHandler,
	removeHandler,
	upsertHandler,
} from "./savedRoutes";

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
type PaginationOpts = {
	numItems: number;
	cursor: string | null;
};
type IndexCall = {
	index: "by_user_createdAt" | "by_user_routeId";
	filter: Partial<Record<"userId" | "routeId", string>>;
};

const baseRoute: PlannedRoute = {
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
	roadClassDetails: [{ from: 0, to: 1, value: "TERTIARY" }],
	roadEnvironmentDetails: [{ from: 0, to: 1, value: "ROAD" }],
	roadAccessDetails: [{ from: 0, to: 1, value: "YES" }],
	bikeNetworkDetails: [],
};
const route: PlannedRoute = {
	...baseRoute,
	routeQuality: calculateRouteQuality(baseRoute),
};
const remoteSavedRoute = serializeSavedRouteForRemote({
	id: "saved-route-1",
	createdAt: "2026-04-19T09:30:00.000Z",
	route,
});

function createOversizedRemoteSavedRoute(
	baseRoute = remoteSavedRoute,
	id = baseRoute.id,
) {
	const plannedRoute = JSON.parse(baseRoute.routeJson) as PlannedRoute;

	return {
		...baseRoute,
		id,
		routeJson: JSON.stringify({
			...plannedRoute,
			destinationLabel: "x".repeat(MAX_REMOTE_ROUTE_JSON_BYTES),
		}),
	};
}

function createCtx({
	rows = [],
	userId = "user_1",
}: {
	rows?: SavedRouteRow[];
	userId?: string | null;
} = {}) {
	const state = rows.map((row) => ({ ...row }));
	const indexCalls: IndexCall[] = [];
	const collectCalls: IndexCall[] = [];
	const ctx = {
		auth: {
			getUserIdentity: vi.fn(async () => (userId ? { subject: userId } : null)),
		},
		db: {
			query: vi.fn((_table: "savedRoutes") => ({
				withIndex: vi.fn(
					(
						index: "by_user_createdAt" | "by_user_routeId",
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
						indexCalls.push({ index, filter: { ...filter } });
						const collectRows = () =>
							state
								.filter((row) => row.userId === filter.userId)
								.toSorted((a, b) => b.createdAtMs - a.createdAtMs);
						const collection = {
							collect: vi.fn(async () => {
								collectCalls.push({ index, filter: { ...filter } });
								return collectRows();
							}),
							order: vi.fn((_direction: "desc") => collection),
							paginate: vi.fn(async (paginationOpts: PaginationOpts) => {
								const rows = collectRows();
								const cursorOffsets = new Map<string, number>(
									Array.from({ length: rows.length + 1 }, (_value, index) => [
										`cursor_${index}`,
										index,
									]),
								);
								const start =
									paginationOpts.cursor === null
										? 0
										: cursorOffsets.get(paginationOpts.cursor);

								if (start === undefined) {
									throw new Error(
										`Unknown pagination cursor: ${paginationOpts.cursor}`,
									);
								}

								const page = rows.slice(start, start + paginationOpts.numItems);
								const next = start + page.length;

								return {
									page,
									isDone: next >= rows.length,
									continueCursor: `cursor_${next}`,
								};
							}),
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

	return { ctx, state, indexCalls, collectCalls };
}

async function runListForCurrentUser(
	ctx: unknown,
	args: Parameters<typeof listForCurrentUserHandler>[1],
) {
	return await listForCurrentUserHandler(
		ctx as Parameters<typeof listForCurrentUserHandler>[0],
		args,
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

	it("lists a paginated route payload page for the authenticated user", async () => {
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

		await expect(
			runListForCurrentUser(ctx, {
				paginationOpts: { numItems: 25, cursor: null },
			}),
		).resolves.toEqual({
			page: [remoteSavedRoute],
			isDone: true,
			continueCursor: "cursor_1",
		});
	});

	it("returns modern routeJson rows without requiring route normalization", async () => {
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
			],
		});

		await expect(
			runListForCurrentUser(ctx, {
				paginationOpts: { numItems: 25, cursor: null },
			}),
		).resolves.toMatchObject({
			page: [remoteSavedRoute],
			isDone: true,
		});
	});

	it("normalizes legacy route rows when routeJson is missing", async () => {
		const { ctx } = createCtx({
			rows: [
				{
					_id: "route_1",
					userId: "user_1",
					routeId: remoteSavedRoute.id,
					createdAtMs: Date.parse(remoteSavedRoute.createdAt),
					updatedAtMs: 1,
					route,
				},
			],
		});

		await expect(
			runListForCurrentUser(ctx, {
				paginationOpts: { numItems: 25, cursor: null },
			}),
		).resolves.toEqual({
			page: [remoteSavedRoute],
			isDone: true,
			continueCursor: "cursor_1",
		});
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

	it("rejects oversized route payload upserts without inserting", async () => {
		const { ctx, state } = createCtx();
		const oversizedRoute = createOversizedRemoteSavedRoute();

		await expect(runUpsert(ctx, oversizedRoute)).rejects.toThrow(
			"Saved route is too large to sync. Maximum route payload size is 512 KiB.",
		);

		expect(state).toEqual([]);
		expect(ctx.db.query).not.toHaveBeenCalled();
		expect(ctx.db.insert).not.toHaveBeenCalled();
		expect(ctx.db.replace).not.toHaveBeenCalled();
	});

	it("rejects oversized route payload updates without replacing the row", async () => {
		const existingRow = {
			_id: "route_1",
			userId: "user_1",
			routeId: remoteSavedRoute.id,
			createdAtMs: Date.parse(remoteSavedRoute.createdAt),
			updatedAtMs: 1,
			routeJson: remoteSavedRoute.routeJson,
		};
		const { ctx, state } = createCtx({
			rows: [existingRow],
		});
		const oversizedRoute = createOversizedRemoteSavedRoute();

		await expect(runUpsert(ctx, oversizedRoute)).rejects.toThrow(
			"Saved route is too large to sync. Maximum route payload size is 512 KiB.",
		);

		expect(state).toEqual([existingRow]);
		expect(ctx.db.query).not.toHaveBeenCalled();
		expect(ctx.db.insert).not.toHaveBeenCalled();
		expect(ctx.db.replace).not.toHaveBeenCalled();
	});

	it("merges local routes while counting skipped, invalid, and duplicate rows", async () => {
		const { ctx, state, indexCalls, collectCalls } = createCtx({
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
		expect(
			indexCalls
				.filter((call) => call.index === "by_user_routeId")
				.map((call) => call.filter),
		).toEqual([
			{ userId: "user_1", routeId: "existing-route" },
			{ userId: "user_1", routeId: "new-route" },
		]);
		expect(
			collectCalls.some((call) => call.index === "by_user_createdAt"),
		).toBe(false);
	});

	it("counts oversized local merge routes as invalid and continues", async () => {
		const { ctx, state, indexCalls } = createCtx();
		const oversizedRoute = createOversizedRemoteSavedRoute(
			remoteSavedRoute,
			"oversized-route",
		);
		const validRoute = {
			...remoteSavedRoute,
			id: "valid-route",
		};

		await expect(
			runMergeLocalRoutes(ctx, [oversizedRoute, validRoute]),
		).resolves.toEqual({
			inserted: 1,
			skipped: 0,
			invalid: 1,
			duplicate: 0,
		});

		expect(state.map((row) => row.routeId)).toEqual(["valid-route"]);
		expect(
			indexCalls
				.filter((call) => call.index === "by_user_routeId")
				.map((call) => call.filter.routeId),
		).toEqual(["valid-route"]);
	});

	it("bounds merge existence reads to unique valid incoming route ids", async () => {
		const existingRows = Array.from({ length: 500 }, (_value, index) => ({
			_id: `route_${index + 1}`,
			userId: "user_1",
			routeId: `seeded-route-${index + 1}`,
			createdAtMs: index + 1,
			updatedAtMs: index + 1,
			routeJson: remoteSavedRoute.routeJson,
		}));
		const { ctx, indexCalls, collectCalls } = createCtx({
			rows: existingRows,
		});
		const newRoute = {
			...remoteSavedRoute,
			id: "new-scale-route",
		};
		const existingRoute = {
			...remoteSavedRoute,
			id: "seeded-route-250",
		};

		await expect(
			runMergeLocalRoutes(ctx, [newRoute, existingRoute, newRoute]),
		).resolves.toEqual({
			inserted: 1,
			skipped: 1,
			invalid: 0,
			duplicate: 1,
		});

		const existenceReads = indexCalls.filter(
			(call) => call.index === "by_user_routeId",
		);
		expect(existenceReads.map((call) => call.filter.routeId)).toEqual([
			"new-scale-route",
			"seeded-route-250",
		]);
		expect(existenceReads).toHaveLength(2);
		expect(
			collectCalls.some((call) => call.index === "by_user_createdAt"),
		).toBe(false);
	});

	it("rejects unauthenticated access and blank deletes", async () => {
		const unauthenticated = createCtx({ userId: null });
		await expect(
			runListForCurrentUser(unauthenticated.ctx, {
				paginationOpts: { numItems: 25, cursor: null },
			}),
		).rejects.toThrow("Authentication is required to sync saved routes.");

		const { ctx } = createCtx();
		await expect(runRemove(ctx, " ")).rejects.toThrow(
			"Saved route id is required.",
		);
	});
});
