<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { mapStylePreference, type BasemapId } from "$lib/map-style-settings.svelte";
	import type {
		PlannerMapController,
		PlannerOverlayController,
		RoutePlannerPageController,
	} from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import { Layers, LocateFixed, MountainSnow, Route, Wind } from "@lucide/svelte";

	type Props = {
		sidebar: ReturnType<typeof import("$lib/components/ui/sidebar/index.js").useSidebar>;
		overlay: PlannerOverlayController;
		map: PlannerMapController;
		hasActiveRoute: boolean;
	};

	let { sidebar, overlay, hasActiveRoute }: Props = $props();
	const controller = $derived(overlay as unknown as RoutePlannerPageController);
	const availableBasemapOptions = $derived(controller.availableBasemapOptions);
	const canShowGradientOverlay = $derived(controller.canShowGradientOverlay);
	const canShowWindOverlay = $derived(controller.canShowWindOverlay);
	const gradientOverlayEnabled = $derived(controller.gradientOverlayEnabled);
	const windOverlayEnabled = $derived(controller.windOverlayEnabled);
	const isLocating = $derived(controller.isLocating);
</script>

<div class="pointer-events-auto absolute right-4 top-4 flex flex-col gap-2 md:right-5 md:top-5">
	<DropdownMenu.DropdownMenu>
		<DropdownMenu.DropdownMenuTrigger>
			{#snippet child({ props: _props })}
				<Button
					{..._props}
					variant="ghost"
					size="icon"
					class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground"
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
				onValueChange={(id) => controller.chooseBasemap(id as BasemapId)}
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
	<Button
		variant="ghost"
		size="icon"
		class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground"
		type="button"
		disabled={isLocating}
		aria-label="Show current location"
		onclick={controller.showCurrentLocationOnMap}
	>
		<LocateFixed class="size-4" />
	</Button>
	<Button
		variant="ghost"
		size="icon"
		class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50"
		type="button"
		disabled={!hasActiveRoute}
		aria-label="Recenter route"
		onclick={controller.recenterActiveRoute}
	>
		<Route class="size-4" />
	</Button>
	<Button
		variant="ghost"
		size="icon"
		class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-orange-300/70 data-[active=true]:bg-orange-50/90 data-[active=true]:text-orange-700"
		type="button"
		disabled={!canShowGradientOverlay}
		aria-label="Gradient overlay"
		aria-pressed={gradientOverlayEnabled}
		data-active={gradientOverlayEnabled}
		onclick={() => (controller.gradientOverlayEnabled = !gradientOverlayEnabled)}
	>
		<MountainSnow class="size-4" />
	</Button>
	<Button
		variant="ghost"
		size="icon"
		class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-teal-300/70 data-[active=true]:bg-teal-50/90 data-[active=true]:text-teal-700"
		type="button"
		disabled={!canShowWindOverlay}
		aria-label="Wind and conditions"
		aria-pressed={windOverlayEnabled}
		data-active={windOverlayEnabled}
		onclick={() => (controller.windOverlayEnabled = !windOverlayEnabled)}
	>
		<Wind class="size-4" />
	</Button>
</div>

{#if sidebar.isMobile}
	<div class="pointer-events-auto absolute left-4 top-4">
		<Sidebar.Trigger
			class="size-9 rounded-lg border border-border/60 bg-background/85 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 focus-visible:ring-offset-0"
		/>
	</div>
{/if}
