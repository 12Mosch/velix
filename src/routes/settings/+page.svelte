<script lang="ts">
	import { Effect } from "effect";
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
	import {
		initUnitPreference,
		setDistanceUnitPreference,
		type DistanceUnit,
		unitPreference,
	} from "$lib/unit-settings.svelte";
	import { ArrowLeft, Check } from "@lucide/svelte";
	import AppThemeSettings from "$lib/components/app-theme-settings.svelte";
	import BasemapPreview from "$lib/components/basemap-preview.svelte";

	function runPreferenceEffect<T, E>(
		effect: Effect.Effect<T, E>,
		message: string,
	) {
		return Effect.runSync(
			effect.pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						console.error(message, error);
						return null;
					}),
				),
			),
		);
	}

	onMount(() => {
		runPreferenceEffect(
			initMapStylePreference(),
			"Failed to initialize map style preference",
		);
		runPreferenceEffect(
			initUnitPreference(),
			"Failed to initialize unit preference",
		);
	});

	function isSelected(basemapId: string): boolean {
		return mapStylePreference.selectedBasemapId === basemapId;
	}

	const distanceUnitOptions: Array<{
		unit: DistanceUnit;
		label: string;
		description: string;
	}> = [
		{
			unit: "km",
			label: "Kilometers",
			description: "Show route distances, targets, and map scale in kilometers.",
		},
		{
			unit: "mi",
			label: "Miles",
			description: "Show route distances, targets, and map scale in miles.",
		},
	];

	function isSelectedDistanceUnit(unit: DistanceUnit): boolean {
		return unitPreference.selectedDistanceUnit === unit;
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
						App theme
					</span>
				</div>
				<p class="text-sm text-muted-foreground">
					Choose whether Velix follows your desktop theme or always uses light or dark mode.
				</p>
			</div>

			<Separator class="my-4" />

			<AppThemeSettings />
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
					<!-- biome-ignore-start lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
					<!-- biome-ignore lint/a11y/useSemanticElements: Button is used as a radio-style selectable card. -->
					<Button
						variant="outline"
						class={`h-auto w-full justify-start rounded-lg px-0 py-0 text-left transition-colors ${
							isSelected(basemap.id)
								? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
								: "hover:bg-secondary/60"
						}`}
						role="radio"
						aria-checked={isSelected(basemap.id) ? "true" : "false"}
						aria-label={basemap.label}
						disabled={!basemap.available}
						onclick={() =>
							runPreferenceEffect(
								setMapStylePreference(basemap.id),
								"Failed to set map style preference",
							)}
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
					<!-- biome-ignore-end lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
				{/each}
			</div>
		</div>

		<div class="bg-background border border-border rounded-xl p-4 shadow-lg md:p-5">
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-2">
					<span class="text-xs font-semibold uppercase tracking-wide text-foreground/80">
						Distance units
					</span>
				</div>
				<p class="text-sm text-muted-foreground">
					Choose how route distances and map scale are displayed.
				</p>
			</div>

			<Separator class="my-4" />

			<div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Distance units">
				{#each distanceUnitOptions as option}
					<!-- biome-ignore-start lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
					<!-- biome-ignore lint/a11y/useSemanticElements: Button is used as a radio-style segmented option. -->
					<Button
						variant="outline"
						class={`h-auto w-full items-start justify-start whitespace-normal rounded-lg px-3.5 py-3 text-left transition-colors ${
							isSelectedDistanceUnit(option.unit)
								? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
								: "hover:bg-secondary/60"
						}`}
						role="radio"
						aria-checked={isSelectedDistanceUnit(option.unit) ? "true" : "false"}
						aria-label={option.label}
						onclick={() =>
							runPreferenceEffect(
								setDistanceUnitPreference(option.unit),
								"Failed to set distance unit preference",
							)}
					>
						<div class="flex min-w-0 flex-col gap-1.5">
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-heading text-sm font-semibold tracking-tight text-foreground">
									{option.label}
								</span>
								{#if isSelectedDistanceUnit(option.unit)}
									<Badge
										variant="outline"
										class="h-5 border-primary/30 bg-primary/10 px-2 text-[10px] font-semibold text-primary"
									>
										<Check class="mr-0.5 size-3" />
										Selected
									</Badge>
								{/if}
							</div>
							<p class="text-xs leading-5 text-muted-foreground">
								{option.description}
							</p>
						</div>
					</Button>
					<!-- biome-ignore-end lint/a11y/useValidAriaValues: Dynamic Svelte ARIA value is computed at runtime. -->
				{/each}
			</div>
		</div>
	</div>
</div>
