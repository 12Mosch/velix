import { env } from "$env/dynamic/public";
import { useConvexClient } from "convex-svelte";

export function getOptionalConvexClient() {
	if (!env.PUBLIC_CONVEX_URL) {
		return null;
	}

	try {
		return useConvexClient();
	} catch {
		return null;
	}
}
