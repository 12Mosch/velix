import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";
import type { SavedRoutesRemoteAdapter } from "$lib/saved-routes.svelte";
import type {
	RemoteSavedRoutePayload,
	RemoteSavedRouteSummaryPayload,
} from "$lib/saved-routes-core";
import type { SavedRouteSummaryFilters } from "$lib/saved-routes/saved-routes-use-cases";
import { api } from "../../convex/_generated/api";
import { Effect } from "effect";

type SavedRoutesRemotePage = FunctionReturnType<
	typeof api.savedRoutes.listSummariesForCurrentUser
>;
type SavedRoutesRemoteSnapshot = SavedRoutesRemotePage["page"];

const savedRoutesSyncPageSize = 25;
const savedRoutesSyncMaximumRowsRead = 25;

export type SavedRoutesSyncState = {
	applyRemoteRouteSummariesEffect: (
		userId: string,
		routes: SavedRoutesRemoteSnapshot,
		continueCursor: string | null,
		filters?: SavedRouteSummaryFilters,
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
		get: (routeId: string) =>
			convexQueryEffect(client, api.savedRoutes.getForCurrentUser, { routeId }),
		listSummaries: ({ paginationOpts, filters = {} }) =>
			convexQueryEffect(client, api.savedRoutes.listSummariesForCurrentUser, {
				paginationOpts,
				...filters,
			}),
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

		const page: SavedRoutesRemotePage = yield* convexQueryEffect(
			client,
			api.savedRoutes.listSummariesForCurrentUser,
			{
				paginationOpts: {
					numItems: savedRoutesSyncPageSize,
					cursor: null,
					maximumRowsRead: savedRoutesSyncMaximumRowsRead,
				},
			},
		);

		if (getCurrentRequestId() !== requestId) {
			return;
		}

		yield* state.applyRemoteRouteSummariesEffect(
			userId,
			page.page as RemoteSavedRouteSummaryPayload[],
			page.isDone ? null : page.continueCursor,
			{},
		);
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
