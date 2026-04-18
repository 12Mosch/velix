<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import {
		MapPin,
		Navigation,
		MountainSnow,
		Wind,
		TrendingUp,
		TrendingDown,
		Percent,
		Route,
		ShieldCheck,
		ChevronDown,
		ChevronUp
	} from 'lucide-svelte';

	let routeAnalysisOpen = $state(false);

	const sidebar = useSidebar();

	/** Mock elevation samples along the route (meters AMSL) */
	const elevM = [
		412, 408, 415, 428, 445, 452, 468, 482, 478, 465, 451, 438, 425, 418, 432, 455, 472, 488, 495,
		502, 498, 485, 468, 452, 441, 435, 442, 458, 470, 465, 448, 432, 418, 405, 398, 402, 415, 428
	];

	const elevMin = Math.min(...elevM);
	const elevMax = Math.max(...elevM);
	const elevRange = Math.max(elevMax - elevMin, 1);

	function elevY(m: number, height: number, pad: number): number {
		const t = (m - elevMin) / elevRange;
		return pad + (1 - t) * (height - pad * 2);
	}

	const chartW = 800;
	const padY = 5;
	const chartH = $derived(routeAnalysisOpen ? 72 : 44);
	const linePoints = $derived(
		elevM
			.map((m, i) => {
				const x = (i / (elevM.length - 1)) * chartW;
				const y = elevY(m, chartH, padY);
				return `${x},${y}`;
			})
			.join(' ')
	);
	const areaD = $derived(
		`M 0,${chartH} L ${linePoints.replaceAll(' ', ' L ')} L ${chartW},${chartH} Z`
	);

	const surfaceMix = [
		{ label: 'Smooth asphalt', pct: 68, class: 'bg-emerald-500' },
		{ label: 'Mixed / worn', pct: 24, class: 'bg-amber-500' },
		{ label: 'Coarse / chip', pct: 8, class: 'bg-orange-600' }
	] as const;
</script>

