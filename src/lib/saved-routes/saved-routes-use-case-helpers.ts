import { Effect } from "effect";

import type { SavedRoute, SavedRouteVersion } from "$lib/saved-routes-core";
import { serializeSavedRouteForRemote } from "$lib/saved-routes-core";

export class SavedRoutesOperationError extends Error {
	readonly _tag = "SavedRoutesOperationError";

	constructor(
		cause: unknown,
		fallbackMessage = "Saved routes operation failed.",
	) {
		super(cause instanceof Error ? cause.message : fallbackMessage, { cause });
	}
}

export function toSavedRoutesOperationError(
	cause: unknown,
	fallbackMessage = "Saved routes operation failed.",
) {
	return new SavedRoutesOperationError(cause, fallbackMessage);
}

export function sortSavedRouteVersionsNewestFirst(
	versions: SavedRouteVersion[],
): SavedRouteVersion[] {
	return versions.toSorted((left, right) => {
		const capturedAtDelta =
			Date.parse(right.capturedAt) - Date.parse(left.capturedAt);
		if (capturedAtDelta !== 0) {
			return capturedAtDelta;
		}

		return right.versionId.localeCompare(left.versionId);
	});
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
	return (
		value !== null &&
		(typeof value === "object" || typeof value === "function") &&
		typeof (value as PromiseLike<T>).then === "function"
	);
}

export function fromRemoteAdapter<T>(
	value: Effect.Effect<T, unknown> | PromiseLike<T> | T,
): Effect.Effect<T, unknown> {
	if (Effect.isEffect(value)) {
		return value;
	}

	if (isPromiseLike<T>(value)) {
		return Effect.tryPromise({
			try: () => value,
			catch: (cause) =>
				toSavedRoutesOperationError(cause, "Remote adapter promise rejected."),
		});
	}

	return Effect.succeed(value as T);
}

export function haveRoutePayloadsChanged(left: SavedRoute, right: SavedRoute) {
	return (
		serializeSavedRouteForRemote(left).routeJson !==
		serializeSavedRouteForRemote(right).routeJson
	);
}
