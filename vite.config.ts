import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { sveltekit } from "@sveltejs/kit/vite";
import {
	MAPLIBRE_CHUNK_NAME,
	MAPLIBRE_SOURCE,
} from "./scripts/bundle-budget-config.mjs";

const getErrorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		{
			name: "maplibre-manifest-entry",
			apply: "build",
			enforce: "post",
			async writeBundle(outputOptions, bundle) {
				const maplibreChunk = Object.values(bundle).find(
					(output) =>
						output.type === "chunk" && output.name === MAPLIBRE_CHUNK_NAME,
				);

				if (!outputOptions.dir || !maplibreChunk) {
					return;
				}

				const manifestPath = resolve(outputOptions.dir, ".vite/manifest.json");
				let manifest: Record<string, Record<string, unknown>>;

				try {
					manifest = JSON.parse(await readFile(manifestPath, "utf8"));
				} catch (error) {
					throw new Error(
						`Failed to read or parse Vite manifest at ${manifestPath}: ${getErrorMessage(error)}`,
					);
				}

				const manifestKey = `_${maplibreChunk.fileName.split("/").at(-1)}`;
				const existingChunkEntry = manifest[manifestKey];

				manifest[MAPLIBRE_SOURCE] = {
					...existingChunkEntry,
					file: maplibreChunk.fileName,
					name: MAPLIBRE_CHUNK_NAME,
					src: MAPLIBRE_SOURCE,
					isDynamicEntry: true,
				};

				try {
					await writeFile(
						manifestPath,
						`${JSON.stringify(manifest, null, 2)}\n`,
					);
				} catch (error) {
					throw new Error(
						`Failed to write Vite manifest at ${manifestPath}: ${getErrorMessage(error)}`,
					);
				}
			},
		},
	],
	build: {
		chunkSizeWarningLimit: 1100,
		rolldownOptions: {
			output: {
				manualChunks(id) {
					if (id.replaceAll("\\", "/").endsWith(MAPLIBRE_SOURCE)) {
						return MAPLIBRE_CHUNK_NAME;
					}

					return null;
				},
			},
		},
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: "./vite.config.ts",
				test: {
					name: "client",
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: "chromium", headless: true }],
					},
					fileParallelism: false,
					include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
					exclude: ["src/lib/server/**"],
				},
			},

			{
				extends: "./vite.config.ts",
				test: {
					name: "server",
					environment: "node",
					include: ["src/**/*.{test,spec}.{js,ts}"],
					exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"],
				},
			},
		],
	},
});
