import { Effect, Schema } from "effect";

export const WorkoutPlanValidationErrorSchema = Schema.Struct({
	line: Schema.Finite,
	message: Schema.String,
});

export const WorkoutTargetDomainSchema = Schema.Literals([
	"heart_rate",
	"lthr",
	"ftp",
	"power",
]);

export const WorkoutCadenceTargetSchema = Schema.Struct({
	minRpm: Schema.Finite,
	maxRpm: Schema.Finite,
});

export const WorkoutIntensityTargetSchema = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("zone"),
		domain: Schema.Literals(["heart_rate", "power"]),
		minZone: Schema.Finite,
		maxZone: Schema.Finite,
	}),
	Schema.Struct({
		kind: Schema.Literal("percent"),
		domain: WorkoutTargetDomainSchema,
		minPercent: Schema.Finite,
		maxPercent: Schema.Finite,
	}),
]);

export const WorkoutStepTargetSchema = Schema.Struct({
	raw: Schema.String,
	intensity: Schema.optionalKey(
		Schema.UndefinedOr(WorkoutIntensityTargetSchema),
	),
	cadence: Schema.optionalKey(Schema.UndefinedOr(WorkoutCadenceTargetSchema)),
});

export const WorkoutPlanStepSchema = Schema.Struct({
	durationMs: Schema.Finite,
	line: Schema.Finite,
	target: Schema.NullOr(WorkoutStepTargetSchema),
});

export const WorkoutTrainingSessionKindSchema = Schema.Literals([
	"recovery",
	"endurance",
	"tempo",
	"threshold",
	"intervals",
	"mixed",
]);

export const WorkoutTrainingProfileSchema = Schema.Struct({
	version: Schema.Literal(1),
	durationMs: Schema.Finite,
	expandedStepCount: Schema.Finite,
	weightedIntensity: Schema.Finite,
	estimatedDistanceMeters: Schema.Finite,
	recoveryShare: Schema.Finite,
	enduranceShare: Schema.Finite,
	tempoShare: Schema.Finite,
	thresholdShare: Schema.Finite,
	highIntensityShare: Schema.Finite,
	cadenceTargetShare: Schema.Finite,
	longestWorkIntervalMs: Schema.Finite,
	sessionKind: WorkoutTrainingSessionKindSchema,
});

export const WorkoutEstimateSchema = Schema.Struct({
	durationMs: Schema.Finite,
	distanceMeters: Schema.Finite,
	estimatedSpeedMetersPerHour: Schema.Finite,
	weightedIntensity: Schema.Finite,
	trainingProfile: WorkoutTrainingProfileSchema,
});

export const WorkoutPlanParseResultSchema = Schema.Struct({
	totalDurationMs: Schema.Finite,
	parsedStepCount: Schema.Finite,
	expandedStepCount: Schema.Finite,
	repeatCount: Schema.Finite,
	errors: Schema.mutable(Schema.Array(WorkoutPlanValidationErrorSchema)),
	steps: Schema.mutable(Schema.Array(WorkoutPlanStepSchema)),
	expandedSteps: Schema.mutable(Schema.Array(WorkoutPlanStepSchema)),
});

export type WorkoutPlanValidationError =
	typeof WorkoutPlanValidationErrorSchema.Type;
export type WorkoutTargetDomain = typeof WorkoutTargetDomainSchema.Type;
export type WorkoutCadenceTarget = typeof WorkoutCadenceTargetSchema.Type;
export type WorkoutIntensityTarget = typeof WorkoutIntensityTargetSchema.Type;
export type WorkoutStepTarget = typeof WorkoutStepTargetSchema.Type;
export type WorkoutPlanStep = typeof WorkoutPlanStepSchema.Type;
export type WorkoutTrainingSessionKind =
	typeof WorkoutTrainingSessionKindSchema.Type;
export type WorkoutTrainingProfile = typeof WorkoutTrainingProfileSchema.Type;
export type WorkoutEstimate = typeof WorkoutEstimateSchema.Type;
export type WorkoutPlanParseResult = typeof WorkoutPlanParseResultSchema.Type;

const decodeWorkoutPlanParseResult = Schema.decodeUnknownSync(
	WorkoutPlanParseResultSchema,
);
const decodeWorkoutTrainingProfile = Schema.decodeUnknownSync(
	WorkoutTrainingProfileSchema,
);
const decodeWorkoutEstimate = Schema.decodeUnknownSync(WorkoutEstimateSchema);

