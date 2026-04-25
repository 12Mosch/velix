export type CoordinateSearchParseResult =
	| { kind: "coordinate"; label: string; point: [number, number] }
	| { kind: "invalid_coordinate"; message: string }
	| { kind: "not_coordinate" };

const numberPattern = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const labeledCoordinatePattern = new RegExp(
	`\\b(lat|latitude|lng|lon|long|longitude)\\b\\s*[:=]\\s*(${numberPattern})`,
	"gi",
);
const standalonePairPattern = new RegExp(
	`^\\s*(${numberPattern})\\s*(?:,|\\s+)\\s*(${numberPattern})\\s*$`,
);

export function isValidLatitude(value: number) {
	return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number) {
	return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function formatCoordinateLabel(point: [number, number]) {
	return `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
}

function coordinateResult(
	latitude: number,
	longitude: number,
): CoordinateSearchParseResult {
	if (!isValidLatitude(latitude)) {
		return {
			kind: "invalid_coordinate",
			message: "Latitude must be between -90 and 90.",
		};
	}

	if (!isValidLongitude(longitude)) {
		return {
			kind: "invalid_coordinate",
			message: "Longitude must be between -180 and 180.",
		};
	}

	const point: [number, number] = [longitude, latitude];

	return {
		kind: "coordinate",
		label: formatCoordinateLabel(point),
		point,
	};
}

function isUrlLike(value: string) {
	return /\bhttps?:\/\//i.test(value) || /\bwww\./i.test(value);
}

function parseLabeledCoordinateSearchInput(
	value: string,
): CoordinateSearchParseResult {
	const matches = [...value.matchAll(labeledCoordinatePattern)];

	if (matches.length === 0) {
		return { kind: "not_coordinate" };
	}

	let latitude: number | undefined;
	let longitude: number | undefined;
	const occupiedRanges: Array<[number, number]> = [];

	for (const match of matches) {
		const [, rawLabel = "", rawValue = ""] = match;
		const label = rawLabel.toLowerCase();
		const matchIndex = match.index ?? 0;

		const numericValue = Number(rawValue);

		if (label === "lat" || label === "latitude") {
			if (latitude !== undefined) {
				return {
					kind: "invalid_coordinate",
					message: "Enter one latitude and one longitude.",
				};
			}
			latitude = numericValue;
		} else {
			if (longitude !== undefined) {
				return {
					kind: "invalid_coordinate",
					message: "Enter one latitude and one longitude.",
				};
			}
			longitude = numericValue;
		}

		occupiedRanges.push([matchIndex, matchIndex + match[0].length]);
	}

	let trailingText = "";
	let cursor = 0;

	for (const [start, end] of occupiedRanges) {
		trailingText += value.slice(cursor, start);
		cursor = end;
	}

	trailingText += value.slice(cursor);

	if (/[^\s,;]+/.test(trailingText)) {
		return {
			kind: "invalid_coordinate",
			message: "Enter only decimal latitude and longitude coordinates.",
		};
	}

	if (latitude === undefined || longitude === undefined) {
		return {
			kind: "invalid_coordinate",
			message: "Enter both latitude and longitude.",
		};
	}

	return coordinateResult(latitude, longitude);
}

export function parseCoordinateSearchInput(
	value: string,
): CoordinateSearchParseResult {
	const trimmedValue = value.trim();

	if (
		!trimmedValue ||
		isUrlLike(trimmedValue) ||
		/[°'"′″]/.test(trimmedValue)
	) {
		return { kind: "not_coordinate" };
	}

	const labeledResult = parseLabeledCoordinateSearchInput(trimmedValue);

	if (labeledResult.kind !== "not_coordinate") {
		return labeledResult;
	}

	const pairMatch = trimmedValue.match(standalonePairPattern);

	if (!pairMatch) {
		return { kind: "not_coordinate" };
	}

	return coordinateResult(Number(pairMatch[1]), Number(pairMatch[2]));
}
