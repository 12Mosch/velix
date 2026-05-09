import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	deserializeRemoteSavedRoute,
	serializeSavedRouteForRemote,
	type RemoteSavedRoutePayload,
} from "../lib/saved-routes-core";
import { remoteSavedRoutePayloadValidator } from "../lib/saved-route-convex-validators";

const shareTokenPattern = /^[A-Za-z0-9_-]{16,128}$/;

type ValidatedSharedRoute = RemoteSavedRoutePayload & {
	createdAtMs: number;
};

async function getAuthenticatedUserId(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();

	if (!identity) {
		throw new Error("Authentication is required to share routes.");
	}

	return identity.subject;
}

function isValidShareToken(shareToken: string): boolean {
	return shareTokenPattern.test(shareToken);
}

function validateRemoteSavedRoutePayload(
	value: unknown,
): ValidatedSharedRoute | null {
	const savedRoute = deserializeRemoteSavedRoute(value);
	if (!savedRoute) {
		return null;
	}

	const remotePayload = serializeSavedRouteForRemote(savedRoute);
	const createdAtMs = Date.parse(remotePayload.createdAt);

	return Number.isFinite(createdAtMs)
		? {
				...remotePayload,
				createdAtMs,
			}
		: null;
}

function remotePayloadFromRow(row: {
	routeJson: string;
	createdAtMs: number;
}): RemoteSavedRoutePayload | null {
	const createdAt = new Date(row.createdAtMs).toISOString();
	const payload = {
		id: "shared-route",
		createdAt,
		routeJson: row.routeJson,
	};
	const savedRoute = deserializeRemoteSavedRoute(payload);

	return savedRoute ? serializeSavedRouteForRemote(savedRoute) : null;
}

export async function createHandler(
	ctx: MutationCtx,
	args: {
		shareToken: string;
		sourceRouteId?: string;
		savedRoute: RemoteSavedRoutePayload;
	},
) {
	const ownerUserId = await getAuthenticatedUserId(ctx);

	if (!isValidShareToken(args.shareToken)) {
		throw new Error("Share token is invalid.");
	}

	const savedRoute = validateRemoteSavedRoutePayload(args.savedRoute);
	if (!savedRoute) {
		throw new Error("Shared route payload is invalid.");
	}

	let sourceRouteId: string | undefined;
	if (args.sourceRouteId) {
		const requestedSourceRouteId = args.sourceRouteId;
		const sourceRoute = await ctx.db
			.query("savedRoutes")
			.withIndex("by_user_routeId", (q) =>
				q.eq("userId", ownerUserId).eq("routeId", requestedSourceRouteId),
			)
			.unique();

		if (!sourceRoute) {
			throw new Error(
				"Shared route source does not belong to the current user.",
			);
		}

		sourceRouteId = requestedSourceRouteId;
	}

	const existingShare = await ctx.db
		.query("sharedRoutes")
		.withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
		.unique();

	if (existingShare) {
		throw new Error("Share token already exists.");
	}

	await ctx.db.insert("sharedRoutes", {
		shareToken: args.shareToken,
		ownerUserId,
		...(sourceRouteId ? { sourceRouteId } : {}),
		createdAtMs: Date.now(),
		routeJson: savedRoute.routeJson,
	});

	return {
		shareToken: args.shareToken,
		urlPath: `/share/${args.shareToken}`,
	};
}

export async function getByTokenHandler(
	ctx: QueryCtx,
	args: { shareToken: string },
) {
	if (!isValidShareToken(args.shareToken)) {
		return null;
	}

	const sharedRoute = await ctx.db
		.query("sharedRoutes")
		.withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
		.unique();

	return sharedRoute ? remotePayloadFromRow(sharedRoute) : null;
}

export const create = mutation({
	args: {
		shareToken: v.string(),
		sourceRouteId: v.optional(v.string()),
		savedRoute: remoteSavedRoutePayloadValidator,
	},
	handler: createHandler,
});

export const getByToken = query({
	args: {
		shareToken: v.string(),
	},
	handler: getByTokenHandler,
});
