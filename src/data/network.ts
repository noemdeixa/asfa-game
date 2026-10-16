import segments from './segments.json';
import stations from './stations.json';

export interface Station {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
}

export type SegmentType = 'AVE' | 'RAM' | 'IBE';

export interface Segment {
	from: string;
	to: string;
	segmentTypes: SegmentType[];
}

export const STATIONS: Station[] = stations;
export const SEGMENTS: Segment[] = segments as Segment[];