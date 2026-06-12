<script lang="ts">
	import DirectionsPanel from "$lib/components/route-planner/route-result-dock-parts/directions-panel.svelte";
	import ElevationProfilePanel from "$lib/components/route-planner/route-result-dock-parts/elevation-profile-panel.svelte";
	import RouteAnalysisPanel from "$lib/components/route-planner/route-result-dock-parts/route-analysis-panel.svelte";
	import RouteStatusSections from "$lib/components/route-planner/route-result-dock-parts/route-status-sections.svelte";
	import SummaryActionBar from "$lib/components/route-planner/route-result-dock-parts/summary-action-bar.svelte";
	import type {
		PlannerAnalysisController,
		PlannerFormController,
		PlannerImportExportController,
		PlannerRoutesController,
		PlannerSaveController,
		PlannerSharingController,
	} from "$lib/route-planner/page/route-planner-page-controller.svelte";

	type Props = {
		form: PlannerFormController;
		routes: PlannerRoutesController;
		analysis: PlannerAnalysisController;
		save: PlannerSaveController;
		sharing: PlannerSharingController;
		importExport: PlannerImportExportController;
	};

	let { form, routes, analysis, save, sharing, importExport }: Props = $props();
	const dockChromeView = $derived.by(() => ({
		directionsOpen: analysis.directionsOpen,
		routeAnalysisOpen: analysis.routeAnalysisOpen,
		isRouting: routes.isRouting,
		isImportingGpx: importExport.isImportingGpx,
		routeAlternatives: routes.routeAlternatives,
		selectedRouteIndex: routes.selectedRouteIndex,
		routeNeedsRecalculation: routes.routeNeedsRecalculation,
		avoidedRoads: routes.avoidedRoads,
		routeExportError: importExport.routeExportError,
		isSharingRoute: sharing.isSharingRoute,
		saveSyncError: save.saveSyncError,
		isActiveRouteSaved: save.isActiveRouteSaved,
		selectedCueIndex: analysis.selectedCueIndex,
		isRoundCourseMode: form.isRoundCourseMode,
		isOutAndBackMode: form.isOutAndBackMode,
		activeRoute: routes.activeRoute,
		activeDirections: routes.activeDirections,
		activeTurnCount: routes.activeTurnCount,
		activeRouteShareError: sharing.activeRouteShareError,
		activeRouteShareUrl: sharing.activeRouteShareUrl,
		isActiveRouteShareCopied: sharing.isActiveRouteShareCopied,
		activeRoundCourseTarget: routes.activeRoundCourseTarget,
		activeImportedRouteSource: routes.activeImportedRouteSource,
		alternativeInfoMessage: routes.alternativeInfoMessage,
		canUndoRouteEdit: routes.canUndoRouteEdit,
		canRedoRouteEdit: routes.canRedoRouteEdit,
		routeActionsDisabled: routes.routeNeedsRecalculation || routes.isRouting,
	}));
	let profileOpen = $state(false);
	const saveDraftDisabledReason = $derived(
		routes.routeNeedsRecalculation || routes.isRouting
			? routes.isRouting
				? "Route is generating"
				: "Recalculate before saving"
			: null,
	);
	const exportDisabledReason = $derived(
		routes.routeNeedsRecalculation || routes.isRouting
			? routes.isRouting
				? "Route is generating"
				: "Recalculate before export"
			: null,
	);
	const shareDisabledReason = $derived(
		routes.routeNeedsRecalculation || routes.isRouting
			? routes.isRouting
				? "Route is generating"
				: "Recalculate before sharing"
			: sharing.isSharingRoute
				? "Sharing route"
				: null,
	);
</script>

<div
	class="pointer-events-auto relative w-full shrink-0 max-h-[min(34dvh,22rem)] overflow-y-auto overscroll-contain md:max-h-none md:overflow-visible"
	data-slot="route-result-dock"
>
	<div class="rounded-xl border border-border bg-background/95 p-2.5 shadow-lg backdrop-blur-sm md:p-3.5">
		<SummaryActionBar
			dock={dockChromeView}
			{form}
			{routes}
			{analysis}
			{save}
			{sharing}
			{importExport}
			{profileOpen}
			onToggleProfile={() => (profileOpen = !profileOpen)}
			{saveDraftDisabledReason}
			{exportDisabledReason}
			{shareDisabledReason}
		/>

		<RouteStatusSections dock={dockChromeView} {routes} {analysis} />

		{#if profileOpen && dockChromeView.activeRoute}
			<ElevationProfilePanel dock={dockChromeView} {analysis} />
		{/if}

		{#if dockChromeView.directionsOpen && dockChromeView.activeRoute}
			<DirectionsPanel dock={dockChromeView} {analysis} />
		{/if}

		{#if dockChromeView.routeAnalysisOpen && dockChromeView.activeRoute}
			<RouteAnalysisPanel dock={dockChromeView} {analysis} />
		{/if}
	</div>
</div>
