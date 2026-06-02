import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	assertRemoteRouteJsonSizeEffect,
	MAX_REMOTE_ROUTE_JSON_BYTES,
	RemoteRouteJsonSizeError,
} from "./saved-route-size";

describe("remote saved route size", () => {
	it("fails oversized payloads with a tagged size error", () => {
		const result = Effect.runSync(
			Effect.result(
				assertRemoteRouteJsonSizeEffect(
					"x".repeat(MAX_REMOTE_ROUTE_JSON_BYTES),
					"saved",
				),
			),
		);

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isSuccess(result)) {
			throw new Error("Expected oversized route JSON to fail.");
		}

		expect(result.failure).toBeInstanceOf(RemoteRouteJsonSizeError);
		expect(result.failure.context).toBe("saved");
		expect(result.failure.message).toBe(
			"Saved route is too large to sync. Maximum route payload size is 512 KiB.",
		);
	});
});