type WorkoutLine = {
	line: number;
	indent: number;
	text: string;
};

type ParsedStep = WorkoutPlanStep;

type ParsedBlock = {
	steps: ParsedStep[];
	expandedSteps: ParsedStep[];
	repeatCount: number;
	nextIndex: number;
	errors: WorkoutPlanValidationError[];
};

const repeatHeaderPattern = /^(?:(.+?)\s+)?(\d+)\s*x$/i;
const maxWorkoutStepDurationMs = 24 * 60 * 60 * 1000;
const maxWorkoutRepeatCount = 1_000;

function cloneWorkoutPlanStep(step: ParsedStep): ParsedStep {
	return {
		...step,
		target: step.target
			? {
					...step.target,
					intensity: step.target.intensity
						? { ...step.target.intensity }
						: undefined,
					cadence: step.target.cadence ? { ...step.target.cadence } : undefined,
				}
			: null,
	};
}

function normalizeLine(rawLine: string, index: number): WorkoutLine {
	const leadingWhitespace = rawLine.match(/^\s*/)?.[0] ?? "";
	const indent = [...leadingWhitespace].reduce(
		(total, char) => total + (char === "\t" ? 2 : 1),
		0,
	);
	const text = rawLine
		.trim()
		.replace(/^[-*•]\s+/, "")
		.replace(/^\d+[.)]\s+/, "")
		.trim();

	return {
		line: index + 1,
		indent,
		text,
	};
}

function parseDurationPrefix(
	text: string,
): { durationMs: number; rest: string } | null {
	const quoteMatch = text.match(/^(\d+)'\s*(?:(\d+)")?(.*)$/);
	if (quoteMatch) {
		const minutes = Number(quoteMatch[1]);
		const seconds = quoteMatch[2] ? Number(quoteMatch[2]) : 0;
		const durationMs = (minutes * 60 + seconds) * 1000;

		return {
			durationMs,
			rest: quoteMatch[3]?.trim() ?? "",
		};
	}

	const secondsQuoteMatch = text.match(/^(\d+)"(.*)$/);
	if (secondsQuoteMatch) {
		const seconds = Number(secondsQuoteMatch[1]);

		return {
			durationMs: seconds * 1000,
			rest: secondsQuoteMatch[2]?.trim() ?? "",
		};
	}

	const unitMatch = text.match(
		/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?=\s|$)(.*)$/i,
	);
	if (!unitMatch || (!unitMatch[1] && !unitMatch[2] && !unitMatch[3])) {
		return null;
	}

	const hours = unitMatch[1] ? Number(unitMatch[1]) : 0;
	const minutes = unitMatch[2] ? Number(unitMatch[2]) : 0;
	const seconds = unitMatch[3] ? Number(unitMatch[3]) : 0;
	const durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

	return {
		durationMs,
		rest: unitMatch[4]?.trim() ?? "",
	};
}

function hasDurationPrefix(text: string): boolean {
	return parseDurationPrefix(text) !== null;
}

function parseRange(value: string): { min: number; max: number } | null {
	const match = value.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/);

	if (!match) {
		return null;
	}

	const first = Number(match[1]);
	const second = match[2] ? Number(match[2]) : first;

	if (!Number.isFinite(first) || !Number.isFinite(second)) {
		return null;
	}

	return {
		min: Math.min(first, second),
		max: Math.max(first, second),
	};
}

function parseCadenceTarget(target: string): {
	remaining: string;
	cadence?: WorkoutCadenceTarget;
} {
	const cadenceMatch = target.match(/\b(\d+(?:\s*-\s*\d+)?)\s*rpm\b/i);

	if (!cadenceMatch) {
		return { remaining: target };
	}

	const range = parseRange(cadenceMatch[1].replace(/\s+/g, ""));

	return {
		remaining: target.replace(cadenceMatch[0], "").trim(),
		...(range
			? {
					cadence: {
						minRpm: range.min,
						maxRpm: range.max,
					},
				}
			: {}),
	};
}

function parseZoneToken(
	value: string,
): { minZone: number; maxZone: number } | null {
	const match = value.match(
		/^(?:z|zone)\s*([1-7])(?:\s*-\s*(?:(?:z|zone)\s*)?([1-7]))?$/i,
	);

	if (!match) {
		return null;
	}

	const first = Number(match[1]);
	const second = match[2] ? Number(match[2]) : first;

	return {
		minZone: Math.min(first, second),
		maxZone: Math.max(first, second),
	};
}

