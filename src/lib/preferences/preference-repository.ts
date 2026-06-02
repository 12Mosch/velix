import type { BrowserStorage } from "$lib/storage/browser-storage";
import { Data, Effect } from "effect";

export type PreferenceRepository<TValue extends string> = {
	read: () => Effect.Effect<TValue | null, PreferenceRepositoryError>;
	write: (value: TValue) => Effect.Effect<void, PreferenceRepositoryError>;
	clear: () => Effect.Effect<void, PreferenceRepositoryError>;
};

type PreferenceRepositoryOperation = "read" | "write" | "clear";

export class PreferenceRepositoryError extends Data.TaggedError(
	"PreferenceRepositoryError",
)<{
	readonly operation: PreferenceRepositoryOperation;
	readonly storageKey: string;
	readonly cause: unknown;
}> {}

function repositoryError(
	operation: PreferenceRepositoryOperation,
	storageKey: string,
	cause: unknown,
) {
	return new PreferenceRepositoryError({ operation, storageKey, cause });
}

export function createPreferenceRepository<TValue extends string>(
	storage: BrowserStorage | null,
	storageKey: string,
): PreferenceRepository<TValue> {
	return {
		read: Effect.fn("PreferenceRepository.read")(function* () {
			return yield* Effect.try({
				try: () => (storage?.getItem(storageKey) as TValue | null) ?? null,
				catch: (cause) => repositoryError("read", storageKey, cause),
			});
		}),
		write: Effect.fn("PreferenceRepository.write")(function* (value: TValue) {
			yield* Effect.try({
				try: () => storage?.setItem(storageKey, value),
				catch: (cause) => repositoryError("write", storageKey, cause),
			});
		}),
		clear: Effect.fn("PreferenceRepository.clear")(function* () {
			yield* Effect.try({
				try: () => storage?.removeItem(storageKey),
				catch: (cause) => repositoryError("clear", storageKey, cause),
			});
		}),
	};
}
