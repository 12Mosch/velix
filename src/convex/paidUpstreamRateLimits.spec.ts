import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkHandler } from "./paidUpstreamRateLimits";

type Bucket = "route" | "suggestion" | "reverse";

type RateLimitRow = {
	_id: string;
	bucket: Bucket;
	subjectHash: string;
	count: number;
	resetAtMs: number;
	updatedAtMs: number;
};

type IndexQuery = {
	readonly filters: Record<string, string | number>;
	eq: (field: "bucket" | "subjectHash", value: string) => IndexQuery;
	lt: (field: "resetAtMs", value: number) => IndexQuery;
};

function createCtx(rows: RateLimitRow[] = []) {
	const state = rows.map((row) => ({ ...row }));
	let nextId = state.length + 1;
	const ctx = {
		db: {
			query: vi.fn((table: "paidUpstreamRateLimits") => ({
				withIndex: vi.fn(
					(
						index: "by_bucket_subject" | "by_resetAtMs",
						buildQuery: (query: IndexQuery) => IndexQuery,
					) => {
						const makeQuery = (
							filters: Record<string, string | number>,
						): IndexQuery => ({
							filters,
							eq: (field, value) =>
								makeQuery({
									...filters,
									[field]: value,
								}),
							lt: (field, value) =>
								makeQuery({
									...filters,
									[field]: value,
								}),
						});
						const { filters } = buildQuery(makeQuery({}));

						const matchingRows = () => {
							if (table !== "paidUpstreamRateLimits") {
								return [];
							}

							if (index === "by_bucket_subject") {
								return state.filter(
									(row) =>
										row.bucket === filters.bucket &&
										row.subjectHash === filters.subjectHash,
								);
							}

							return state
								.filter(
									(row) =>
										typeof filters.resetAtMs === "number" &&
										row.resetAtMs < filters.resetAtMs,
								)
								.sort((a, b) => a.resetAtMs - b.resetAtMs);
						};

						return {
							unique: vi.fn(async () => {
								return matchingRows()[0] ?? null;
							}),
							take: vi.fn(async (limit: number) =>
								matchingRows().slice(0, limit),
							),
						};
					},
				),
			})),
			insert: vi.fn(
				async (
					_table: "paidUpstreamRateLimits",
					row: Omit<RateLimitRow, "_id">,
				) => {
					state.push({ ...row, _id: `limit_${nextId++}` });
				},
			),
			patch: vi.fn(async (id: string, patch: Partial<RateLimitRow>) => {
				const row = state.find((candidate) => candidate._id === id);

				if (row) {
					Object.assign(row, patch);
				}
			}),
			delete: vi.fn(async (id: string) => {
				const index = state.findIndex((row) => row._id === id);

				if (index >= 0) {
					state.splice(index, 1);
				}
			}),
		},
	};

	return { ctx, state };
}

async function runCheck(
	ctx: unknown,
	args: Parameters<typeof checkHandler>[1],
) {
	return await checkHandler(ctx as Parameters<typeof checkHandler>[0], args);
}

describe("paidUpstreamRateLimits Convex mutation", () => {
	beforeEach(() => {
		vi.stubEnv("RATE_LIMIT_CONVEX_SECRET", "shared-secret");
		vi.spyOn(Date, "now").mockReturnValue(1_000);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("creates a bucket and allows the first request", async () => {
		const { ctx, state } = createCtx();

		await expect(
			runCheck(ctx, {
				bucket: "route",
				subjectHash: "subject-a",
				secret: "shared-secret",
			}),
		).resolves.toEqual({ allowed: true });

		expect(state).toEqual([
			{
				_id: "limit_1",
				bucket: "route",
				subjectHash: "subject-a",
				count: 1,
				resetAtMs: 61_000,
				updatedAtMs: 1_000,
			},
		]);
	});

	it("allows requests up to the route maximum", async () => {
		const { ctx, state } = createCtx();

		for (let index = 0; index < 10; index += 1) {
			await expect(
				runCheck(ctx, {
					bucket: "route",
					subjectHash: "subject-a",
					secret: "shared-secret",
				}),
			).resolves.toEqual({ allowed: true });
		}

		expect(state[0]?.count).toBe(10);
	});

	it("rejects requests over the route maximum", async () => {
		const { ctx } = createCtx([
			{
				_id: "limit_1",
				bucket: "route",
				subjectHash: "subject-a",
				count: 10,
				resetAtMs: 61_000,
				updatedAtMs: 1_000,
			},
		]);

		await expect(
			runCheck(ctx, {
				bucket: "route",
				subjectHash: "subject-a",
				secret: "shared-secret",
			}),
		).resolves.toEqual({
			allowed: false,
			retryAfterSeconds: 60,
		});
	});

	it("resets an expired window", async () => {
		vi.mocked(Date.now).mockReturnValue(62_000);
		const { ctx, state } = createCtx([
			{
				_id: "limit_1",
				bucket: "route",
				subjectHash: "subject-a",
				count: 10,
				resetAtMs: 61_000,
				updatedAtMs: 1_000,
			},
		]);

		await expect(
			runCheck(ctx, {
				bucket: "route",
				subjectHash: "subject-a",
				secret: "shared-secret",
			}),
		).resolves.toEqual({ allowed: true });

		expect(state).toHaveLength(1);
		expect(state[0]).toEqual({
			_id: expect.any(String),
			bucket: "route",
			subjectHash: "subject-a",
			count: 1,
			resetAtMs: 122_000,
			updatedAtMs: 62_000,
		});
	});

	it("rejects an invalid shared secret without DB writes", async () => {
		const { ctx, state } = createCtx();

		await expect(
			runCheck(ctx, {
				bucket: "route",
				subjectHash: "subject-a",
				secret: "wrong-secret",
			}),
		).rejects.toThrow("Invalid rate limit secret.");

		expect(state).toEqual([]);
		expect(ctx.db.insert).not.toHaveBeenCalled();
		expect(ctx.db.patch).not.toHaveBeenCalled();
		expect(ctx.db.delete).not.toHaveBeenCalled();
	});

	it("rejects when RATE_LIMIT_CONVEX_SECRET is missing or blank", async () => {
		for (const secret of [undefined, ""]) {
			vi.stubEnv("RATE_LIMIT_CONVEX_SECRET", secret);
			const { ctx, state } = createCtx();

			await expect(
				runCheck(ctx, {
					bucket: "route",
					subjectHash: "subject-a",
					secret: "shared-secret",
				}),
			).rejects.toThrow("Invalid rate limit secret.");

			expect(state).toEqual([]);
			expect(ctx.db.insert).not.toHaveBeenCalled();
			expect(ctx.db.patch).not.toHaveBeenCalled();
			expect(ctx.db.delete).not.toHaveBeenCalled();
		}
	});

	it("bounds expired-row cleanup", async () => {
		const expiredRows = Array.from({ length: 12 }, (_, index) => ({
			_id: `expired_${index}`,
			bucket: "suggestion" as const,
			subjectHash: `expired-${index}`,
			count: 1,
			resetAtMs: 999,
			updatedAtMs: 1,
		}));
		const { ctx, state } = createCtx(expiredRows);

		await expect(
			runCheck(ctx, {
				bucket: "reverse",
				subjectHash: "subject-a",
				secret: "shared-secret",
			}),
		).resolves.toEqual({ allowed: true });

		expect(ctx.db.delete).toHaveBeenCalledTimes(8);
		expect(state.filter((row) => row._id.startsWith("expired_"))).toHaveLength(
			4,
		);
	});
});
