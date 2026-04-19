import { env } from "$env/dynamic/public";

export type BasemapId =
	| "stadia-alidade-smooth"
	| "stadia-alidade-smooth-dark"
	| "stadia-stamen-terrain"
	| "maptiler-satellite-hybrid"
	| "maptiler-outdoor";

export type BasemapProvider = "stadia" | "maptiler";

export type BasemapDefinition = {
	id: BasemapId;
	label: string;
	provider: BasemapProvider;
	requiredEnvVar: "PUBLIC_STADIA_MAPS_API_KEY" | "PUBLIC_MAPTILER_API_KEY";
	description: string;
	attributionHtml: string;
	buildStyleUrl: (apiKey: string) => string;
};

const attributionLinkClass =
	'class="underline decoration-white/25 underline-offset-2 transition-colors hover:text-white/78"';

const stadiaAttribution =
	`&copy; <a ${attributionLinkClass} href="https://stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> &copy; <a ${attributionLinkClass} href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a ${attributionLinkClass} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>`;

const stamenTerrainAttribution =
	`&copy; <a ${attributionLinkClass} href="https://stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> &copy; <a ${attributionLinkClass} href="https://stamen.com/" target="_blank" rel="noreferrer">Stamen Design</a> &copy; <a ${attributionLinkClass} href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> &copy; <a ${attributionLinkClass} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>`;

const mapTilerAttribution =
	`&copy; <a ${attributionLinkClass} href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">MapTiler</a> &copy; <a ${attributionLinkClass} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>`;

export const BASEMAPS: BasemapDefinition[] = [
	{
		id: "stadia-alidade-smooth",
		label: "Stadia Alidade Smooth",
		provider: "stadia",
		requiredEnvVar: "PUBLIC_STADIA_MAPS_API_KEY",
		description: "Muted light basemap for route planning overlays.",
		attributionHtml: stadiaAttribution,
		buildStyleUrl: (apiKey) =>
			`https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${apiKey}`,
	},
	{
		id: "stadia-alidade-smooth-dark",
		label: "Stadia Alidade Smooth Dark",
		provider: "stadia",
		requiredEnvVar: "PUBLIC_STADIA_MAPS_API_KEY",
		description: "Low-glare dark style for dense overlay work.",
		attributionHtml: stadiaAttribution,
		buildStyleUrl: (apiKey) =>
			`https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${apiKey}`,
	},
	{
		id: "stadia-stamen-terrain",
		label: "Stadia Stamen Terrain",
		provider: "stadia",
		requiredEnvVar: "PUBLIC_STADIA_MAPS_API_KEY",
		description: "Terrain-forward cartography with topographic cues.",
		attributionHtml: stamenTerrainAttribution,
		buildStyleUrl: (apiKey) =>
			`https://tiles.stadiamaps.com/styles/stamen_terrain.json?api_key=${apiKey}`,
	},
	{
		id: "maptiler-satellite-hybrid",
		label: "MapTiler Satellite Hybrid",
		provider: "maptiler",
		requiredEnvVar: "PUBLIC_MAPTILER_API_KEY",
		description: "Satellite imagery with roads and label overlays.",
		attributionHtml: mapTilerAttribution,
		buildStyleUrl: (apiKey) =>
			`https://api.maptiler.com/maps/hybrid/style.json?key=${apiKey}`,
	},
	{
		id: "maptiler-outdoor",
		label: "MapTiler Outdoor",
		provider: "maptiler",
		requiredEnvVar: "PUBLIC_MAPTILER_API_KEY",
		description: "Outdoor-focused vector basemap for terrain and routes.",
		attributionHtml: mapTilerAttribution,
		buildStyleUrl: (apiKey) =>
			`https://api.maptiler.com/maps/outdoor-v2/style.json?key=${apiKey}`,
	},
];

const basemapById = new Map(BASEMAPS.map((basemap) => [basemap.id, basemap]));

function getProviderApiKey(provider: BasemapProvider): string {
	if (provider === "stadia") {
		return env.PUBLIC_STADIA_MAPS_API_KEY?.trim() ?? "";
	}

	return env.PUBLIC_MAPTILER_API_KEY?.trim() ?? "";
}

export function isBasemapId(value: string): value is BasemapId {
	return basemapById.has(value as BasemapId);
}

export function getBasemapById(id: BasemapId): BasemapDefinition {
	const basemap = basemapById.get(id);

	if (!basemap) {
		throw new Error(`Unknown basemap id: ${id}`);
	}

	return basemap;
}

export function isBasemapAvailable(id: BasemapId): boolean {
	const basemap = getBasemapById(id);
	return getProviderApiKey(basemap.provider).length > 0;
}

export function getBasemapStyleUrl(id: BasemapId): string | null {
	if (!isBasemapAvailable(id)) {
		return null;
	}

	const basemap = getBasemapById(id);
	return basemap.buildStyleUrl(getProviderApiKey(basemap.provider));
}

export function getAvailableBasemaps(): BasemapDefinition[] {
	return BASEMAPS.filter((basemap) => isBasemapAvailable(basemap.id));
}
