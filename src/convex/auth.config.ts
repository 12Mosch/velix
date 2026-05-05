import type { AuthConfig } from "convex/server";

declare const process: {
	env: {
		CLERK_FRONTEND_API_URL?: string;
		CLERK_JWT_ISSUER_DOMAIN?: string;
	};
};

const clerkJwtIssuerDomain =
	process.env.CLERK_FRONTEND_API_URL ?? process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!clerkJwtIssuerDomain) {
	throw new Error(
		"CLERK_FRONTEND_API_URL or CLERK_JWT_ISSUER_DOMAIN must be set",
	);
}

export default {
	providers: [
		{
			domain: clerkJwtIssuerDomain,
			applicationID: "convex",
		},
	],
} satisfies AuthConfig;
