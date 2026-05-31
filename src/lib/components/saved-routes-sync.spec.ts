import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import { api } from "../../convex/_generated/api";
import {
	createSavedRoutesRemoteAdapter,
	type SavedRoutesConvexClient,
	type SavedRoutesSyncState,
	syncSavedRoutesOnce,
} from "./saved-routes-sync";

type MockFn = ReturnType<typeof vi.fn>;

type TestState = SavedRoutesSyncState & {
	applyRemoteRoutesEffect: MockFn;
	runLocalMergeOnceEffect: MockFn;
};

type TestClient = SavedRoutesConvexClient & {
	mutation: MockFn;
	query: MockFn;
};

class TestRemoteError extends Error {
	readonly _tag = "TestRemoteError";
}

function createState(overrides: Partial<TestState> = {}): TestState {
	return {
		applyRemoteRoutesEffect: vi.fn(() => Effect.void),
		runLocalMergeOnceEffect: vi.fn(() => Effect.void),
		syncError: null,
		...overrides,
	} as TestState;
}

function createClient(overrides: Partial<TestClient> = {}): TestClient {
	return {
		mutation: vi.fn().mockResolvedValue(undefined),
		query: vi.fn().mockResolvedValue({
			page: [],
			isDone: true,
			continueCursor: "done",
		}),
		...overrides,
	} as TestClient;
}

const savedRoute = {
	id: "route_1",
	createdAt: "2026-04-19T09:30:00.000Z",
	routeJson: "{}",
};

