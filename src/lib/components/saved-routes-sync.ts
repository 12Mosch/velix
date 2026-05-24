import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";
import type { SavedRoutesRemoteAdapter } from "$lib/saved-routes.svelte";
import type { RemoteSavedRoutePayload } from "$lib/saved-routes-core";
import { api } from "../../convex/_generated/api";

type SavedRoutesRemotePage = FunctionReturnType<
	typeof api.savedRoutes.listForCurrentUser
>;
type SavedRoutesRemoteSnapshot = SavedRoutesRemotePage["page"];

const savedRoutesSyncPageSize = 25;
const savedRoutesSyncMaximumRowsRead = 25;

export type SavedRoutesSyncState = {
	applyRemoteRoutes: (
		userId: string,
		routes: SavedRoutesRemoteSnapshot,
	) => Promise<void>;
	runLocalMergeOnce: (userId: string) => Promise<void>;
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

export function createSavedRoutesRemoteAdapter(
	client: SavedRoutesConvexClient,
): SavedRoutesRemoteAdapter {
	return {
		save: async (savedRoute: RemoteSavedRoutePayload) => {
			await client.mutation(api.savedRoutes.upsert, { savedRoute });
		},
		delete: async (routeId: string) => {
			await client.mutation(api.savedRoutes.remove, { routeId });
		},
		mergeLocalRoutes: async (savedRoutes: RemoteSavedRoutePayload[]) => {
			return await client.mutation(api.savedRoutes.mergeLocalRoutes, {
				savedRoutes,
			});
		},
	};
}

export async function syncSavedRoutesOnce({
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
}) {
	try {
		await state.runLocalMergeOnce(userId);

		if (getCurrentRequestId() !== requestId) {
			return;
		}

		let cursor: string | null = null;
		const remoteRoutes: RemoteSavedRoutePayload[] = [];

		do {
			const page: SavedRoutesRemotePage = await client.query(
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

		await state.applyRemoteRoutes(userId, remoteRoutes);
	} catch (error) {
		if (getCurrentRequestId() !== requestId) {
			return;
		}

		state.syncError =
			error instanceof Error
				? `Could not load synced routes: ${error.message}`
				: "Could not load synced routes.";
	}
}
