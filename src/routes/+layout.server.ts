import type { LayoutServerLoad } from "./$types";
import { buildClerkProps } from "svelte-clerk/server";

export const load: LayoutServerLoad = ({ locals }) => {
	return buildClerkProps(locals.auth());
};
