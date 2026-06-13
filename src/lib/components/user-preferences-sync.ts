import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";

import { api } from "../../convex/_generated/api";
import type { BasemapId } from "$lib/map-style-settings.svelte";
import type { ThemeMode } from "$lib/theme-settings.svelte";
import type { DistanceUnit } from "$lib/unit-settings.svelte";
import { Effect } from "effect";

export type UserPreferencesRemoteSnapshot = FunctionReturnType<
	typeof api.userPreferences.getForCurrentUser
>;

export type UserPreferencesPatch = {
	themeMode?: ThemeMode;
	mapStyle?: BasemapId;
	distanceUnit?: DistanceUnit;
};

export type UserPreferencesConvexClient = {
	query<Query extends FunctionReference<"query">>(
		queryRef: Query,
		args: FunctionArgs<Query>,
	): Promise<FunctionReturnType<Query>>;
	mutation<Mutation extends FunctionReference<"mutation">>(
		mutationRef: Mutation,
		args: FunctionArgs<Mutation>,
	): Promise<FunctionReturnType<Mutation>>;
};

export type UserPreferencesRemoteAdapter = {
	save: (preferences: UserPreferencesPatch) => Effect.Effect<void, Error>;
};

export type UserPreferencesSyncState = {
	applyRemotePreferences: (
		userId: string,
		preferences: NonNullable<UserPreferencesRemoteSnapshot>,
	) => Effect.Effect<UserPreferencesPatch, Error>;
	readLocalPreferences: () => Effect.Effect<UserPreferencesPatch, Error>;
	syncError: string | null;
};

class UserPreferencesSyncError extends Error {
	readonly _tag = "UserPreferencesSyncError";

	constructor(cause: unknown, fallbackMessage: string) {
		super(cause instanceof Error ? cause.message : fallbackMessage, { cause });
	}
}

function toSyncError(cause: unknown, fallbackMessage: string) {
	return new UserPreferencesSyncError(cause, fallbackMessage);
}

function convexMutationEffect<Mutation extends FunctionReference<"mutation">>(
	client: UserPreferencesConvexClient,
	mutationRef: Mutation,
	args: FunctionArgs<Mutation>,
): Effect.Effect<FunctionReturnType<Mutation>, Error> {
	return Effect.tryPromise({
		try: () => client.mutation(mutationRef, args),
		catch: (cause) => toSyncError(cause, "Convex mutation failed."),
	});
}

export function createUserPreferencesRemoteAdapter(
	client: UserPreferencesConvexClient,
): UserPreferencesRemoteAdapter {
	return {
		save: (preferences) =>
			convexMutationEffect(client, api.userPreferences.upsertForCurrentUser, {
				preferences,
			}).pipe(Effect.asVoid),
	};
}

export const syncUserPreferencesSnapshot = Effect.fn(
	"syncUserPreferencesSnapshot",
)(function* ({
	adapter,
	getCurrentRequestId,
	remotePreferences,
	requestId,
	state,
	userId,
}: {
	adapter: UserPreferencesRemoteAdapter;
	getCurrentRequestId: () => number;
	remotePreferences: UserPreferencesRemoteSnapshot;
	requestId: number;
	state: UserPreferencesSyncState;
	userId: string;
}): Effect.fn.Return<UserPreferencesPatch | null, never> {
	return yield* Effect.gen(function* () {
		const isStaleRequest = () => getCurrentRequestId() !== requestId;

		if (remotePreferences === null) {
			if (isStaleRequest()) {
				return null;
			}

			const localPreferences = yield* state.readLocalPreferences();

			if (isStaleRequest()) {
				return null;
			}

			yield* adapter.save(localPreferences);
			return localPreferences;
		}

		if (isStaleRequest()) {
			return null;
		}

		const appliedPreferences = yield* state.applyRemotePreferences(
			userId,
			remotePreferences,
		);

		if (isStaleRequest()) {
			return null;
		}

		return appliedPreferences;
	}).pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				if (getCurrentRequestId() !== requestId) {
					return null;
				}

				state.syncError = `Could not sync account preferences: ${error.message}`;
				return null;
			}),
		),
	);
});

export function serializeUserPreferencesPatch(
	preferences: UserPreferencesPatch,
): string {
	return JSON.stringify({
		themeMode: preferences.themeMode,
		mapStyle: preferences.mapStyle,
		distanceUnit: preferences.distanceUnit,
	});
}

export function diffUserPreferencesPatch(
	previousPreferences: UserPreferencesPatch,
	nextPreferences: UserPreferencesPatch,
): UserPreferencesPatch {
	const patch: UserPreferencesPatch = {};

	if (previousPreferences.themeMode !== nextPreferences.themeMode) {
		patch.themeMode = nextPreferences.themeMode;
	}

	if (previousPreferences.mapStyle !== nextPreferences.mapStyle) {
		patch.mapStyle = nextPreferences.mapStyle;
	}

	if (previousPreferences.distanceUnit !== nextPreferences.distanceUnit) {
		patch.distanceUnit = nextPreferences.distanceUnit;
	}

	return patch;
}

export function hasUserPreferencesPatch(preferences: UserPreferencesPatch) {
	return (
		preferences.themeMode !== undefined ||
		preferences.mapStyle !== undefined ||
		preferences.distanceUnit !== undefined
	);
}
