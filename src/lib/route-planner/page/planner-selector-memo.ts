export function createMemoizedSelector<
	TDeps extends readonly unknown[],
	TValue,
>(compute: (...deps: TDeps) => TValue): (...deps: TDeps) => TValue {
	let hasValue = false;
	let previousDeps: TDeps | null = null;
	let previousValue: TValue;

	return (...deps: TDeps): TValue => {
		if (
			hasValue &&
			previousDeps &&
			previousDeps.length === deps.length &&
			previousDeps.every((dependency, index) =>
				Object.is(dependency, deps[index]),
			)
		) {
			return previousValue;
		}

		previousDeps = deps;
		previousValue = compute(...deps);
		hasValue = true;
		return previousValue;
	};
}
