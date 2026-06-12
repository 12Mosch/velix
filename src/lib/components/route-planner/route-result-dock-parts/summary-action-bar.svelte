<script lang="ts">
	import { Effect } from "effect";
	import { Check, ChevronDown, ChevronUp, MountainSnow, Redo2, Share2, TrendingDown, Undo2 } from "@lucide/svelte";

	import ActionTooltip from "$lib/components/route-planner/action-tooltip.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import {
		formatDistanceValue,
		getDistanceUnitLabel,
	} from "$lib/unit-settings.svelte";
	import { getRouteDurationText } from "$lib/route-planner/formatters";
	import type {
		PlannerAnalysisController,
		PlannerFormController,
		PlannerImportExportController,
		PlannerRoutesController,
		PlannerSaveController,
		PlannerSharingController,
	} from "$lib/route-planner/page/route-planner-page-controller.svelte";
	import type { RouteResultDockChromeView } from "$lib/components/route-planner/route-result-dock-parts/types";

	type Props = {
		dock: RouteResultDockChromeView;
		form: PlannerFormController;
		routes: PlannerRoutesController;
		analysis: PlannerAnalysisController;
		save: PlannerSaveController;
		sharing: PlannerSharingController;
		importExport: PlannerImportExportController;
		profileOpen: boolean;
		onToggleProfile: () => void;
		saveDraftDisabledReason: string | null;
		exportDisabledReason: string | null;
		shareDisabledReason: string | null;
	};

	let {
		dock,
		form,
		routes,
		analysis,
		save,
		sharing,
		importExport,
		profileOpen,
		onToggleProfile,
		saveDraftDisabledReason,
		exportDisabledReason,
		shareDisabledReason,
	}: Props = $props();
</script>

