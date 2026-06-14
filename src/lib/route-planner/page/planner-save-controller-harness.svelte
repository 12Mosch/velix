<script lang="ts">
	import {
		createPlannerSaveController,
		type PlannerSaveController,
	} from "./planner-save-controller.svelte";

	type Props = {
		dependencies: Parameters<typeof createPlannerSaveController>[0];
		onController: (controller: PlannerSaveController) => void;
	};

	let { dependencies, onController }: Props = $props();
	// svelte-ignore state_referenced_locally
	const controller = createPlannerSaveController(dependencies);

	// svelte-ignore state_referenced_locally
	onController(controller);
</script>