function parseWorkoutIntensityTarget(
	target: string,
): WorkoutIntensityTarget | null {
	const compact = target.replace(/\s+/g, " ").trim();
	const hrZoneMatch = compact.match(
		/^(?:(?:hr|max\s*hr)\s*)?((?:z|zone)\s*[1-7](?:\s*-\s*(?:(?:z|zone)\s*)?[1-7])?)(?:\s*(?:hr|max\s*hr))?$/i,
	);
	const hrZone = hrZoneMatch ? parseZoneToken(hrZoneMatch[1]) : null;

	if (hrZone) {
		return {
			kind: "zone",
			domain: "heart_rate",
			...hrZone,
		};
	}

	const powerZoneMatch = compact.match(
		/^(?:power\s*)?((?:z|zone)\s*[1-7](?:\s*-\s*(?:(?:z|zone)\s*)?[1-7])?)(?:\s*(?:power|watts?))?$/i,
	);
	const powerZone = powerZoneMatch ? parseZoneToken(powerZoneMatch[1]) : null;

	if (powerZone) {
		return {
			kind: "zone",
			domain: "power",
			...powerZone,
		};
	}

	const percentAfterMatch = compact.match(
		/^(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*%\s*(hr|max\s*hr|lthr|ftp)$/i,
	);
	const percentBeforeMatch = compact.match(
		/^(hr|max\s*hr|lthr|ftp)\s*(\d{1,3}(?:\s*-\s*\d{1,3})?)\s*%$/i,
	);
	const percentValue = percentAfterMatch?.[1] ?? percentBeforeMatch?.[2];
	const percentDomain = percentAfterMatch?.[2] ?? percentBeforeMatch?.[1];
	const percentRangeValue = percentValue ? parseRange(percentValue) : null;

	if (percentRangeValue && percentDomain) {
		const normalizedDomain = percentDomain.toLowerCase().replace(/\s+/g, " ");
		const domain: WorkoutTargetDomain =
			normalizedDomain === "ftp"
				? "ftp"
				: normalizedDomain === "lthr"
					? "lthr"
					: "heart_rate";

		return {
			kind: "percent",
			domain,
			minPercent: percentRangeValue.min,
			maxPercent: percentRangeValue.max,
		};
	}

	return null;
}

function parseStepTarget(target: string): WorkoutStepTarget | null {
	let remaining = target.replace(/^@\s*/, "").replace(/\s+/g, " ").trim();
	const cadenceParse = parseCadenceTarget(remaining);
	remaining = cadenceParse.remaining.replace(/\s+/g, " ").trim();

	const intensity = remaining ? parseWorkoutIntensityTarget(remaining) : null;

	if (remaining && !intensity) {
		return null;
	}

	return {
		raw: target.trim(),
		...(intensity ? { intensity } : {}),
		...(cadenceParse.cadence ? { cadence: cadenceParse.cadence } : {}),
	};
}

function parseStep(line: WorkoutLine): {
	step: ParsedStep | null;
	error: WorkoutPlanValidationError | null;
} {
	const parsedDuration = parseDurationPrefix(line.text);

	if (!parsedDuration) {
		return {
			step: null,
			error: { line: line.line, message: "Expected an interval duration." },
		};
	}

	if (parsedDuration.durationMs <= 0) {
		return {
			step: null,
			error: {
				line: line.line,
				message: "Duration must be greater than zero.",
			},
		};
	}

	if (!Number.isFinite(parsedDuration.durationMs)) {
		return {
			step: null,
			error: {
				line: line.line,
				message: "Duration must be a finite value.",
			},
		};
	}

	if (parsedDuration.durationMs > maxWorkoutStepDurationMs) {
		return {
			step: null,
			error: {
				line: line.line,
				message: "Duration is too large.",
			},
		};
	}

	const target = parsedDuration.rest
		? parseStepTarget(parsedDuration.rest)
		: null;

	if (parsedDuration.rest && !target) {
		return {
			step: null,
			error: {
				line: line.line,
				message: `Unsupported workout target "${parsedDuration.rest}".`,
			},
		};
	}

	return {
		step: {
			durationMs: parsedDuration.durationMs,
			line: line.line,
			target,
		},
		error: null,
	};
}

function parseIndentedBlock(
	lines: WorkoutLine[],
	startIndex: number,
	blockIndent: number,
): ParsedBlock {
	const steps: ParsedStep[] = [];
	const expandedSteps: ParsedStep[] = [];
	const errors: WorkoutPlanValidationError[] = [];
	let repeatCount = 0;
	let index = startIndex;

	while (index < lines.length) {
		const line = lines[index];

		if (!line || line.indent < blockIndent) {
			break;
		}

		if (line.indent > blockIndent) {
			errors.push({
				line: line.line,
				message: "Unexpected indentation outside a repeat block.",
			});
			index += 1;
			continue;
		}

		const repeatMatch = line.text.match(repeatHeaderPattern);
		if (repeatMatch) {
			const repeat = Number(repeatMatch[2]);
			const childStart = index + 1;
			const childIndent = lines[childStart]?.indent ?? blockIndent;

			if (repeat < 2) {
				errors.push({
					line: line.line,
					message: "Repeat blocks must repeat at least twice.",
				});
				index += 1;
				continue;
			}

			if (!Number.isFinite(repeat) || repeat > maxWorkoutRepeatCount) {
				errors.push({
					line: line.line,
					message: `Repeat blocks cannot repeat more than ${maxWorkoutRepeatCount} times.`,
				});
				if (childStart < lines.length && childIndent > blockIndent) {
					index = childStart;
					while (
						index < lines.length &&
						(lines[index]?.indent ?? blockIndent) >= childIndent
					) {
						index += 1;
					}
				} else {
					index = parseFlatRepeatBlock(
						lines,
						childStart,
						blockIndent,
					).nextIndex;
				}
				continue;
			}

			if (childStart >= lines.length || childIndent <= blockIndent) {
				const flatBlock = parseFlatRepeatBlock(lines, childStart, blockIndent);
				if (flatBlock.steps.length === 0) {
					errors.push({
						line: line.line,
						message: "Repeat block must contain at least one step.",
					});
					index += 1;
					continue;
				}

				steps.push(...flatBlock.steps.map(cloneWorkoutPlanStep));
				for (let count = 0; count < repeat; count += 1) {
					expandedSteps.push(
						...flatBlock.expandedSteps.map(cloneWorkoutPlanStep),
					);
				}
				repeatCount += 1 + flatBlock.repeatCount;
				errors.push(...flatBlock.errors);
				index = flatBlock.nextIndex;
				continue;
			}

			const block = parseIndentedBlock(lines, childStart, childIndent);
			if (block.steps.length === 0) {
				errors.push({
					line: line.line,
					message: "Repeat block must contain at least one step.",
				});
			}

			steps.push(...block.steps.map(cloneWorkoutPlanStep));
			for (let count = 0; count < repeat; count += 1) {
				expandedSteps.push(...block.expandedSteps.map(cloneWorkoutPlanStep));
			}
			repeatCount += 1 + block.repeatCount;
			errors.push(...block.errors);
			index = block.nextIndex;
			continue;
		}

		if (hasDurationPrefix(line.text)) {
			const parsed = parseStep(line);
			if (parsed.step) {
				steps.push(parsed.step);
				expandedSteps.push(parsed.step);
			}
			if (parsed.error) {
				errors.push(parsed.error);
			}
		} else if (/^\d/.test(line.text)) {
			errors.push({
				line: line.line,
				message: "Expected a duration like 30s, 5m, or 1h30m.",
			});
		} else if ((lines[index + 1]?.indent ?? line.indent) > line.indent) {
			const block = parseIndentedBlock(
				lines,
				index + 1,
				lines[index + 1].indent,
			);
			steps.push(...block.steps);
			expandedSteps.push(...block.expandedSteps);
			repeatCount += block.repeatCount;
			errors.push(...block.errors);
			index = block.nextIndex;
			continue;
		}

		index += 1;
	}

	return {
		steps,
		expandedSteps,
		repeatCount,
		nextIndex: index,
		errors,
	};
}

function parseFlatRepeatBlock(
	lines: WorkoutLine[],
	startIndex: number,
	blockIndent: number,
): ParsedBlock {
	const steps: ParsedStep[] = [];
	const expandedSteps: ParsedStep[] = [];
	const errors: WorkoutPlanValidationError[] = [];
	let index = startIndex;

	while (index < lines.length) {
		const line = lines[index];

		if (!line || line.indent !== blockIndent || !hasDurationPrefix(line.text)) {
			break;
		}

		const parsed = parseStep(line);
		if (parsed.step) {
			steps.push(parsed.step);
			expandedSteps.push(parsed.step);
		}
		if (parsed.error) {
			errors.push(parsed.error);
		}
		index += 1;
	}

	return {
		steps,
		expandedSteps,
		repeatCount: 0,
		nextIndex: index,
		errors,
	};
}

function parseWorkoutPlanSync(input: string): WorkoutPlanParseResult {
	const lines = input
		.split(/\r?\n/)
		.map(normalizeLine)
		.filter((line) => line.text.length > 0);

	if (lines.length === 0) {
		return {
			totalDurationMs: 0,
			parsedStepCount: 0,
			expandedStepCount: 0,
			repeatCount: 0,
			errors: [],
			steps: [],
			expandedSteps: [],
		};
	}

	const block = parseIndentedBlock(
		lines,
		0,
		Math.min(...lines.map((l) => l.indent)),
	);
	const totalDurationMs = block.expandedSteps.reduce(
		(total, step) => total + step.durationMs,
		0,
	);
	if (!Number.isFinite(totalDurationMs)) {
		return {
			totalDurationMs: 0,
			parsedStepCount: block.steps.length,
			expandedStepCount: block.expandedSteps.length,
			repeatCount: block.repeatCount,
			errors: [
				...block.errors,
				{
					line: lines[0]?.line ?? 1,
					message: "Workout duration must be a finite value.",
				},
			],
			steps: block.steps,
			expandedSteps: block.expandedSteps,
		};
	}

	return {
		totalDurationMs,
		parsedStepCount: block.steps.length,
		expandedStepCount: block.expandedSteps.length,
		repeatCount: block.repeatCount,
		errors: block.errors,
		steps: block.steps,
		expandedSteps: block.expandedSteps,
	};
}

export function parseWorkoutPlanEffect(
	input: string,
): Effect.Effect<WorkoutPlanParseResult> {
	return Effect.sync(() =>
		decodeWorkoutPlanParseResult(parseWorkoutPlanSync(input)),
	);
}

export function parseWorkoutPlan(input: string): WorkoutPlanParseResult {
	return Effect.runSync(parseWorkoutPlanEffect(input));
}

export const neutralWorkoutSpeedMetersPerHour = 22_000;
const neutralWorkoutIntensity = 0.7;
const zoneIntensityDefaults = new Map<number, number>([
	[1, 0.55],
	[2, 0.7],
	[3, 0.82],
	[4, 0.95],
	[5, 1.08],
	[6, 1.2],
	[7, 1.3],
]);

function getZoneIntensity(zone: number): number {
	return zoneIntensityDefaults.get(zone) ?? neutralWorkoutIntensity;
}

function getStepIntensity(step: WorkoutPlanStep): number {
	const intensityTarget = step.target?.intensity;

	if (!intensityTarget) {
		return neutralWorkoutIntensity;
	}

	if (intensityTarget.kind === "percent") {
		return (intensityTarget.minPercent + intensityTarget.maxPercent) / 200;
	}

	return (
		(getZoneIntensity(intensityTarget.minZone) +
			getZoneIntensity(intensityTarget.maxZone)) /
		2
	);
}

export function estimateWorkoutSpeedMetersPerHour(intensity: number): number {
	const normalizedIntensity =
		Number.isFinite(intensity) && intensity > 0
			? intensity
			: neutralWorkoutIntensity;

	return (
		neutralWorkoutSpeedMetersPerHour *
		Math.cbrt(normalizedIntensity / neutralWorkoutIntensity)
	);
}

function getWorkoutSessionKind({
	recoveryShare,
	enduranceShare,
	tempoShare,
	thresholdShare,
	highIntensityShare,
	longestWorkIntervalMs,
	workIntervalCount,
}: {
	recoveryShare: number;
	enduranceShare: number;
	tempoShare: number;
	thresholdShare: number;
	highIntensityShare: number;
	longestWorkIntervalMs: number;
	workIntervalCount: number;
}): WorkoutTrainingSessionKind {
	if (recoveryShare >= 0.65) return "recovery";
	if (enduranceShare >= 0.55 && highIntensityShare < 0.1) return "endurance";
	if (thresholdShare >= 0.25) return "threshold";
	if (
		highIntensityShare >= 0.12 ||
		(workIntervalCount > 1 &&
			longestWorkIntervalMs > 0 &&
			longestWorkIntervalMs <= 8 * 60 * 1000)
	) {
		return "intervals";
	}
	if (tempoShare >= 0.3) return "tempo";
	return "mixed";
}

export function analyzeWorkoutTrainingProfile(
	steps: readonly WorkoutPlanStep[],
): WorkoutTrainingProfile {
	const totals = steps.reduce(
		(accumulator, step) => {
			const intensity = getStepIntensity(step);
			const speedMetersPerHour = estimateWorkoutSpeedMetersPerHour(intensity);
			const hours = step.durationMs / (60 * 60 * 1000);

			accumulator.durationMs += step.durationMs;
			accumulator.estimatedDistanceMeters += speedMetersPerHour * hours;
			accumulator.intensityDurationMs += intensity * step.durationMs;
			accumulator.cadenceDurationMs += step.target?.cadence
				? step.durationMs
				: 0;

			if (intensity < 0.6) {
				accumulator.recoveryMs += step.durationMs;
			} else if (intensity < 0.78) {
				accumulator.enduranceMs += step.durationMs;
			} else if (intensity < 0.9) {
				accumulator.tempoMs += step.durationMs;
			} else if (intensity < 1.05) {
				accumulator.thresholdMs += step.durationMs;
				accumulator.workIntervalCount += 1;
				accumulator.longestWorkIntervalMs = Math.max(
					accumulator.longestWorkIntervalMs,
					step.durationMs,
				);
			} else {
				accumulator.highIntensityMs += step.durationMs;
				accumulator.workIntervalCount += 1;
				accumulator.longestWorkIntervalMs = Math.max(
					accumulator.longestWorkIntervalMs,
					step.durationMs,
				);
			}

			return accumulator;
		},
		{
			durationMs: 0,
			estimatedDistanceMeters: 0,
			intensityDurationMs: 0,
			recoveryMs: 0,
			enduranceMs: 0,
			tempoMs: 0,
			thresholdMs: 0,
			highIntensityMs: 0,
			cadenceDurationMs: 0,
			longestWorkIntervalMs: 0,
			workIntervalCount: 0,
		},
	);
	const share = (durationMs: number) =>
		totals.durationMs > 0 ? durationMs / totals.durationMs : 0;
	const weightedIntensity =
		totals.durationMs > 0
			? totals.intensityDurationMs / totals.durationMs
			: neutralWorkoutIntensity;
	const recoveryShare = share(totals.recoveryMs);
	const enduranceShare = share(totals.enduranceMs);
	const tempoShare = share(totals.tempoMs);
	const thresholdShare = share(totals.thresholdMs);
	const highIntensityShare = share(totals.highIntensityMs);

	return decodeWorkoutTrainingProfile({
		version: 1,
		durationMs: totals.durationMs,
		expandedStepCount: steps.length,
		weightedIntensity,
		estimatedDistanceMeters: totals.estimatedDistanceMeters,
		recoveryShare,
		enduranceShare,
		tempoShare,
		thresholdShare,
		highIntensityShare,
		cadenceTargetShare: share(totals.cadenceDurationMs),
		longestWorkIntervalMs: totals.longestWorkIntervalMs,
		sessionKind: getWorkoutSessionKind({
			recoveryShare,
			enduranceShare,
			tempoShare,
			thresholdShare,
			highIntensityShare,
			longestWorkIntervalMs: totals.longestWorkIntervalMs,
			workIntervalCount: totals.workIntervalCount,
		}),
	});
}

export function analyzeWorkoutTrainingProfileEffect(
	steps: readonly WorkoutPlanStep[],
): Effect.Effect<WorkoutTrainingProfile> {
	return Effect.sync(() => analyzeWorkoutTrainingProfile(steps));
}

function estimateWorkoutTargetSync(
	steps: readonly WorkoutPlanStep[],
): WorkoutEstimate {
	const trainingProfile = analyzeWorkoutTrainingProfile(steps);

	return {
		durationMs: trainingProfile.durationMs,
		distanceMeters: trainingProfile.estimatedDistanceMeters,
		estimatedSpeedMetersPerHour:
			trainingProfile.durationMs > 0
				? trainingProfile.estimatedDistanceMeters /
					(trainingProfile.durationMs / (60 * 60 * 1000))
				: estimateWorkoutSpeedMetersPerHour(neutralWorkoutIntensity),
		weightedIntensity: trainingProfile.weightedIntensity,
		trainingProfile,
	};
}

export function estimateWorkoutTargetEffect(
	steps: readonly WorkoutPlanStep[],
): Effect.Effect<WorkoutEstimate> {
	return Effect.sync(() =>
		decodeWorkoutEstimate(estimateWorkoutTargetSync(steps)),
	);
}

export function estimateWorkoutTarget(
	steps: readonly WorkoutPlanStep[],
): WorkoutEstimate {
	return Effect.runSync(estimateWorkoutTargetEffect(steps));
}
