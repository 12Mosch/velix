import { getConvexSize, getDocumentSize } from "convex/values";
import { Data, Effect } from "effect";

export const MAX_REMOTE_ROUTE_JSON_BYTES = 512 * 1024;

export type SavedRouteStorageRow = {
	userId: string;
	routeId: string;
	createdAtMs: number;
	updatedAtMs: number;
	routeJson: string;
};

export function formatRoutePayloadSizeLimit(): string {
	return "512 KiB";
}

export function getRouteJsonConvexSize(routeJson: string): number {
	return getConvexSize(routeJson);
}

export function isRouteJsonWithinRemoteSizeLimit(routeJson: string): boolean {
	return getRouteJsonConvexSize(routeJson) <= MAX_REMOTE_ROUTE_JSON_BYTES;
}

export function getSavedRouteRowConvexDocumentSize(
	row: SavedRouteStorageRow,
): number {
	return getDocumentSize(row);
}

export class RemoteRouteJsonSizeError extends Data.TaggedError(
	"RemoteRouteJsonSizeError",
)<{
	readonly context: "saved" | "shared";
	readonly message: string;
}> {}

export const assertRemoteRouteJsonSizeEffect = Effect.fn(
	"assertRemoteRouteJsonSizeEffect",
)(function* (routeJson: string, context: "saved" | "shared") {
	if (isRouteJsonWithinRemoteSizeLimit(routeJson)) {
		return;
	}

	const routeKind = context === "saved" ? "Saved" : "Shared";
	const action = context === "saved" ? "sync" : "share";

	return yield* new RemoteRouteJsonSizeError({
		context,
		message: `${routeKind} route is too large to ${action}. Maximum route payload size is ${formatRoutePayloadSizeLimit()}.`,
	});
});
