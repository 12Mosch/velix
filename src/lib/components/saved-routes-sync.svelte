<script lang="ts">
	import { useConvexClient, useQuery } from "convex-svelte";
	import { untrack } from "svelte";
	import { useClerkContext } from "svelte-clerk/client";

	import { api } from "../../convex/_generated/api";
	import {
		savedRoutesState,
		type SavedRoutesRemoteAdapter,
	} from "$lib/saved-routes.svelte";
	import type { SavedRoute } from "$lib/saved-routes-core";

	const ctx = useClerkContext();
	const client = useConvexClient();

	let convexAuthenticated = $state(false);

	const clerkUserId = $derived(
		ctx.isLoaded ? (ctx.auth.userId ?? null) : undefined,
	);
	const canQuerySavedRoutes = $derived(
		ctx.isLoaded && !!ctx.auth.userId && convexAuthenticated,
	);
	const savedRoutesQuery = useQuery(
		api.savedRoutes.listForCurrentUser,
		() => (canQuerySavedRoutes ? {} : "skip"),
	);

	$effect(() => {
		const userId = clerkUserId;

		untrack(() => {
			savedRoutesState.setAuthUser(userId);
		});
	});

	$effect(() => {
		if (!ctx.isLoaded || !ctx.auth.userId || !ctx.session) {
			convexAuthenticated = false;
			client.setAuth(async () => null, (isAuthenticated) => {
				convexAuthenticated = isAuthenticated;
			});
			return;
		}

		const session = ctx.session;
		convexAuthenticated = false;
		client.setAuth(
			() => session.getToken({ template: "convex" }),
			(isAuthenticated) => {
				convexAuthenticated = isAuthenticated;
			},
		);
	});

	$effect(() => {
		const userId = ctx.auth.userId;
		if (!ctx.isLoaded || !userId || !convexAuthenticated) {
			untrack(() => {
				savedRoutesState.setRemoteAdapter(null);
			});
			return;
		}

		const adapter: SavedRoutesRemoteAdapter = {
			save: async (savedRoute: SavedRoute) => {
				await client.mutation(api.savedRoutes.upsert, { savedRoute });
			},
			delete: async (routeId: string) => {
				await client.mutation(api.savedRoutes.remove, { routeId });
			},
			mergeLocalRoutes: async (savedRoutes: SavedRoute[]) => {
				return (await client.mutation(api.savedRoutes.mergeLocalRoutes, {
					savedRoutes,
				})) as {
					inserted: number;
					skipped: number;
					invalid: number;
					duplicate: number;
				};
			},
		};

		untrack(() => {
			savedRoutesState.setRemoteAdapter(adapter);
			void savedRoutesState.runLocalMergeOnce(userId);
		});

		return () => {
			untrack(() => {
				savedRoutesState.setRemoteAdapter(null);
			});
		};
	});

	$effect(() => {
		const userId = ctx.auth.userId;

		if (userId && Array.isArray(savedRoutesQuery.data)) {
			const remoteRoutes = savedRoutesQuery.data;

			untrack(() => {
				savedRoutesState.applyRemoteRoutes(userId, remoteRoutes);
			});
		}
	});

	$effect(() => {
		const queryError = savedRoutesQuery.error;

		if (queryError) {
			untrack(() => {
				savedRoutesState.syncError = `Could not load synced routes: ${queryError.message}`;
			});
			return;
		}

		untrack(() => {
			savedRoutesState.syncError = null;
		});
	});
</script>
