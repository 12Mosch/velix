import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";

import { api } from "../../convex/_generated/api";
import type { BasemapId } from "$lib/map-style-settings.svelte";
import type { ThemeMode } from "$lib/theme-settings.svelte";
import type { DistanceUnit } from "$lib/unit-settings.svelte";

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
	save: (preferences: UserPreferencesPatch) => Promise<void>;
};

export type UserPreferencesSyncState = {
	applyRemotePreferences: (
		userId: string,
		preferences: NonNullable<UserPreferencesRemoteSnapshot>,
	) => UserPreferencesPatch;
	readLocalPreferences: () => UserPreferencesPatch;
	syncError: string | null;
};

export function createUserPreferencesRemoteAdapter(
	client: UserPreferencesConvexClient,
): UserPreferencesRemoteAdapter {
	return {
		save: async (preferences) => {
			await client.mutation(api.userPreferences.upsertForCurrentUser, {
				preferences,
			});
		},
	};
}

export async function syncUserPreferencesSnapshot({
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
}) {
	try {
		if (remotePreferences === null) {
			const localPreferences = state.readLocalPreferences();
			await adapter.save(localPreferences);
			return localPreferences;
		}

		const appliedPreferences = state.applyRemotePreferences(
			userId,
			remotePreferences,
		);

		if (getCurrentRequestId() !== requestId) {
			return null;
		}

		return appliedPreferences;
	} catch (error) {
		if (getCurrentRequestId() !== requestId) {
			return null;
		}

		state.syncError =
			error instanceof Error
				? `Could not sync account preferences: ${error.message}`
				: "Could not sync account preferences.";
		return null;
	}
}

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
