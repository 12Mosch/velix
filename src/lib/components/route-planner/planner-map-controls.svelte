<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import * as Tooltip from "$lib/components/ui/tooltip/index.js";
	import { mapStylePreference, type BasemapId } from "$lib/map-style-settings.svelte";
	import { mergeProps } from "bits-ui";
	import type {
		PlannerMapController,
		PlannerOverlayController,
	} from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import { Layers, LocateFixed, MountainSnow, Route, Wind } from "@lucide/svelte";

	type Props = {
		sidebar: ReturnType<typeof import("$lib/components/ui/sidebar/index.js").useSidebar>;
		overlay: PlannerOverlayController;
		map: PlannerMapController;
		hasActiveRoute: boolean;
	};

	let { sidebar, overlay, map, hasActiveRoute }: Props = $props();
	const availableBasemapOptions = $derived(map.availableBasemapOptions);
	const canShowGradientOverlay = $derived(overlay.canShowGradientOverlay);
	const canShowWindOverlay = $derived(overlay.canShowWindOverlay);
	const gradientOverlayEnabled = $derived(overlay.gradientOverlayEnabled);
	const windOverlayEnabled = $derived(overlay.windOverlayEnabled);
	const isLocating = $derived(map.isLocating);
</script>

<div class="pointer-events-auto absolute right-4 top-4 flex flex-col gap-2 md:right-5 md:top-5">
	<Tooltip.Provider delayDuration={150}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: _tooltipProps })}
					<span {...mergeProps(_tooltipProps, { class: "inline-flex" })}>
						<DropdownMenu.DropdownMenu>
							<DropdownMenu.DropdownMenuTrigger>
								{#snippet child({ props: _dropdownProps })}
									<Button
										{..._dropdownProps}
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
					</span>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="left" align="center" sideOffset={8}>Choose basemap</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: _tooltipProps })}
					<span {...mergeProps(_tooltipProps, { class: "inline-flex" })}>
						<Button
							variant="ghost"
							size="icon"
							class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground"
							type="button"
							disabled={isLocating}
							aria-label="Show current location"
							onclick={map.showCurrentLocationOnMap}
						>
							<LocateFixed class="size-4" />
						</Button>
					</span>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="left" align="center" sideOffset={8}>
				Show current location
			</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: _tooltipProps })}
					<span {...mergeProps(_tooltipProps, { class: "inline-flex" })}>
						<Button
							variant="ghost"
							size="icon"
							class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50"
							type="button"
							disabled={!hasActiveRoute}
							aria-label="Recenter route"
							onclick={map.recenterActiveRoute}
						>
							<Route class="size-4" />
						</Button>
					</span>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="left" align="center" sideOffset={8}>Recenter route</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: _tooltipProps })}
					<span {...mergeProps(_tooltipProps, { class: "inline-flex" })}>
						<Button
							variant="ghost"
							size="icon"
							class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-orange-300/70 data-[active=true]:bg-orange-50/90 data-[active=true]:text-orange-700"
							type="button"
							disabled={!canShowGradientOverlay}
							aria-label="Gradient overlay"
							aria-pressed={gradientOverlayEnabled}
							data-active={gradientOverlayEnabled}
							onclick={() => (overlay.gradientOverlayEnabled = !gradientOverlayEnabled)}
						>
							<MountainSnow class="size-4" />
						</Button>
					</span>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="left" align="center" sideOffset={8}>Gradient overlay</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: _tooltipProps })}
					<span {...mergeProps(_tooltipProps, { class: "inline-flex" })}>
						<Button
							variant="ghost"
							size="icon"
							class="size-9 rounded-lg border border-border/60 bg-background/85 text-muted-foreground shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 hover:text-foreground disabled:opacity-50 data-[active=true]:border-teal-300/70 data-[active=true]:bg-teal-50/90 data-[active=true]:text-teal-700"
							type="button"
							disabled={!canShowWindOverlay}
							aria-label="Wind and conditions"
							aria-pressed={windOverlayEnabled}
							data-active={windOverlayEnabled}
							onclick={() => (overlay.windOverlayEnabled = !windOverlayEnabled)}
						>
							<Wind class="size-4" />
						</Button>
					</span>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="left" align="center" sideOffset={8}>
				Wind and conditions
			</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
</div>

{#if sidebar.isMobile}
	<div class="pointer-events-auto absolute left-4 top-4">
		<Sidebar.Trigger
			class="size-9 rounded-lg border border-border/60 bg-background/85 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 focus-visible:ring-offset-0"
		/>
	</div>
{/if}