<div class="relative h-full w-full bg-background overflow-hidden flex flex-col">
    <!-- Map Background Mockup -->
    <div class="absolute inset-0 pointer-events-none z-0">
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--color-primary)_0%,_transparent_100%)] opacity-[0.03]"></div>
        <div class="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:64px_64px]"></div>
        
        <svg aria-hidden="true" focusable="false" class="absolute top-1/2 left-1/3 w-1/2 h-1/2 overflow-visible opacity-20" viewBox="0 0 100 100">
            <path d="M 0 50 C 20 20, 40 80, 60 40 S 80 10, 100 60" fill="none" stroke="var(--color-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="drop-shadow-[0_0_4px_rgba(168,85,247,0.4)]" />
            <circle cx="0" cy="50" r="2.5" fill="var(--color-background)" stroke="var(--color-primary)" stroke-width="1" />
            <circle cx="100" cy="60" r="2.5" fill="var(--color-primary)" />
        </svg>
    </div>

    <!-- Mobile: menu trigger (desktop toggle lives in the sidebar header) -->
    <div class="pointer-events-none absolute inset-0 z-20">
        {#if sidebar.isMobile}
            <div class="pointer-events-auto absolute left-4 top-4">
                <Sidebar.Trigger
                    class="size-9 rounded-lg border border-border/60 bg-background/85 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 hover:bg-secondary/90 focus-visible:ring-offset-0"
                />
            </div>
        {/if}
        <div class="pointer-events-auto absolute right-4 top-4 md:right-5 md:top-5">
            <Button
                variant="ghost"
                size="icon"
                class="size-9 rounded-lg border border-border/60 bg-background/85 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-background/72 text-muted-foreground hover:bg-secondary/90 hover:text-foreground"
                aria-label="Wind and conditions"
            >
                <Wind class="size-4" />
            </Button>
        </div>
    </div>

    <!-- UI Overlay Panels: map-first — bottom strip stays shrink-wrapped -->
    <div
        class="relative z-10 flex h-full min-h-0 w-full flex-col gap-3 p-4 md:p-5 pointer-events-none"
    >
        <!-- Top / Left Area Layout -->
        <div class="flex min-h-0 min-w-0 flex-1 gap-5 md:gap-6">
            <!-- Left Panel: Route Builder -->
            <div
                class="pointer-events-auto flex w-full max-w-[340px] flex-col gap-3 max-md:ml-11 max-md:mt-10 md:ml-0 md:mt-4"
            >
                
                <div class="bg-background border border-border rounded-xl p-4 shadow-lg flex flex-col gap-3">
                    <h2 class="text-base font-semibold tracking-tight md:text-lg">Route Builder</h2>
                    
                    <!-- Route stops: one continuous rail, nodes locked to field rows -->
                    <div class="flex gap-3.5">
                        <div
                            class="flex w-[11px] shrink-0 flex-col items-center"
                            aria-hidden="true"
                        >
                            <!-- Offset to input vertical center: label + gap + half input − half node -->
                            <div
                                class="h-[calc(1.125rem+0.5rem+1.125rem-0.25rem)] shrink-0"
                            ></div>
                            <div
                                class="size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_2px_var(--color-background)] ring-1 ring-primary/30"
                            ></div>
                            <div class="h-2.5 w-0.5 shrink-0 rounded-full bg-border/85"></div>
                            <div class="flex flex-col items-center py-2">
                                <div class="h-2 w-0.5 shrink-0 rounded-full bg-border/85"></div>
                                <div
                                    class="my-1.5 size-1.5 shrink-0 rounded-full border-[1.5px] border-muted-foreground/45 bg-background shadow-[0_0_0_2px_var(--color-background)]"
                                ></div>
                                <div class="h-2 w-0.5 shrink-0 rounded-full bg-border/85"></div>
                            </div>
                            <div class="h-2.5 w-0.5 shrink-0 rounded-full bg-border/85"></div>
                            <div
                                class="h-[calc(1.125rem+0.5rem+1.125rem-0.25rem)] shrink-0"
                            ></div>
                            <div
                                class="size-2 shrink-0 rounded-full border-2 border-primary bg-background shadow-[0_0_0_2px_var(--color-background)] ring-1 ring-border/40"
                            ></div>
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col">
                            <div class="space-y-2">
                                <label
                                    for="start-point"
                                    class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
                                    >Start</label
                                >
                                <div class="relative">
                                    <MapPin
                                        class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                                    />
                                    <Input
                                        id="start-point"
                                        placeholder="Enter starting point..."
                                        class="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
                                    />
                                </div>
                            </div>
                            <div class="flex items-center py-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    class="h-8 w-full justify-start gap-2 pl-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                                >
                                    <span
                                        class="flex size-5 items-center justify-center rounded-md border border-dashed border-border/70 text-xs font-semibold leading-none text-muted-foreground"
                                        aria-hidden="true"
                                        >+</span
                                    >
                                    Add waypoint
                                </Button>
                            </div>
                            <div class="space-y-2 pt-2.5">
                                <label
                                    for="destination"
                                    class="block text-xs font-semibold uppercase tracking-wide text-foreground/80"
                                    >Destination</label
                                >
                                <div class="relative">
                                    <Navigation
                                        class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary"
                                    />
                                    <Input
                                        id="destination"
                                        placeholder="Destination..."
                                        class="border-none bg-secondary/20 pl-9 focus-visible:ring-1 focus-visible:ring-primary/50"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <Separator class="my-0.5" />
                    
                    <div class="space-y-2.5">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-xs font-semibold text-foreground/80">Optimization strategy</span>
                            <Badge variant="secondary" class="h-5 shrink-0 border-primary/20 bg-primary/10 px-2 text-[10px] font-semibold text-primary">Zone 2 Focus</Badge>
                        </div>
                        
                        <div class="flex flex-wrap gap-1.5">
                            <Badge variant="outline" class="h-6 cursor-pointer border-border/50 bg-secondary/30 px-2 text-[10px] font-medium transition-colors hover:bg-secondary">Avoid Traffic</Badge>
                            <Badge variant="outline" class="h-6 cursor-pointer border-border/50 bg-secondary/30 px-2 text-[10px] font-medium transition-colors hover:bg-secondary">Smooth Surface</Badge>
                        </div>
                    </div>
                    
                    <Button size="lg" class="mt-1 w-full font-semibold shadow-sm">
                        Generate Route
                    </Button>
                </div>
            </div>
        </div>

        <!-- Bottom strip: compact by default; map stays the hero -->
        <div class="pointer-events-auto w-full shrink-0">
            <div
                class="rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-sm md:p-3.5"
            >
                <div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div
                        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums sm:text-sm"
                    >
                        <span class="font-semibold text-foreground">
                            <span class="font-heading text-base sm:text-lg">87.4</span> km
                        </span>
                        <span class="text-border hidden sm:inline" aria-hidden="true">·</span>
                        <span class="flex items-center gap-1">
                            <MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
                            <span class="font-semibold text-foreground">
                                <span class="font-heading text-base sm:text-lg">1,240</span> m
                            </span>
                        </span>
                        <span class="text-border hidden sm:inline" aria-hidden="true">·</span>
                        <span class="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                            <TrendingDown class="size-3.5 shrink-0 opacity-80" />
                            <span class="font-semibold">
                                <span class="font-heading text-base sm:text-lg">980</span> m
                            </span>
                        </span>
                        <span class="text-border hidden md:inline" aria-hidden="true">·</span>
                        <span class="hidden font-semibold text-foreground md:inline">
                            <span class="font-heading text-base sm:text-lg">2:45</span> h
                        </span>
                        <span class="text-border hidden lg:inline" aria-hidden="true">·</span>
                        <span class="hidden lg:inline">
                            avg <span class="font-semibold text-foreground">4.1%</span> / max
                            <span class="font-semibold text-amber-600 dark:text-amber-400">11%</span>
                        </span>
                        <span class="text-border hidden lg:inline" aria-hidden="true">·</span>
                        <Badge
                            variant="outline"
                            class="h-5 border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[10px] font-bold text-emerald-600"
                        >
                            Low exposure
                        </Badge>
                    </div>
                    <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <Button variant="outline" size="sm" class="font-semibold">Save Draft</Button>
                        <Button size="sm" class="font-semibold">Send to Wahoo</Button>
                        <Button
                            variant="outline"
                            size="sm"
                            class="gap-1 font-semibold"
                            onclick={() => (routeAnalysisOpen = !routeAnalysisOpen)}
                            aria-expanded={routeAnalysisOpen}
                            aria-controls="route-analysis-panel"
                        >
                            {routeAnalysisOpen ? 'Less' : 'Analysis'}
                            {#if routeAnalysisOpen}
                                <ChevronUp class="size-3.5 opacity-70" />
                            {:else}
                                <ChevronDown class="size-3.5 opacity-70" />
                            {/if}
                        </Button>
                    </div>
                </div>

                <div class="mt-2.5 min-w-0 rounded-md border border-border/40 bg-secondary/10">
                    <div
                        class="flex items-center justify-between gap-2 border-b border-border/30 px-3 py-1.5"
                    >
                        <div class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/75">
                            <TrendingUp class="size-3 shrink-0" />
                            Elevation
                        </div>
                        <div
                            class="flex flex-wrap items-center justify-end gap-x-2 gap-y-0 text-xs tabular-nums text-muted-foreground"
                        >
                            <span>min {elevMin} m</span>
                            <span class="text-border">|</span>
                            <span>max {elevMax} m</span>
                            <span class="text-border">|</span>
                            <span>Δ {elevMax - elevMin} m</span>
                        </div>
                    </div>
                    <div class="px-2 pb-1.5 pt-1">
                        <svg
                            class="block w-full"
                            viewBox="0 0 {chartW} {chartH}"
                            preserveAspectRatio="none"
                            role="img"
                            aria-label="Elevation along route"
                        >
                            <defs>
                                <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="rgb(16 185 129)" stop-opacity="0.35" />
                                    <stop offset="100%" stop-color="rgb(16 185 129)" stop-opacity="0.02" />
                                </linearGradient>
                            </defs>
                            {#each [0.25, 0.5, 0.75] as g}
                                <line
                                    x1="0"
                                    y1={g * chartH}
                                    x2={chartW}
                                    y2={g * chartH}
                                    stroke="currentColor"
                                    class="text-border/40"
                                    stroke-width="1"
                                    vector-effect="non-scaling-stroke"
                                />
                            {/each}
                            <path d={areaD} fill="url(#elevFill)" class="text-emerald-500" />
                            <polyline
                                fill="none"
                                stroke="rgb(16 185 129)"
                                stroke-width="2.5"
                                stroke-linejoin="round"
                                stroke-linecap="round"
                                points={linePoints}
                                vector-effect="non-scaling-stroke"
                            />
                        </svg>
                        <div
                            class="flex justify-between px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                        >
                            <span>Start</span>
                            <span class="hidden min-[480px]:inline">25 km</span>
                            <span class="hidden min-[640px]:inline">50 km</span>
                            <span class="hidden min-[900px]:inline">65 km</span>
                            <span>87.4 km</span>
                        </div>
                    </div>
                </div>

                {#if routeAnalysisOpen}
                    <div
                        id="route-analysis-panel"
                        class="mt-3 max-h-[min(38vh,22rem)] overflow-y-auto rounded-lg border border-border/40 bg-secondary/5 p-3 md:max-h-[min(42vh,26rem)] md:p-3.5"
                    >
                        <div class="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
                            <div class="flex flex-col gap-3">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="flex min-w-0 items-center gap-2">
                                        <ShieldCheck
                                            class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                                        />
                                        <span
                                            class="text-xs font-semibold uppercase tracking-wide text-foreground/75"
                                            >Ride quality</span
                                        >
                                    </div>
                                    <Badge variant="secondary" class="h-5 shrink-0 px-2 text-[10px] font-semibold"
                                        >Comfort 82</Badge
                                    >
                                </div>
                                <div class="space-y-2">
                                    <div class="flex items-center justify-between text-xs text-muted-foreground">
                                        <span class="flex items-center gap-1"
                                            ><Route class="size-3" /> Surface mix</span
                                        >
                                    </div>
                                    <div class="flex h-2 overflow-hidden rounded-full bg-secondary">
                                        {#each surfaceMix as s}
                                            <div
                                                class="{s.class} opacity-90"
                                                style="width: {s.pct}%"
                                                title="{s.label}: {s.pct}%"
                                            ></div>
                                        {/each}
                                    </div>
                                    <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                        {#each surfaceMix as s}
                                            <span class="flex items-center gap-1">
                                                <span class="size-1.5 rounded-full {s.class}"></span>
                                                {s.label} ({s.pct}%)
                                            </span>
                                        {/each}
                                    </div>
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-2.5 text-xs">
                                <div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
                                    <div
                                        class="mb-1 font-semibold uppercase tracking-wide text-foreground/70"
                                    >
                                        Major crossings
                                    </div>
                                    <div class="font-heading text-sm font-bold tabular-nums">12</div>
                                </div>
                                <div class="rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
                                    <div
                                        class="mb-1 font-semibold uppercase tracking-wide text-foreground/70"
                                    >
                                        Busy road share
                                    </div>
                                    <div
                                        class="flex items-baseline gap-1 font-heading text-sm font-bold tabular-nums"
                                    >
                                        <Percent class="size-3 shrink-0 text-muted-foreground" />
                                        8%
                                    </div>
                                </div>
                                <div class="col-span-2 rounded-md border border-border/30 bg-background/60 px-2.5 py-2">
                                    <div
                                        class="mb-1 font-semibold uppercase tracking-wide text-foreground/70"
                                    >
                                        Climb buckets
                                    </div>
                                    <div class="mt-1.5 flex flex-wrap gap-1.5">
                                        <Badge variant="outline" class="h-5 px-2 text-[10px] font-semibold"
                                            >&lt;5% · 54 km</Badge
                                        >
                                        <Badge variant="outline" class="h-5 px-2 text-[10px] font-semibold"
                                            >5–8% · 22 km</Badge
                                        >
                                        <Badge variant="outline" class="h-5 px-2 text-[10px] font-semibold"
                                            >&gt;8% · 11 km</Badge
                                        >
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>
