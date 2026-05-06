import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import {
	createSavedRoutesRemoteAdapter,
	type SavedRoutesConvexClient,
	type SavedRoutesSyncState,
	syncSavedRoutesOnce,
} from "./saved-routes-sync";

type MockFn = ReturnType<typeof vi.fn>;

type TestState = SavedRoutesSyncState & {
	applyRemoteRoutes: MockFn;
	runLocalMergeOnce: MockFn;
};

type TestClient = SavedRoutesConvexClient & {
	mutation: MockFn;
	query: MockFn;
};

function createState(overrides: Partial<TestState> = {}): TestState {
	return {
		applyRemoteRoutes: vi.fn(),
		runLocalMergeOnce: vi.fn().mockResolvedValue(undefined),
		syncError: null,
		...overrides,
	} as TestState;
}

function createClient(overrides: Partial<TestClient> = {}): TestClient {
	return {
		mutation: vi.fn().mockResolvedValue(undefined),
		query: vi.fn().mockResolvedValue([]),
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
			applyRemoteRoutes: vi.fn(() => {
				events.push("apply");
			}),
			runLocalMergeOnce: vi.fn(async () => {
				events.push("merge");
			}),
		});
		const client = createClient({
			query: vi.fn(async () => {
				events.push("query");
				return remoteRoutes;
			}),
		});

		await syncSavedRoutesOnce({
			client,
			getCurrentRequestId: () => 1,
			requestId: 1,
			state,
			userId: "user_1",
		});

		expect(events).toEqual(["merge", "query", "apply"]);
		expect(client.query).toHaveBeenCalledTimes(1);
		expect(state.applyRemoteRoutes).toHaveBeenCalledWith(
			"user_1",
			remoteRoutes,
		);
	});

	it("ignores stale results when auth changes before the one-shot query starts", async () => {
		let currentRequestId = 1;
		const state = createState({
			runLocalMergeOnce: vi.fn(async () => {
				currentRequestId = 2;
			}),
		});
		const client = createClient();

		await syncSavedRoutesOnce({
			client,
			getCurrentRequestId: () => currentRequestId,
			requestId: 1,
			state,
			userId: "user_1",
		});

		expect(client.query).not.toHaveBeenCalled();
		expect(state.applyRemoteRoutes).not.toHaveBeenCalled();
	});

	it("ignores stale results when auth changes while the one-shot query is in flight", async () => {
		let currentRequestId = 1;
		const state = createState();
		const client = createClient({
			query: vi.fn(async () => {
				currentRequestId = 2;
				return [{ id: "stale-route" }];
			}),
		});

		await syncSavedRoutesOnce({
			client,
			getCurrentRequestId: () => currentRequestId,
			requestId: 1,
			state,
			userId: "user_1",
		});

		expect(client.query).toHaveBeenCalledTimes(1);
		expect(state.applyRemoteRoutes).not.toHaveBeenCalled();
	});

	it("sets the existing load error message when the one-shot query fails", async () => {
		const state = createState();
		const client = createClient({
			query: vi.fn().mockRejectedValue(new Error("network down")),
		});

		await syncSavedRoutesOnce({
			client,
			getCurrentRequestId: () => 1,
			requestId: 1,
			state,
			userId: "user_1",
		});

		expect(state.syncError).toBe("Could not load synced routes: network down");
	});

	it("sets the existing load error message when local merge fails", async () => {
		const state = createState({
			runLocalMergeOnce: vi.fn().mockRejectedValue(new Error("merge down")),
		});
		const client = createClient();

		await syncSavedRoutesOnce({
			client,
			getCurrentRequestId: () => 1,
			requestId: 1,
			state,
			userId: "user_1",
		});

		expect(state.syncError).toBe("Could not load synced routes: merge down");
		expect(state.applyRemoteRoutes).not.toHaveBeenCalled();
		expect(client.query).not.toHaveBeenCalled();
	});

	it("keeps saves, deletes, and local merges wired through Convex mutations", async () => {
		const client = createClient();
		const adapter = createSavedRoutesRemoteAdapter(client);

		await adapter.save(savedRoute);
		await adapter.delete("route_1");
		await adapter.mergeLocalRoutes([savedRoute]);

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
