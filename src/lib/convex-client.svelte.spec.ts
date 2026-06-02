import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publicEnv = vi.hoisted(() => ({
	PUBLIC_CONVEX_URL: "",
}));
const useConvexClientMock = vi.hoisted(() => vi.fn());

vi.mock("$env/dynamic/public", () => ({
	env: publicEnv,
}));

vi.mock("convex-svelte", () => ({
	useConvexClient: useConvexClientMock,
}));

import { getOptionalConvexClient } from "$lib/convex-client.svelte";

describe("optional Convex client", () => {
	beforeEach(() => {
		publicEnv.PUBLIC_CONVEX_URL = "";
		useConvexClientMock.mockReset();
	});

	it("returns null when Convex is not configured", () => {
		expect(Effect.runSync(getOptionalConvexClient())).toBeNull();
		expect(useConvexClientMock).not.toHaveBeenCalled();
	});

	it("returns null when the client hook is unavailable", () => {
		publicEnv.PUBLIC_CONVEX_URL = "https://convex.test";
		useConvexClientMock.mockImplementation(() => {
			throw new Error("missing provider");
		});

		expect(Effect.runSync(getOptionalConvexClient())).toBeNull();
	});

	it("returns the client when Convex is configured and available", () => {
		const client = { query: vi.fn(), mutation: vi.fn() };
		publicEnv.PUBLIC_CONVEX_URL = "https://convex.test";
		useConvexClientMock.mockReturnValue(client);

		expect(Effect.runSync(getOptionalConvexClient())).toBe(client);
	});
});
