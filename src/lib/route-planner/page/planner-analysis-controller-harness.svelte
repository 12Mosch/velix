<script lang="ts">
	import type { PlannedRoute } from "$lib/route-planning";
	import {
		createPlannerAnalysisController,
		type PlannerAnalysisController,
	} from "./planner-analysis-controller.svelte";
	import { Effect } from "effect";

	type Props = {
		activeRoute: PlannedRoute;
		onController: (controller: PlannerAnalysisController) => void;
	};

	let { activeRoute, onController }: Props = $props();
	const controller = createPlannerAnalysisController({
		getActiveRoute: () => activeRoute,
		getRouteAlternatives: () => [activeRoute],
		ensureActiveRouteWindAnalysis: () => Effect.void,
	});

	function notifyController() {
		onController(controller);
	}

	notifyController();
</script>