describe("saved routes one-shot sync", () => {
	it("runs local merge before loading and applying the remote snapshot", async () => {
		const events: string[] = [];
		const remoteRoutes = [{ ...savedRoute, id: "remote-route" }];
		const state = createState({
			applyRemoteRoutesEffect: vi.fn(() =>
				Effect.sync(() => {
					events.push("apply");
				}),
			),
			runLocalMergeOnceEffect: vi.fn(() =>
				Effect.sync(() => {
					events.push("merge");
				}),
			),
		});
		const client = createClient({
			query: vi.fn(async () => {
				events.push("query");
				return {
					page: remoteRoutes,
					isDone: true,
					continueCursor: "done",
				};
			}),
		});

		await Effect.runPromise(
			syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => 1,
				requestId: 1,
				state,
				userId: "user_1",
			}),
		);

		expect(events).toEqual(["merge", "query", "apply"]);
		expect(client.query).toHaveBeenCalledTimes(1);
		expect(client.query).toHaveBeenCalledWith(
			api.savedRoutes.listForCurrentUser,
			{
				paginationOpts: {
					numItems: 25,
					cursor: null,
					maximumRowsRead: 25,
				},
			},
		);
		expect(state.applyRemoteRoutesEffect).toHaveBeenCalledWith(
			"user_1",
			remoteRoutes,
		);
	});

	it("loads all remote routes across paginated query results", async () => {
		const routeA = { ...savedRoute, id: "route_a" };
		const routeB = { ...savedRoute, id: "route_b" };
		const state = createState();
		const client = createClient({
			query: vi
				.fn()
				.mockResolvedValueOnce({
					page: [routeA],
					isDone: false,
					continueCursor: "cursor_1",
				})
				.mockResolvedValueOnce({
					page: [routeB],
					isDone: true,
					continueCursor: "cursor_2",
				}),
		});

		await Effect.runPromise(
			syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => 1,
				requestId: 1,
				state,
				userId: "user_1",
			}),
		);

		expect(client.query).toHaveBeenCalledTimes(2);
		expect(client.query).toHaveBeenNthCalledWith(
			1,
			api.savedRoutes.listForCurrentUser,
			{
				paginationOpts: {
					numItems: 25,
					cursor: null,
					maximumRowsRead: 25,
				},
			},
		);
		expect(client.query).toHaveBeenNthCalledWith(
			2,
			api.savedRoutes.listForCurrentUser,
			{
				paginationOpts: {
					numItems: 25,
					cursor: "cursor_1",
					maximumRowsRead: 25,
				},
			},
		);
		expect(state.applyRemoteRoutesEffect).toHaveBeenCalledWith("user_1", [
			routeA,
			routeB,
		]);
	});

	it("does not fetch or apply more pages after a stale request mid-pagination", async () => {
		let currentRequestId = 1;
		const state = createState();
		const client = createClient({
			query: vi.fn(async () => {
				currentRequestId = 2;
				return {
					page: [{ ...savedRoute, id: "stale-route" }],
					isDone: false,
					continueCursor: "cursor_1",
				};
			}),
		});

		await Effect.runPromise(
			syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => currentRequestId,
				requestId: 1,
				state,
				userId: "user_1",
			}),
		);

		expect(client.query).toHaveBeenCalledTimes(1);
		expect(state.applyRemoteRoutesEffect).not.toHaveBeenCalled();
	});

	it("ignores stale results when auth changes before the one-shot query starts", async () => {
		let currentRequestId = 1;
		const state = createState({
			runLocalMergeOnceEffect: vi.fn(() =>
				Effect.sync(() => {
					currentRequestId = 2;
				}),
			),
		});
		const client = createClient();

		await Effect.runPromise(
			syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => currentRequestId,
				requestId: 1,
				state,
				userId: "user_1",
			}),
		);

		expect(client.query).not.toHaveBeenCalled();
		expect(state.applyRemoteRoutesEffect).not.toHaveBeenCalled();
	});

	it("ignores stale results when auth changes while the one-shot query is in flight", async () => {
		let currentRequestId = 1;
		const state = createState();
		const client = createClient({
			query: vi.fn(async () => {
				currentRequestId = 2;
				return {
					page: [{ id: "stale-route" }],
					isDone: true,
					continueCursor: "done",
				};
			}),
		});

		await Effect.runPromise(
			syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => currentRequestId,
				requestId: 1,
				state,
				userId: "user_1",
			}),
		);

		expect(client.query).toHaveBeenCalledTimes(1);
		expect(state.applyRemoteRoutesEffect).not.toHaveBeenCalled();
	});

	it("sets the existing load error message when the one-shot query fails", async () => {
		const state = createState();
		const client = createClient({
			query: vi.fn().mockRejectedValue(new Error("network down")),
		});

		await Effect.runPromise(
			syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => 1,
				requestId: 1,
				state,
				userId: "user_1",
			}),
		);

		expect(state.syncError).toBe("Could not load synced routes: network down");
	});

	it("sets the existing load error message when local merge fails", async () => {
		const state = createState({
			runLocalMergeOnceEffect: vi.fn(() =>
				Effect.fail(new TestRemoteError("merge down")),
			),
		});
		const client = createClient();

		await Effect.runPromise(
			syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => 1,
				requestId: 1,
				state,
				userId: "user_1",
			}),
		);

		expect(state.syncError).toBe("Could not load synced routes: merge down");
		expect(state.applyRemoteRoutesEffect).not.toHaveBeenCalled();
		expect(client.query).not.toHaveBeenCalled();
	});

	it("keeps saves, deletes, and local merges wired through Convex mutations", async () => {
		const client = createClient();
		const adapter = createSavedRoutesRemoteAdapter(client);

		await Effect.runPromise(adapter.save(savedRoute));
		await Effect.runPromise(adapter.delete("route_1"));
		await Effect.runPromise(adapter.mergeLocalRoutes([savedRoute]));

		expect(client.mutation).toHaveBeenCalledTimes(3);
		expect(client.mutation).toHaveBeenNthCalledWith(1, api.savedRoutes.upsert, {
			savedRoute,
		});
		expect(client.mutation).toHaveBeenNthCalledWith(2, api.savedRoutes.remove, {
			routeId: "route_1",
		});
		expect(client.mutation).toHaveBeenNthCalledWith(
			3,
			api.savedRoutes.mergeLocalRoutes,
			{ savedRoutes: [savedRoute] },
		);
		expect(client.query).not.toHaveBeenCalled();
	});
});
