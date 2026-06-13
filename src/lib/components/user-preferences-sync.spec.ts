import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import { api } from "../../convex/_generated/api";
import {
	createUserPreferencesRemoteAdapter,
	diffUserPreferencesPatch,
	type UserPreferencesConvexClient,
	type UserPreferencesPatch,
	type UserPreferencesSyncState,
	syncUserPreferencesSnapshot,
} from "./user-preferences-sync";

type MockFn = ReturnType<typeof vi.fn>;

type TestClient = UserPreferencesConvexClient & {
	mutation: MockFn;
	query: MockFn;
};

type TestState = UserPreferencesSyncState & {
	applyRemotePreferences: MockFn;
	readLocalPreferences: MockFn;
};

function createClient(overrides: Partial<TestClient> = {}): TestClient {
	return {
		mutation: vi.fn().mockResolvedValue(undefined),
		query: vi.fn(),
		...overrides,
	} as TestClient;
}

function createState(overrides: Partial<TestState> = {}): TestState {
	return {
		applyRemotePreferences: vi.fn(),
		readLocalPreferences: vi.fn(() =>
			Effect.succeed({
				themeMode: "system",
				mapStyle: "stadia-alidade-smooth",
				distanceUnit: "km",
			}),
		),
		syncError: null,
		...overrides,
	} as TestState;
}

describe("user preference account sync", () => {
	it("applies remote account preferences over local values on sign-in", async () => {
		const remotePreferences = {
			themeMode: "dark",
			mapStyle: "maptiler-outdoor",
			distanceUnit: "mi",
			createdAtMs: 1000,
			updatedAtMs: 1000,
		} as const;
		const appliedPreferences: UserPreferencesPatch = {
			themeMode: "dark",
			mapStyle: "maptiler-outdoor",
			distanceUnit: "mi",
		};
		const state = createState({
			applyRemotePreferences: vi.fn(() => Effect.succeed(appliedPreferences)),
		});
		const adapter = { save: vi.fn(() => Effect.void) };

		await expect(
			Effect.runPromise(
				syncUserPreferencesSnapshot({
					adapter,
					getCurrentRequestId: () => 1,
					remotePreferences,
					requestId: 1,
					state,
					userId: "user_1",
				}),
			),
		).resolves.toEqual(appliedPreferences);

		expect(state.applyRemotePreferences).toHaveBeenCalledWith(
			"user_1",
			remotePreferences,
		);
		expect(adapter.save).not.toHaveBeenCalled();
	});

	it("seeds the account from local values when no remote row exists", async () => {
		const localPreferences: UserPreferencesPatch = {
			themeMode: "light",
			mapStyle: "stadia-stamen-terrain",
			distanceUnit: "km",
		};
		const state = createState({
			readLocalPreferences: vi.fn(() => Effect.succeed(localPreferences)),
		});
		const adapter = { save: vi.fn(() => Effect.void) };

		await expect(
			Effect.runPromise(
				syncUserPreferencesSnapshot({
					adapter,
					getCurrentRequestId: () => 1,
					remotePreferences: null,
					requestId: 1,
					state,
					userId: "user_1",
				}),
			),
		).resolves.toEqual(localPreferences);

		expect(adapter.save).toHaveBeenCalledWith(localPreferences);
		expect(state.applyRemotePreferences).not.toHaveBeenCalled();
	});

	it("skips remote apply when the account preference request is already stale", async () => {
		const state = createState({
			applyRemotePreferences: vi.fn(() => Effect.succeed({})),
		});
		const adapter = { save: vi.fn(() => Effect.void) };

		await expect(
			Effect.runPromise(
				syncUserPreferencesSnapshot({
					adapter,
					getCurrentRequestId: () => 2,
					remotePreferences: {
						themeMode: "dark",
						mapStyle: "maptiler-outdoor",
						distanceUnit: "mi",
						createdAtMs: 1000,
						updatedAtMs: 1000,
					},
					requestId: 1,
					state,
					userId: "user_1",
				}),
			),
		).resolves.toBeNull();

		expect(state.applyRemotePreferences).not.toHaveBeenCalled();
		expect(adapter.save).not.toHaveBeenCalled();
		expect(state.syncError).toBeNull();
	});

	it("skips local preference save when the empty remote snapshot is already stale", async () => {
		const state = createState({
			readLocalPreferences: vi.fn(() => Effect.succeed({})),
		});
		const adapter = { save: vi.fn(() => Effect.void) };

		await expect(
			Effect.runPromise(
				syncUserPreferencesSnapshot({
					adapter,
					getCurrentRequestId: () => 2,
					remotePreferences: null,
					requestId: 1,
					state,
					userId: "user_1",
				}),
			),
		).resolves.toBeNull();

		expect(state.readLocalPreferences).not.toHaveBeenCalled();
		expect(adapter.save).not.toHaveBeenCalled();
		expect(state.syncError).toBeNull();
	});

	it("persists later user changes as a partial Convex mutation patch", async () => {
		const client = createClient();
		const adapter = createUserPreferencesRemoteAdapter(client);
		const previousPreferences: UserPreferencesPatch = {
			themeMode: "system",
			mapStyle: "stadia-alidade-smooth",
			distanceUnit: "km",
		};
		const nextPreferences: UserPreferencesPatch = {
			themeMode: "dark",
			mapStyle: "stadia-alidade-smooth",
			distanceUnit: "km",
		};
		const patch = diffUserPreferencesPatch(
			previousPreferences,
			nextPreferences,
		);

		await Effect.runPromise(adapter.save(patch));

		expect(client.mutation).toHaveBeenCalledWith(
			api.userPreferences.upsertForCurrentUser,
			{
				preferences: { themeMode: "dark" },
			},
		);
	});

	it("does not apply stale remote results after auth changes", async () => {
		let currentRequestId = 1;
		const appliedPreferences: UserPreferencesPatch = {
			themeMode: "dark",
			mapStyle: "maptiler-outdoor",
			distanceUnit: "mi",
		};
		const state = createState({
			applyRemotePreferences: vi.fn(() =>
				Effect.sync(() => {
					currentRequestId = 2;
					return appliedPreferences;
				}),
			),
		});
		const adapter = { save: vi.fn(() => Effect.void) };

		await expect(
			Effect.runPromise(
				syncUserPreferencesSnapshot({
					adapter,
					getCurrentRequestId: () => currentRequestId,
					remotePreferences: {
						themeMode: "dark",
						mapStyle: "maptiler-outdoor",
						distanceUnit: "mi",
						createdAtMs: 1000,
						updatedAtMs: 1000,
					},
					requestId: 1,
					state,
					userId: "user_1",
				}),
			),
		).resolves.toBeNull();

		expect(state.syncError).toBeNull();
	});
});
