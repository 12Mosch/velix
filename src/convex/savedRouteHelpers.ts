import { Effect } from "effect";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { tryConvexPromise } from "./effect";
import {
	deserializeRemoteSavedRoute,
	serializeSavedRouteForRemote,
	type RemoteSavedRoutePayload,
} from "../lib/saved-routes-core";

export type ValidatedRemoteSavedRoute = RemoteSavedRoutePayload & {
	createdAtMs: number;
};

export function getAuthenticatedUserIdEffect<E extends Error>(
	ctx: QueryCtx | MutationCtx,
	createAuthenticationError: () => E,
): Effect.Effect<string, Error | E> {
	return tryConvexPromise(
		() => ctx.auth.getUserIdentity(),
		"Could not read authenticated user.",
	).pipe(
		Effect.flatMap((identity) =>
			identity
				? Effect.succeed(identity.subject)
				: Effect.fail(createAuthenticationError()),
		),
	);
}

export function validateRemoteSavedRoutePayload(
	value: unknown,
): ValidatedRemoteSavedRoute | null {
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
