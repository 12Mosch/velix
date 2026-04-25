declare const process: {
	env: {
		CLERK_JWT_ISSUER_DOMAIN?: string;
	};
};

const clerkJwtIssuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!clerkJwtIssuerDomain) {
	throw new Error("CLERK_JWT_ISSUER_DOMAIN must be set");
}

export default {
	providers: [
		{
			domain: clerkJwtIssuerDomain,
			applicationID: "convex",
		},
	],
};
