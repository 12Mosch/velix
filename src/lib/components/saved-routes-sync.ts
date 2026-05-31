import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";
import type { SavedRoutesRemoteAdapter } from "$lib/saved-routes.svelte";
import type { RemoteSavedRoutePayload } from "$lib/saved-routes-core";
import { api } from "../../convex/_generated/api";
import { Effect } from "effect";

type SavedRoutesRemotePage = FunctionReturnType<
	typeof api.savedRoutes.listForCurrentUser
>;
type SavedRoutesRemoteSnapshot = SavedRoutesRemotePage["page"];

const savedRoutesSyncPageSize = 25;
const savedRoutesSyncMaximumRowsRead = 25;

export type SavedRoutesSyncState = {
	applyRemoteRoutesEffect: (
		userId: string,
		routes: SavedRoutesRemoteSnapshot,
	) => Effect.Effect<void>;
	runLocalMergeOnceEffect: (userId: string) => Effect.Effect<void, Error>;
	syncError: string | null;
};

export type SavedRoutesConvexClient = {
	query<Query extends FunctionReference<"query">>(
		queryRef: Query,
		args: FunctionArgs<Query>,
	): Promise<FunctionReturnType<Query>>;
	mutation<Mutation extends FunctionReference<"mutation">>(
		mutationRef: Mutation,
		args: FunctionArgs<Mutation>,
	): Promise<FunctionReturnType<Mutation>>;
};

class SavedRoutesConvexError extends Error {
	readonly _tag = "SavedRoutesConvexError";

	constructor(cause: unknown, fallbackMessage: string) {
		super(cause instanceof Error ? cause.message : fallbackMessage, { cause });
	}
}

function toConvexError(cause: unknown, fallbackMessage: string) {
	return new SavedRoutesConvexError(cause, fallbackMessage);
}

function convexQueryEffect<Query extends FunctionReference<"query">>(
	client: SavedRoutesConvexClient,
	queryRef: Query,
	args: FunctionArgs<Query>,
): Effect.Effect<FunctionReturnType<Query>, Error> {
	return Effect.tryPromise({
		try: () => client.query(queryRef, args),
		catch: (cause) => toConvexError(cause, "Convex query failed."),
	});
}

function convexMutationEffect<Mutation extends FunctionReference<"mutation">>(
	client: SavedRoutesConvexClient,
	mutationRef: Mutation,
	args: FunctionArgs<Mutation>,
): Effect.Effect<FunctionReturnType<Mutation>, Error> {
	return Effect.tryPromise({
		try: () => client.mutation(mutationRef, args),
		catch: (cause) => toConvexError(cause, "Convex mutation failed."),
	});
}

export function createSavedRoutesRemoteAdapter(
	client: SavedRoutesConvexClient,
): SavedRoutesRemoteAdapter {
	return {
		save: (savedRoute: RemoteSavedRoutePayload) =>
			convexMutationEffect(client, api.savedRoutes.upsert, { savedRoute }).pipe(
				Effect.asVoid,
			),
		delete: (routeId: string) =>
			convexMutationEffect(client, api.savedRoutes.remove, { routeId }).pipe(
				Effect.asVoid,
			),
		listVersions: (routeId: string) =>
			convexQueryEffect(client, api.savedRoutes.listVersionsForRoute, {
				routeId,
			}),
		mergeLocalRoutes: (savedRoutes: RemoteSavedRoutePayload[]) =>
			convexMutationEffect(client, api.savedRoutes.mergeLocalRoutes, {
				savedRoutes,
			}),
	};
}

export const syncSavedRoutesOnce = Effect.fn("syncSavedRoutesOnce")(function* ({
	client,
	getCurrentRequestId,
	requestId,
	state,
	userId,
}: {
	client: SavedRoutesConvexClient;
	getCurrentRequestId: () => number;
	requestId: number;
	state: SavedRoutesSyncState;
	userId: string;
}): Effect.fn.Return<void, never> {
	yield* Effect.gen(function* () {
		yield* state.runLocalMergeOnceEffect(userId);

		if (getCurrentRequestId() !== requestId) {
			return;
		}

		let cursor: string | null = null;
		const remoteRoutes: RemoteSavedRoutePayload[] = [];

		do {
			const page: SavedRoutesRemotePage = yield* convexQueryEffect(
				client,
				api.savedRoutes.listForCurrentUser,
				{
					paginationOpts: {
						numItems: savedRoutesSyncPageSize,
						cursor,
						maximumRowsRead: savedRoutesSyncMaximumRowsRead,
					},
				},
			);

			if (getCurrentRequestId() !== requestId) {
				return;
			}

			remoteRoutes.push(...page.page);
			cursor = page.isDone ? null : page.continueCursor;
		} while (cursor && getCurrentRequestId() === requestId);

		if (getCurrentRequestId() !== requestId) {
			return;
		}

		yield* state.applyRemoteRoutesEffect(userId, remoteRoutes);
	}).pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				if (getCurrentRequestId() !== requestId) {
					return;
				}

				state.syncError = `Could not load synced routes: ${error.message}`;
			}),
		),
	);
});
