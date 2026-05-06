<script lang="ts">
	import { useConvexClient } from "convex-svelte";
	import { untrack } from "svelte";
	import { useClerkContext } from "svelte-clerk/client";

	import { savedRoutesState } from "$lib/saved-routes.svelte";
	import {
		createSavedRoutesRemoteAdapter,
		syncSavedRoutesOnce,
	} from "./saved-routes-sync";

	const ctx = useClerkContext();
	const client = useConvexClient();

	let convexAuthenticated = $state(false);
	let convexAuthUnavailable = false;
	let convexAuthError = $state<string | null>(null);
	let syncRequestId = 0;

	const clerkUserId = $derived(
		ctx.isLoaded ? (ctx.auth.userId ?? null) : undefined,
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
			convexAuthUnavailable = false;
			convexAuthError = null;
			client.setAuth(async () => null, (isAuthenticated) => {
				convexAuthenticated = isAuthenticated;
			});
			return;
		}

		const session = ctx.session;
		const sessionClaims = ctx.auth.sessionClaims;
		convexAuthenticated = false;
		convexAuthUnavailable = false;
		convexAuthError = null;
		client.setAuth(
			async ({ forceRefreshToken }) => {
				if (convexAuthUnavailable) {
					return null;
				}

				try {
					const token =
						sessionClaims?.aud === "convex"
							? await session.getToken({ skipCache: forceRefreshToken })
							: await session.getToken({
									template: "convex",
									skipCache: forceRefreshToken,
								});
					if (!token) {
						convexAuthenticated = false;
						convexAuthUnavailable = true;
						convexAuthError =
							"Could not authenticate synced routes: Clerk did not return a Convex token. Check that the Convex JWT template is active.";
						return null;
					}

					return token;
				} catch (error) {
					convexAuthenticated = false;
					convexAuthUnavailable = true;
					convexAuthError = `Could not authenticate synced routes: ${error instanceof Error ? error.message : String(error)}`;
					return null;
				}
			},
			(isAuthenticated) => {
				convexAuthenticated = isAuthenticated;
			},
		);
	});

	$effect(() => {
		const userId = ctx.auth.userId;
		const authError = convexAuthError;

		if (!ctx.isLoaded || !userId || !convexAuthenticated || authError) {
			syncRequestId += 1;
			untrack(() => {
				savedRoutesState.setRemoteAdapter(null);
				if (!authError) {
					savedRoutesState.syncError = null;
				}
			});
			return;
		}

		const adapter = createSavedRoutesRemoteAdapter(client);
		const requestId = ++syncRequestId;

		untrack(() => {
			savedRoutesState.setRemoteAdapter(adapter);
			savedRoutesState.syncError = null;
			void syncSavedRoutesOnce({
				client,
				getCurrentRequestId: () => syncRequestId,
				requestId,
				state: savedRoutesState,
				userId,
			});
		});

		return () => {
			syncRequestId += 1;
			untrack(() => {
				savedRoutesState.setRemoteAdapter(null);
			});
		};
	});

	$effect(() => {
		const authError = convexAuthError;

		if (!authError) {
			return;
		}

		untrack(() => {
			savedRoutesState.setRemoteSyncUnavailable(authError);
		});
	});
</script>
