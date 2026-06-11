import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAPLIBRE_SOURCE } from "./bundle-budget-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = resolve(root, ".svelte-kit/output/client");
const manifestPath = resolve(clientRoot, ".vite/manifest.json");

const budgets = {
	maplibreRawKb: 1100,
	maplibreGzipKb: 300,
	otherJsRawKb: 500,
};

const bytesPerKb = 1024;

const formatKb = (bytes) => `${(bytes / bytesPerKb).toFixed(2)} kB`;
const getErrorMessage = (error) =>
	error instanceof Error ? error.message : String(error);

const readClientFile = async (file) => {
	const filePath = resolve(clientRoot, file);

	if (!filePath.startsWith(`${clientRoot}/`)) {
		throw new Error(`Manifest file path escapes client output: ${file}`);
	}

	try {
		return await readFile(filePath);
	} catch (error) {
		throw new Error(
			`Failed to read client bundle file from manifest entry ${file} at ${filePath}: ${getErrorMessage(error)}`,
		);
	}
};

const readManifest = async () => {
	try {
		return JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		console.error(
			`Failed to read or parse bundle manifest at ${manifestPath}: ${getErrorMessage(error)}`,
		);
		process.exit(1);
	}
};

const main = async () => {
	const manifest = await readManifest();
	const failures = [];

	const maplibreChunk = manifest[MAPLIBRE_SOURCE];

	if (!maplibreChunk?.file) {
		failures.push(
			`Could not find MapLibre chunk in ${manifestPath} using source key ${MAPLIBRE_SOURCE}.`,
		);
	} else {
		const maplibreBytes = await readClientFile(maplibreChunk.file);
		const rawBytes = maplibreBytes.byteLength;
		const gzipBytes = gzipSync(maplibreBytes).byteLength;
		const rawLimit = budgets.maplibreRawKb * bytesPerKb;
		const gzipLimit = budgets.maplibreGzipKb * bytesPerKb;

		console.log(
			`MapLibre chunk ${maplibreChunk.file}: ${formatKb(rawBytes)} raw, ${formatKb(gzipBytes)} gzip`,
		);

		if (rawBytes > rawLimit) {
			failures.push(
				`MapLibre chunk is ${formatKb(rawBytes)} raw, exceeding the ${budgets.maplibreRawKb} kB budget.`,
			);
		}

		if (gzipBytes > gzipLimit) {
			failures.push(
				`MapLibre chunk is ${formatKb(gzipBytes)} gzip, exceeding the ${budgets.maplibreGzipKb} kB budget.`,
			);
		}
	}

	const otherJsRawLimit = budgets.otherJsRawKb * bytesPerKb;
	const jsChunks = Object.values(manifest)
		.filter((chunk) => chunk?.file?.endsWith(".js"))
		.filter((chunk) => chunk.file !== maplibreChunk?.file)
		.sort((left, right) => left.file.localeCompare(right.file));

	let largestOtherJsChunk = null;

	for (const chunk of jsChunks) {
		const chunkBytes = await readClientFile(chunk.file);
		const rawBytes = chunkBytes.byteLength;

		if (!largestOtherJsChunk || rawBytes > largestOtherJsChunk.rawBytes) {
			largestOtherJsChunk = { file: chunk.file, rawBytes };
		}

		if (rawBytes > otherJsRawLimit) {
			failures.push(
				`${chunk.file} is ${formatKb(rawBytes)} raw, exceeding the ${budgets.otherJsRawKb} kB non-MapLibre JS budget.`,
			);
		}
	}

	if (largestOtherJsChunk) {
		console.log(
			`Largest non-MapLibre JS chunk ${largestOtherJsChunk.file}: ${formatKb(largestOtherJsChunk.rawBytes)} raw`,
		);
	}

	if (failures.length > 0) {
		console.error("\nBundle budget check failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		process.exit(1);
	}

	console.log("Bundle budget check passed.");
};

main().catch((error) => {
	console.error(getErrorMessage(error));
	process.exit(1);
});
