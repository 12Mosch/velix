<script lang="ts">
	import { onMount } from "svelte";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Separator } from "$lib/components/ui/separator/index.js";
	import {
		basemapOptions,
		initMapStylePreference,
		mapStylePreference,
		setMapStylePreference,
	} from "$lib/map-style-settings.svelte";
	import { ArrowLeft, Check } from "lucide-svelte";
	import BasemapPreview from "$lib/components/basemap-preview.svelte";

	onMount(() => {
		initMapStylePreference();
	});

	function isSelected(basemapId: string): boolean {
		return mapStylePreference.selectedBasemapId === basemapId;
	}
</script>

<div class="relative h-full w-full bg-background overflow-y-auto">
	<div class="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-6">
		<div class="flex items-center gap-3">
			<Button variant="ghost" size="icon" class="size-8 shrink-0" href="/">
				<ArrowLeft class="size-4" />
			</Button>
			<div class="flex min-w-0 flex-col gap-0.5">
				<h1 class="font-heading text-lg font-semibold tracking-tight md:text-xl">Settings</h1>
			</div>
		</div>

		<div class="bg-background border border-border rounded-xl p-4 shadow-lg md:p-5">
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-2">
					<span class="text-xs font-semibold uppercase tracking-wide text-foreground/80">
						Map style
					</span>
				</div>
				<p class="text-sm text-muted-foreground">
					Choose the base layer used by the route planner map.
				</p>
			</div>

			<Separator class="my-4" />

			<div class="flex flex-col gap-2.5" role="radiogroup" aria-label="Basemap style">
				{#each basemapOptions as basemap}
					<Button
						variant="outline"
						class={`h-auto w-full justify-start rounded-lg px-0 py-0 text-left transition-colors ${
							isSelected(basemap.id)
								? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
								: "hover:bg-secondary/60"
						}`}
						role="radio"
						aria-checked={isSelected(basemap.id)}
						aria-label={basemap.label}
						disabled={!basemap.available}
						onclick={() => setMapStylePreference(basemap.id)}
					>
						<div class="flex w-full flex-row">
							<div class="w-28 shrink-0 self-stretch overflow-hidden rounded-l-lg max-md:hidden">
								{#if basemap.available}
									<BasemapPreview basemapId={basemap.id} />
								{:else}
									<div class="h-full w-full bg-muted"></div>
								{/if}
							</div>
							<div class="flex min-w-0 flex-1 flex-col gap-1.5 py-3 pl-3.5 pr-3.5">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-heading text-sm font-semibold tracking-tight text-foreground">
										{basemap.label}
									</span>
									<Badge
										variant={basemap.provider === "stadia" ? "secondary" : "outline"}
										class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
									>
										{basemap.provider}
									</Badge>
									{#if isSelected(basemap.id)}
										<Badge
											variant="outline"
											class="h-5 border-primary/30 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
										>
											<Check class="mr-0.5 size-3" />
											Selected
										</Badge>
									{/if}
									{#if !basemap.available}
										<Badge
											variant="destructive"
											class="h-5 px-2 text-[10px] font-semibold uppercase tracking-wide"
										>
											Unavailable
										</Badge>
									{/if}
								</div>
								<p class="text-xs leading-5 text-muted-foreground">
									{basemap.description}
								</p>
								{#if !basemap.available}
									<p class="text-xs text-muted-foreground">
										Add
										<code class="rounded bg-secondary px-1 py-0.5 text-[11px] font-semibold text-foreground">
											{basemap.requiredEnvVar}
										</code>
										to enable this style.
									</p>
								{/if}
							</div>
						</div>
					</Button>
				{/each}
			</div>
		</div>
	</div>
</div>
