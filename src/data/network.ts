export interface Station {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
}

export interface Segment {
	from: string;
	to: string;
	distanceKm: number;
	maxSpeedKmh: number;
}

export const STATIONS: Station[] = [
	{ id: 'mad', name: 'Madrid-Atocha', latitude: 40.4066, longitude: -3.6891 },
	{ id: 'gua', name: 'Guadalajara-Yebes', latitude: 40.5247, longitude: -3.1088 },
	{ id: 'cal', name: 'Calatayud', latitude: 41.3453, longitude: -1.6502 },
	{ id: 'zar', name: 'Zaragoza-Delicias', latitude: 41.6587, longitude: -0.9114 },
	{ id: 'lle', name: 'Lleida Pirineus', latitude: 41.6160, longitude: 0.6270 },
	{ id: 'tar', name: 'Camp de Tarragona', latitude: 41.1890, longitude: 1.2690 },
	{ id: 'bar', name: 'Barcelona-Sants', latitude: 41.3790, longitude: 2.1400 },
];

// Approximate rail distances for the main-line stops; this simplified model omits intermediate stops.
export const SEGMENTS: Segment[] = [
	{ from: 'mad', to: 'gua', distanceKm: 64, maxSpeedKmh: 300 },
	{ from: 'gua', to: 'cal', distanceKm: 160, maxSpeedKmh: 300 },
	{ from: 'cal', to: 'zar', distanceKm: 82, maxSpeedKmh: 300 },
	{ from: 'zar', to: 'lle', distanceKm: 148, maxSpeedKmh: 300 },
	{ from: 'lle', to: 'tar', distanceKm: 83, maxSpeedKmh: 300 },
	{ from: 'tar', to: 'bar', distanceKm: 100, maxSpeedKmh: 300 },
];