{#snippet routeSummarySkeleton()}
	<div
		class="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3"
		role="status"
		aria-live="polite"
		aria-label={form.getSubmitButtonText()}
	>
		<span class="sr-only">
			{dock.isRoundCourseMode
				? "Calculating the round course..."
				: dock.isOutAndBackMode
					? "Calculating the out-and-back route..."
					: "Calculating the road-bike route..."}
		</span>
		<Skeleton class="h-7 w-24 rounded-md" />
		<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-20 rounded-md" />
		<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-20 rounded-md" />
		<span class="hidden text-border md:inline" aria-hidden="true">·</span>
		<Skeleton class="h-6 w-24 rounded-md" />
	</div>
{/snippet}

<div class="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-4">
	{#if dock.isRouting}
		{@render routeSummarySkeleton()}
	{:else if dock.activeRoute}
		<div
			class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums sm:text-sm"
		>
			<span class="font-semibold text-foreground">
				<span class="font-heading text-base sm:text-lg">
					{formatDistanceValue(dock.activeRoute.distanceMeters)}
				</span>
				{getDistanceUnitLabel()}
			</span>
			<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
			<span class="flex items-center gap-1">
				<MountainSnow class="size-3.5 shrink-0 text-emerald-500" />
				<span class="font-semibold text-foreground">
					<span class="font-heading text-base sm:text-lg">
						{Math.round(dock.activeRoute.ascendMeters).toLocaleString()}
					</span>
					m
				</span>
			</span>
			<span class="hidden text-border sm:inline" aria-hidden="true">·</span>
			<span class="flex items-center gap-1 text-sky-600 dark:text-sky-400">
				<TrendingDown class="size-3.5 shrink-0 opacity-80" />
				<span class="font-semibold">
					<span class="font-heading text-base sm:text-lg">
						{Math.round(dock.activeRoute.descendMeters).toLocaleString()}
					</span>
					m
				</span>
			</span>
			<span class="hidden text-border md:inline" aria-hidden="true">·</span>
			<span class="font-semibold text-foreground">{getRouteDurationText(dock.activeRoute)}</span>
			{#if dock.activeDirections.length > 0}
				<span class="hidden text-border md:inline" aria-hidden="true">·</span>
				<span class="font-semibold text-foreground">
					{dock.activeTurnCount} turn{dock.activeTurnCount === 1 ? "" : "s"}
				</span>
			{/if}
		</div>
	{:else}
		<div class="flex min-w-0 flex-col gap-1">
			<span class="text-sm font-semibold text-foreground">
				{dock.isRoundCourseMode
					? "Generate a round course to see live distance, climbing, and elevation."
					: dock.isOutAndBackMode
						? "Generate an out-and-back route to see live distance, climbing, and elevation."
						: "Generate a route to see live distance, climbing, and elevation."}
			</span>
			<span class="text-xs text-muted-foreground">
				{dock.isRoundCourseMode
					? "The map overlay and summary will update once a loop route is found."
					: dock.isOutAndBackMode
						? "The map overlay and summary will update once the outbound leg is mirrored."
						: "The map overlay and summary will update once a route is found."}
			</span>
		</div>
	{/if}

	<div class="flex w-full shrink-0 flex-col items-stretch gap-1.5 md:w-auto md:items-end">
		<div class="flex flex-wrap items-center justify-start gap-1.5 md:justify-end md:gap-2">
			<Button
				variant="outline"
				size="sm"
				class="h-8 gap-1.5 px-2.5 font-semibold"
				disabled={dock.isImportingGpx}
				onclick={importExport.openGpxImportPicker}
			>
				{#if dock.isImportingGpx}
					<Skeleton class="size-3 rounded-full" />
				{/if}
				{dock.isImportingGpx ? "Importing GPX..." : "Import GPX"}
			</Button>
			{#if dock.activeRoute}
				<div class="flex items-center gap-1">
					<Button
						variant="outline"
						size="icon"
						class="size-8"
						type="button"
						disabled={!dock.canUndoRouteEdit}
						aria-label="Undo route edit"
						onclick={routes.undoRouteEdit}
					>
						<Undo2 class="size-3.5" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						class="size-8"
						type="button"
						disabled={!dock.canRedoRouteEdit}
						aria-label="Redo route edit"
						onclick={routes.redoRouteEdit}
					>
						<Redo2 class="size-3.5" />
					</Button>
				</div>
				<ActionTooltip content={saveDraftDisabledReason}>
					<Button
						variant={dock.isActiveRouteSaved ? "secondary" : "outline"}
						size="sm"
						class="h-8 gap-1 px-2.5 font-semibold"
						disabled={dock.routeActionsDisabled}
						onclick={() => void Effect.runPromise(save.handleSaveDraft())}
					>
						{#if dock.isActiveRouteSaved}
							<Check class="size-3.5" />
							Saved
						{:else}
							Save Draft
						{/if}
					</Button>
				</ActionTooltip>
				<ActionTooltip content={exportDisabledReason}>
					<Button
						size="sm"
						class="h-8 px-2.5 font-semibold"
						disabled={dock.routeActionsDisabled}
						onclick={importExport.handleExportGpx}
					>
						Export GPX
					</Button>
				</ActionTooltip>
				<ActionTooltip content={exportDisabledReason}>
					<Button
						size="sm"
						variant="outline"
						class="h-8 px-2.5 font-semibold"
						disabled={dock.routeActionsDisabled}
						onclick={importExport.handleExportFit}
					>
						Export FIT
					</Button>
				</ActionTooltip>
				<ActionTooltip content={shareDisabledReason}>
					<Button
						size="sm"
						variant="outline"
						class="h-8 gap-1 px-2.5 font-semibold"
						disabled={dock.routeActionsDisabled || dock.isSharingRoute}
						onclick={() =>
							void Effect.runPromise(sharing.handleShareActiveRoute())}
					>
						<Share2 class="size-3.5" />
						{dock.isSharingRoute ? "Sharing..." : dock.isActiveRouteShareCopied ? "Copied" : "Share"}
					</Button>
				</ActionTooltip>
				<Button
					variant="outline"
					size="sm"
					class="h-8 gap-1 px-2.5 font-semibold"
					onclick={() => (analysis.directionsOpen = !dock.directionsOpen)}
					aria-expanded={dock.directionsOpen}
					aria-controls="route-directions-panel"
				>
					Directions
					<Badge variant="secondary" class="h-5 px-1.5 text-[10px] font-semibold">
						{dock.activeTurnCount}
					</Badge>
					{#if dock.directionsOpen}
						<ChevronUp class="size-3.5 opacity-70" />
					{:else}
						<ChevronDown class="size-3.5 opacity-70" />
					{/if}
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="h-8 gap-1 px-2.5 font-semibold"
					onclick={onToggleProfile}
					aria-expanded={profileOpen}
					aria-controls="route-profile-panel"
				>
					Profile
					{#if profileOpen}
						<ChevronUp class="size-3.5 opacity-70" />
					{:else}
						<ChevronDown class="size-3.5 opacity-70" />
					{/if}
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="h-8 gap-1 px-2.5 font-semibold"
					onclick={() => (analysis.routeAnalysisOpen = !dock.routeAnalysisOpen)}
					aria-expanded={dock.routeAnalysisOpen}
					aria-controls="route-analysis-panel"
				>
					{dock.routeAnalysisOpen ? "Less" : "Analysis"}
					{#if dock.routeAnalysisOpen}
						<ChevronUp class="size-3.5 opacity-70" />
					{:else}
						<ChevronDown class="size-3.5 opacity-70" />
					{/if}
				</Button>
			{/if}
		</div>
	</div>
</div>
