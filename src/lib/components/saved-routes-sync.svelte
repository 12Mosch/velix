<script lang="ts">
	import { Effect } from "effect";
	import { useConvexClient, useQuery } from "convex-svelte";
	import { userPrefersMode } from "mode-watcher";
	import { untrack } from "svelte";
	import { useClerkContext } from "svelte-clerk/client";

	import { api } from "../../convex/_generated/api";
	import {
		applyRemoteMapStylePreference,
		initMapStylePreference,
		mapStylePreference,
		type BasemapId,
	} from "$lib/map-style-settings.svelte";
	import { savedRoutesState } from "$lib/saved-routes.svelte";
	import {
		applyRemoteThemeModePreference,
		getThemeModePreference,
	} from "$lib/theme-settings.svelte";
	import {
		applyRemoteDistanceUnitPreference,
		initUnitPreference,
		unitPreference,
		type DistanceUnit,
	} from "$lib/unit-settings.svelte";
	import {
		createSavedRoutesRemoteAdapter,
		syncSavedRoutesOnce,
	} from "./saved-routes-sync";
	import {
		createUserPreferencesRemoteAdapter,
		diffUserPreferencesPatch,
		hasUserPreferencesPatch,
		serializeUserPreferencesPatch,
		syncUserPreferencesSnapshot,
		type UserPreferencesPatch,
		type UserPreferencesRemoteSnapshot,
		type UserPreferencesSyncState,
	} from "./user-preferences-sync";

	const ctx = useClerkContext();
	const client = useConvexClient();

	let convexAuthenticated = $state(false);
	let convexAuthUnavailable = false;
	let convexAuthError = $state<string | null>(null);
	let syncRequestId = 0;
	let preferencesRequestId = 0;
	let preferencesHydratedUserId = $state<string | null>(null);
	let lastPersistedPreferences = $state<UserPreferencesPatch | null>(null);
	let lastPersistedPreferencesSignature = $state<string | null>(null);
	let localPreferencesInitialized = false;

	const accountPreferences = useQuery(
		api.userPreferences.getForCurrentUser,
		() =>
			ctx.isLoaded && ctx.auth.userId && convexAuthenticated ? {} : "skip",
	);
	const clerkUserId = $derived(
		ctx.isLoaded ? (ctx.auth.userId ?? null) : undefined,
	);

	function initLocalPreferences() {
		return Effect.gen(function* () {
			if (localPreferencesInitialized) {
				return;
			}

			yield* initMapStylePreference();
			yield* initUnitPreference();
			localPreferencesInitialized = true;
		});
	}

	function readLocalPreferences() {
		return Effect.gen(function* () {
			yield* initLocalPreferences();
			return {
				themeMode: yield* getThemeModePreference(),
				mapStyle: mapStylePreference.selectedBasemapId ?? undefined,
				distanceUnit: unitPreference.selectedDistanceUnit,
			};
		});
	}

	function applyRemotePreferences(
		_userId: string,
		preferences: NonNullable<UserPreferencesRemoteSnapshot>,
	) {
		return Effect.gen(function* () {
			yield* initLocalPreferences();

			if (preferences.themeMode) {
				yield* applyRemoteThemeModePreference(preferences.themeMode);
			}

			if (preferences.mapStyle) {
				yield* applyRemoteMapStylePreference(preferences.mapStyle as BasemapId);
			}

			if (preferences.distanceUnit) {
				yield* applyRemoteDistanceUnitPreference(
					preferences.distanceUnit as DistanceUnit,
				);
			}

			return yield* readLocalPreferences();
		});
	}

	const userPreferencesState: UserPreferencesSyncState = {
		applyRemotePreferences,
		readLocalPreferences,
		get syncError() {
			return savedRoutesState.syncError;
		},
		set syncError(value: string | null) {
			savedRoutesState.syncError = value;
		},
	};

	function rememberPersistedPreferences(preferences: UserPreferencesPatch | null) {
		lastPersistedPreferences = preferences ? { ...preferences } : null;
		lastPersistedPreferencesSignature = preferences
			? serializeUserPreferencesPatch(preferences)
			: null;
	}

	$effect(() => {
		untrack(() => {
			Effect.runSync(initLocalPreferences());
		});
	});

	$effect(() => {
		const userId = clerkUserId;

		untrack(() => {
			void savedRoutesState.setAuthUser(userId);
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
			void Effect.runPromise(
				syncSavedRoutesOnce({
					client,
					getCurrentRequestId: () => syncRequestId,
					requestId,
					state: savedRoutesState,
					userId,
				}),
			);
		});

		return () => {
			syncRequestId += 1;
			untrack(() => {
				savedRoutesState.setRemoteAdapter(null);
			});
		};
	});

	$effect(() => {
		const userId = ctx.auth.userId;
		const authError = convexAuthError;
		const remotePreferences = accountPreferences.data;
		const remoteError = accountPreferences.error;
		const remoteLoading = accountPreferences.isLoading;

		if (!ctx.isLoaded || !userId || !convexAuthenticated || authError) {
			preferencesRequestId += 1;
			preferencesHydratedUserId = null;
			rememberPersistedPreferences(null);
			return;
		}

		if (remoteError) {
			preferencesRequestId += 1;
			preferencesHydratedUserId = null;
			rememberPersistedPreferences(null);
			savedRoutesState.syncError = `Could not load account preferences: ${remoteError.message}`;
			return;
		}

		if (remoteLoading || remotePreferences === undefined) {
			return;
		}

		const adapter = createUserPreferencesRemoteAdapter(client);
		const requestId = ++preferencesRequestId;

		untrack(() => {
			void Effect.runPromise(
				syncUserPreferencesSnapshot({
					adapter,
					getCurrentRequestId: () => preferencesRequestId,
					remotePreferences,
					requestId,
					state: userPreferencesState,
					userId,
				}),
			).then((persistedPreferences) => {
				if (preferencesRequestId !== requestId || !persistedPreferences) {
					return;
				}

				preferencesHydratedUserId = userId;
				rememberPersistedPreferences(persistedPreferences);
			});
		});

		return () => {
			preferencesRequestId += 1;
		};
	});

	$effect(() => {
		const userId = ctx.auth.userId;
		const themeMode = userPrefersMode.current;
		const mapStyle = mapStylePreference.selectedBasemapId;
		const distanceUnit = unitPreference.selectedDistanceUnit;
		const persistedSignature = lastPersistedPreferencesSignature;

		if (
			!ctx.isLoaded ||
			!userId ||
			!convexAuthenticated ||
			preferencesHydratedUserId !== userId ||
			!lastPersistedPreferences
		) {
			return;
		}

		const nextPreferences: UserPreferencesPatch = {
			themeMode,
			mapStyle: mapStyle ?? undefined,
			distanceUnit,
		};
		const nextSignature = serializeUserPreferencesPatch(nextPreferences);

		if (nextSignature === persistedSignature) {
			return;
		}

		const patch = diffUserPreferencesPatch(
			lastPersistedPreferences,
			nextPreferences,
		);

		if (!hasUserPreferencesPatch(patch)) {
			rememberPersistedPreferences(nextPreferences);
			return;
		}

		const adapter = createUserPreferencesRemoteAdapter(client);
		const requestId = preferencesRequestId;
		rememberPersistedPreferences(nextPreferences);

		void Effect.runPromise(
			adapter.save(patch).pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						if (preferencesRequestId !== requestId) {
							return;
						}

						savedRoutesState.syncError = `Could not save account preferences: ${error.message}`;
					}),
				),
			),
		);
	});

	$effect(() => {
		const authError = convexAuthError;

		if (!authError) {
			return;
		}

		untrack(() => {
			void savedRoutesState.setRemoteSyncUnavailable(authError);
		});
	});
</script>
