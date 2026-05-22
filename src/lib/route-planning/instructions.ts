import type { PlannedRoute, RouteInstructionType } from "./types";

export function mapGraphHopperSignToInstructionType(
	sign: number,
): RouteInstructionType {
	switch (sign) {
		case -3:
			return "sharp_left";
		case -2:
			return "left";
		case -1:
			return "slight_left";
		case 0:
			return "continue";
		case 1:
			return "slight_right";
		case 2:
			return "right";
		case 3:
			return "sharp_right";
		case 4:
			return "finish";
		case 5:
			return "via";
		case 6:
			return "roundabout";
		case -6:
			return "leave_roundabout";
		case -7:
			return "keep_left";
		case 7:
			return "keep_right";
		case -98:
		case 98:
			return "u_turn";
		default:
			return "unknown";
	}
}

export function getRouteTurnCount(route: PlannedRoute): number {
	return (route.instructions ?? []).filter((instruction) => {
		if (
			instruction.type === "continue" ||
			instruction.type === "via" ||
			instruction.type === "finish"
		) {
			return false;
		}

		return instruction.type !== "unknown" || instruction.sign !== 0;
	}).length;
}
