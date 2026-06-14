import { ConvexError, v } from "convex/values";

import type { MutationCtx } from "./_generated/server";
import { mutation } from "./_generated/server";

declare const process: {
	env: {
		RATE_LIMIT_CONVEX_SECRET?: string;
	};
};

export type PaidUpstreamRateLimitBucket =
	| "route"
	| "suggestion"
	| "reverse"
	| "graphhopper_route";

export type PaidUpstreamRateLimitResult =
	| {
			allowed: true;
	  }
	| {
			allowed: false;
			retryAfterSeconds: number;
	  };

const limits: Record<
	PaidUpstreamRateLimitBucket,
	{ maxRequests: number; windowMs: number }
> = {
	route: { maxRequests: 10, windowMs: 60_000 },
	suggestion: { maxRequests: 60, windowMs: 60_000 },
	reverse: { maxRequests: 60, windowMs: 60_000 },
	graphhopper_route: { maxRequests: 10, windowMs: 60_000 },
};

const cleanupBatchSize = 8;

function getConfiguredSecret(): string | null {
	const secret = process.env.RATE_LIMIT_CONVEX_SECRET?.trim();
	return secret ? secret : null;
}

async function cleanupExpiredRows(ctx: MutationCtx, now: number) {
	const expiredRows = await ctx.db
		.query("paidUpstreamRateLimits")
		.withIndex("by_resetAtMs", (q) => q.lt("resetAtMs", now))
		.take(cleanupBatchSize);

	await Promise.all(expiredRows.map((row) => ctx.db.delete(row._id)));
}

export async function checkHandler(
	ctx: MutationCtx,
	args: {
		bucket: PaidUpstreamRateLimitBucket;
		subjectHash: string;
		secret: string;
	},
): Promise<PaidUpstreamRateLimitResult> {
	const configuredSecret = getConfiguredSecret();

	if (!configuredSecret || args.secret !== configuredSecret) {
		throw new ConvexError("Invalid rate limit secret.");
	}

	const limit = limits[args.bucket];
	const now = Date.now();

	await cleanupExpiredRows(ctx, now);

	const existing = await ctx.db
		.query("paidUpstreamRateLimits")
		.withIndex("by_bucket_subject", (q) =>
			q.eq("bucket", args.bucket).eq("subjectHash", args.subjectHash),
		)
		.unique();

	if (!existing || existing.resetAtMs <= now) {
		const resetAtMs = now + limit.windowMs;

		if (existing) {
			await ctx.db.patch(existing._id, {
				count: 1,
				resetAtMs,
				updatedAtMs: now,
			});
		} else {
			await ctx.db.insert("paidUpstreamRateLimits", {
				bucket: args.bucket,
				subjectHash: args.subjectHash,
				count: 1,
				resetAtMs,
				updatedAtMs: now,
			});
		}

		return { allowed: true };
	}

	if (existing.count >= limit.maxRequests) {
		return {
			allowed: false,
			retryAfterSeconds: Math.max(
				1,
				Math.ceil((existing.resetAtMs - now) / 1000),
			),
		};
	}

	await ctx.db.patch(existing._id, {
		count: existing.count + 1,
		updatedAtMs: now,
	});

	return { allowed: true };
}

export const check = mutation({
	args: {
		bucket: v.union(
			v.literal("route"),
			v.literal("suggestion"),
			v.literal("reverse"),
			v.literal("graphhopper_route"),
		),
		subjectHash: v.string(),
		secret: v.string(),
	},
	returns: v.union(
		v.object({
			allowed: v.literal(true),
		}),
		v.object({
			allowed: v.literal(false),
			retryAfterSeconds: v.number(),
		}),
	),
	handler: checkHandler,
});
