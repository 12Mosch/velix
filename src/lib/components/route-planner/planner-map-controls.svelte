<script lang="ts">
	import ActionTooltip from "$lib/components/route-planner/action-tooltip.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { mapStylePreference, type BasemapId } from "$lib/map-style-settings.svelte";
	import type {
		PlannerMapController,
		PlannerOverlayController,
	} from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import {
		Layers,
		LocateFixed,
		MountainSnow,
		Route,
		TrafficCone,
		Wind,
	} from "@lucide/svelte";
	import { Effect } from "effect";

	type Props = {
		sidebar: ReturnType<typeof import("$lib/components/ui/sidebar/index.js").useSidebar>;
		overlay: PlannerOverlayController;
		map: PlannerMapController;
		hasActiveRoute: boolean;
		hasGeneratedRoute: boolean;
		routeNeedsRecalculation: boolean;
	};

	let {
		sidebar,
		overlay,
		map,
		hasActiveRoute,
		hasGeneratedRoute,
		routeNeedsRecalculation,
	}: Props = $props();
	const availableBasemapOptions = $derived(map.availableBasemapOptions);
	const canShowGradientOverlay = $derived(overlay.canShowGradientOverlay);
	const canShowWindOverlay = $derived(overlay.canShowWindOverlay);
	const canShowTrafficStressOverlay = $derived(
		overlay.canShowTrafficStressOverlay,
	);
	const gradientOverlayEnabled = $derived(overlay.gradientOverlayEnabled);
	const windOverlayEnabled = $derived(overlay.windOverlayEnabled);
	const trafficStressOverlayEnabled = $derived(
		overlay.trafficStressOverlayEnabled,
	);
	const isLocating = $derived(map.isLocating);
	const routeUnavailableTooltip = $derived(
		hasGeneratedRoute && routeNeedsRecalculation
			? "Recalculate route first"
			: "Generate a route first",
	);
	const recenterTooltip = $derived(
		hasActiveRoute ? "Recenter route" : routeUnavailableTooltip,
	);
	const gradientTooltip = $derived(
		canShowGradientOverlay
			? "Gradient overlay"
			: hasGeneratedRoute
				? "Elevation data unavailable"
				: "Generate a route first",
	);
	const windTooltip = $derived(
		canShowWindOverlay
			? "Wind and conditions"
			: hasGeneratedRoute
				? "Wind data unavailable"
				: "Generate a route first",
	);
	const trafficStressTooltip = $derived(
		canShowTrafficStressOverlay
			? "Traffic stress overlay"
			: hasGeneratedRoute
				? "Traffic stress data unavailable"
				: "Generate a route first",
	);
</script>

<div
	class="pointer-events-auto absolute right-3 top-[calc(min(42dvh,24rem)+1rem)] flex flex-col gap-1.5 md:right-5 md:top-5 md:gap-2"
