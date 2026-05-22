import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	BasemapId,
	DistanceUnit,
	ThemeMode,
} from "../lib/preferences/user-preference-values";
import { getForCurrentUser, upsertForCurrentUser } from "./userPreferences";

type UserPreferenceRow = {
	_id: string;
	userId: string;
	themeMode?: ThemeMode;
	mapStyle?: BasemapId;
	distanceUnit?: DistanceUnit;
	createdAtMs: number;
	updatedAtMs: number;
};

function createCtx({
	rows = [],
	userId = "user_1",
}: {
	rows?: UserPreferenceRow[];
	userId?: string | null;
} = {}) {
	const state = rows.map((row) => ({ ...row }));
	const ctx = {
		auth: {
			getUserIdentity: vi.fn(async () => (userId ? { subject: userId } : null)),
		},
		db: {
			query: vi.fn((_table: "userPreferences") => ({
				withIndex: vi.fn(
					(
						_index: "by_user",
						buildQuery: (query: {
							eq: (field: "userId", value: string) => { userId: string };
						}) => { userId: string },
					) => {
						const filter = buildQuery({
							eq: (_field, value) => ({ userId: value }),
						});

						return {
							unique: vi.fn(async () => {
								return (
									state.find((row) => row.userId === filter.userId) ?? null
								);
							}),
						};
					},
				),
			})),
			patch: vi.fn(async (id: string, patch: Partial<UserPreferenceRow>) => {
				const row = state.find((candidate) => candidate._id === id);

				if (!row) {
					throw new Error(`Missing row: ${id}`);
				}

				Object.assign(row, patch);
			}),
			insert: vi.fn(
				async (
					_table: "userPreferences",
					row: Omit<UserPreferenceRow, "_id">,
				) => {
					state.push({ ...row, _id: `pref_${state.length + 1}` });
				},
			),
		},
	};

	return { ctx, state };
}

async function runQuery(ctx: unknown) {
	return await (
		getForCurrentUser as unknown as {
			_handler: (ctx: unknown, args: Record<string, never>) => unknown;
		}
	)._handler(ctx, {});
}

async function runMutation(ctx: unknown, preferences: object) {
	return await (
		upsertForCurrentUser as unknown as {
			_handler: (ctx: unknown, args: { preferences: object }) => unknown;
		}
	)._handler(ctx, { preferences });
}

describe("userPreferences Convex functions", () => {
	beforeEach(() => {
		vi.spyOn(Date, "now").mockReturnValue(1234);
	});

	it("returns the authenticated user's preference snapshot", async () => {
		const { ctx } = createCtx({
			rows: [
				{
					_id: "pref_1",
					userId: "user_1",
					themeMode: "dark",
					mapStyle: "maptiler-outdoor",
					distanceUnit: "mi",
					createdAtMs: 1000,
					updatedAtMs: 1100,
				},
			],
		});

		await expect(runQuery(ctx)).resolves.toEqual({
			themeMode: "dark",
			mapStyle: "maptiler-outdoor",
			distanceUnit: "mi",
			createdAtMs: 1000,
			updatedAtMs: 1100,
		});
	});

	it("inserts preferences for an authenticated user with no row", async () => {
		const { ctx, state } = createCtx();

		await expect(
			runMutation(ctx, {
				themeMode: "light",
				mapStyle: "stadia-alidade-smooth",
				distanceUnit: "km",
			}),
		).resolves.toEqual({ inserted: true });

		expect(state).toEqual([
			{
				_id: "pref_1",
				userId: "user_1",
				themeMode: "light",
				mapStyle: "stadia-alidade-smooth",
				distanceUnit: "km",
				createdAtMs: 1234,
				updatedAtMs: 1234,
			},
		]);
	});

	it("partially updates an existing preference row", async () => {
		const { ctx, state } = createCtx({
			rows: [
				{
					_id: "pref_1",
					userId: "user_1",
					themeMode: "system",
					mapStyle: "stadia-alidade-smooth",
					distanceUnit: "km",
					createdAtMs: 1000,
					updatedAtMs: 1100,
				},
			],
		});

		await expect(
			runMutation(ctx, {
				distanceUnit: "mi",
			}),
		).resolves.toEqual({ inserted: false });

		expect(state[0]).toEqual({
			_id: "pref_1",
			userId: "user_1",
			themeMode: "system",
			mapStyle: "stadia-alidade-smooth",
			distanceUnit: "mi",
			createdAtMs: 1000,
			updatedAtMs: 1234,
		});
	});

	it("rejects unauthenticated lookup and mutation", async () => {
		const { ctx } = createCtx({ userId: null });

		await expect(runQuery(ctx)).rejects.toThrow(
			"Authentication is required to sync user preferences.",
		);
		await expect(runMutation(ctx, { themeMode: "dark" })).rejects.toThrow(
			"Authentication is required to sync user preferences.",
		);
	});
});
