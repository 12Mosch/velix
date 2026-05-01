# Velix

Velix is a SvelteKit route-planning app for cycling routes. It uses MapLibre for the map, GraphHopper for geocoding and routing, and optional Clerk + Convex integration for signed-in saved-route sync.

## Features

- Point-to-point, round-course, and out-and-back route planning
- Up to three shaping waypoints per route
- Alternative route generation with road-bike-biased GraphHopper routing
- Area and corridor constraints for route shaping
- Interactive map editing, locked segments, undo, and redo
- Elevation, distance, duration, climb, descent, and surface summaries
- GPX import and export
- Saved routes with local storage and optional cloud sync
- Configurable basemaps, app theme, and distance units

## Tech Stack

- SvelteKit 2 and Svelte 5
- TypeScript
- Bun
- Tailwind CSS 4
- shadcn-svelte / bits-ui
- MapLibre GL
- GraphHopper
- Convex and Clerk
- Vitest, Playwright browser tests, svelte-check, and Biome

## Prerequisites

- Bun
- A GraphHopper API key for route generation and search
- At least one map tile provider key:
  - Stadia Maps for the Stadia styles
  - MapTiler for satellite and outdoor styles
- Optional: Convex and Clerk projects for signed-in route sync

## Environment

Create a local `.env` file with the keys you need:

```sh
GRAPHHOPPER_API_KEY=...
PUBLIC_STADIA_MAPS_API_KEY=...
PUBLIC_MAPTILER_API_KEY=...
```

`GRAPHHOPPER_API_KEY` is server-only and must not use the `PUBLIC_` prefix.

For Convex + Clerk saved-route sync, also configure:

```sh
PUBLIC_CONVEX_URL=...
CLERK_JWT_ISSUER_DOMAIN=...
```

The app still runs without `PUBLIC_CONVEX_URL`; saved routes stay local to the browser. Convex auth configuration requires `CLERK_JWT_ISSUER_DOMAIN` when Convex functions are started.

## Install

```sh
bun install
```

## Develop

```sh
bun run dev
```

The dev script starts both Convex and Vite:

- Convex: `npx convex dev`
- SvelteKit: `vite dev`

If you are only working on the SvelteKit app and do not need Convex, run Vite directly:

```sh
bunx vite dev
```

## Quality Checks

```sh
bun run check
bun run lint
bun run test
```

Useful fix commands:

```sh
bun run format:write
bun run lint:fix
```

## Build

```sh
bun run build
```

Preview the production build locally:

```sh
bun run preview
```