>
	<Tooltip.Provider delayDuration={150}>
		<ActionTooltip content="Choose basemap" side="left">
			<DropdownMenu.DropdownMenu>
				<DropdownMenu.DropdownMenuTrigger>
					{#snippet child({ props: _dropdownProps })}
						<Button
							{..._dropdownProps}
							variant="ghost"
							size="icon"
							class="size-8 rounded-lg border border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/78 hover:bg-secondary/90 hover:text-foreground md:size-9"
							type="button"
							aria-label="Choose basemap"
						>
							<Layers class="size-4" />
						</Button>
					{/snippet}
				</DropdownMenu.DropdownMenuTrigger>
				<DropdownMenu.DropdownMenuContent align="end" class="w-64">
					<DropdownMenu.DropdownMenuLabel>Basemap</DropdownMenu.DropdownMenuLabel>
					<DropdownMenu.DropdownMenuSeparator />
					<DropdownMenu.DropdownMenuRadioGroup
						value={mapStylePreference.selectedBasemapId ?? undefined}
						onValueChange={(id) => map.chooseBasemap(id as BasemapId)}
					>
						{#each availableBasemapOptions as basemap}
							<DropdownMenu.DropdownMenuRadioItem value={basemap.id}>
								<div class="flex min-w-0 flex-col gap-0.5">
									<span class="truncate text-sm font-medium">{basemap.label}</span>
									<span class="truncate text-xs text-muted-foreground capitalize">
										{basemap.provider}
									</span>
								</div>
							</DropdownMenu.DropdownMenuRadioItem>
						{/each}
					</DropdownMenu.DropdownMenuRadioGroup>
				</DropdownMenu.DropdownMenuContent>
			</DropdownMenu.DropdownMenu>
		</ActionTooltip>
		<ActionTooltip
			content={isLocating ? "Finding current location" : "Show current location"}
			side="left"
		>
			<Button
				variant="ghost"
				size="icon"
				class="size-8 rounded-lg border border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/78 hover:bg-secondary/90 hover:text-foreground md:size-9"
				type="button"
				disabled={isLocating}
				aria-label="Show current location"
				onclick={() => void Effect.runPromise(map.showCurrentLocationOnMap())}
			>
				<LocateFixed class="size-4" />
			</Button>
		</ActionTooltip>
		<ActionTooltip content={recenterTooltip} side="left">
			<Button
				variant="ghost"
				size="icon"
				class="size-8 rounded-lg border border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/78 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 md:size-9"
				type="button"
				disabled={!hasActiveRoute}
				aria-label="Recenter route"
				onclick={map.recenterActiveRoute}
			>
				<Route class="size-4" />
			</Button>
		</ActionTooltip>
		<ActionTooltip content={gradientTooltip} side="left">
			<Button
				variant="ghost"
				size="icon"
				class="size-8 rounded-lg border border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/78 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-orange-300/70 data-[active=true]:bg-orange-50/90 data-[active=true]:text-orange-700 md:size-9"
				type="button"
				disabled={!canShowGradientOverlay}
				aria-label="Gradient overlay"
				aria-pressed={gradientOverlayEnabled}
				data-active={gradientOverlayEnabled}
				onclick={() => (overlay.gradientOverlayEnabled = !gradientOverlayEnabled)}
			>
				<MountainSnow class="size-4" />
			</Button>
		</ActionTooltip>
		<ActionTooltip content={windTooltip} side="left">
			<Button
				variant="ghost"
				size="icon"
				class="size-8 rounded-lg border border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/78 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-teal-300/70 data-[active=true]:bg-teal-50/90 data-[active=true]:text-teal-700 md:size-9"
				type="button"
				disabled={!canShowWindOverlay}
				aria-label="Wind and conditions"
				aria-pressed={windOverlayEnabled}
				data-active={windOverlayEnabled}
				onclick={() => (overlay.windOverlayEnabled = !windOverlayEnabled)}
			>
				<Wind class="size-4" />
			</Button>
		</ActionTooltip>
		<ActionTooltip content={trafficStressTooltip} side="left">
			<Button
				variant="ghost"
				size="icon"
				class="size-8 rounded-lg border border-border/60 bg-background/90 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/78 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-red-300/70 data-[active=true]:bg-red-50/90 data-[active=true]:text-red-700 md:size-9"
				type="button"
				disabled={!canShowTrafficStressOverlay}
				aria-label="Traffic stress overlay"
				aria-pressed={trafficStressOverlayEnabled}
				data-active={trafficStressOverlayEnabled}
				onclick={() =>
					(overlay.trafficStressOverlayEnabled =
						!trafficStressOverlayEnabled)}
			>
				<TrafficCone class="size-4" />
			</Button>
		</ActionTooltip>
	</Tooltip.Provider>
</div>

{#if sidebar.isMobile}
	<div class="pointer-events-auto absolute left-3 top-[calc(min(42dvh,24rem)+1rem)]">
		<Sidebar.Trigger
			class="size-8 rounded-lg border border-border/60 bg-background/90 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/78 hover:bg-secondary/90 focus-visible:ring-offset-0"
		/>
	</div>
{/if}
