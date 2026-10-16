import type { Segment, SegmentType, Station } from '../data/network';

const EARTH_RADIUS_KM = 6371.0088;
const MAX_SPEED_KMH: Record<SegmentType, number> = {
	AVE: 300,
	IBE: 200,
	RAM: 100,
};

export interface Neighbour {
	station: Station;
	segment: Segment;
}

export function buildAdjacency(
		stations: Station[],
		segments: Segment[],
	): Map<string, Neighbour[]> {

	const byId = new Map(stations.map(s => [s.id, s]));
	const adj = new Map<string, Neighbour[]>();
	for (const s of stations) adj.set(s.id, []);

	const add = (fromId: string, toId: string, seg: Segment) => {
		const to = byId.get(toId);
		if (!to) return;
		adj.get(fromId)!.push({ station: to, segment: seg });
	};

	for (const seg of segments) {
		add(seg.from, seg.to, seg);
		add(seg.to, seg.from, seg);
	}
	return adj;
}

export function segmentDurationSec(seg: Segment, stations: Station[]): number {
	const fromMatches = stations.filter((station) => station.id === seg.from);
	const toMatches = stations.filter((station) => station.id === seg.to);
	if (fromMatches.length !== 1 || toMatches.length !== 1) {
		throw new Error(`Segment ${seg.from} -> ${seg.to} must reference unique station IDs.`);
	}

	const [from] = fromMatches;
	const [to] = toMatches;
	const coordinates = [from.latitude, from.longitude, to.latitude, to.longitude];
	if (!coordinates.every(Number.isFinite)) {
		throw new Error(`Segment ${seg.from} -> ${seg.to} has invalid station coordinates.`);
	}
	if (seg.segmentTypes.length === 0) {
		throw new Error(`Segment ${seg.from} -> ${seg.to} must have at least one segment type.`);
	}

	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
	const latitudeDelta = toRadians(to.latitude - from.latitude);
	const longitudeDelta = toRadians(to.longitude - from.longitude);
	const haversine =
		Math.sin(latitudeDelta / 2) ** 2 +
		Math.cos(toRadians(from.latitude)) *
			Math.cos(toRadians(to.latitude)) *
			Math.sin(longitudeDelta / 2) ** 2;
	const distanceKm =
		2 *
		EARTH_RADIUS_KM *
		Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - Math.min(1, haversine)));

	const maxSpeedKmh = Math.max(
		...seg.segmentTypes.map((type) => {
			const speed = MAX_SPEED_KMH[type];
			if (speed === undefined) {
				throw new Error(`Segment ${seg.from} -> ${seg.to} has unknown type "${type}".`);
			}
			return speed;
		}),
	);

	// This is straight-line distance from coordinates, not the distance along the tracks.
	return (distanceKm / maxSpeedKmh) * 3600;
}