import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";

import { api } from "../../convex/_generated/api";
import type { SavedRoutesRemoteAdapter } from "$lib/saved-routes.svelte";
import type { RemoteSavedRoutePayload } from "$lib/saved-routes-core";

type SavedRoutesRemoteSnapshot = FunctionReturnType<
	typeof api.savedRoutes.listForCurrentUser
>;

export type SavedRoutesSyncState = {
	applyRemoteRoutes: (
		userId: string,
		routes: SavedRoutesRemoteSnapshot,
	) => void;
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

		const remoteRoutes = await client.query(
			api.savedRoutes.listForCurrentUser,
			{},
		);

		if (getCurrentRequestId() !== requestId) {
			return;
		}

		state.applyRemoteRoutes(userId, remoteRoutes);
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
