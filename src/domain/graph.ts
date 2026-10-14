import type { Segment, Station } from '../data/network';

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

export function segmentDurationSec(seg: Segment): number {
	// Naïve: full distance at line speed, no accel/decel.
	return (seg.distanceKm / seg.maxSpeedKmh) * 3600;
}