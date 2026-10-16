import { readFile } from 'node:fs/promises';

const query = process.argv.slice(2).join(' ').trim();

function normalizeStationName(name) {
	return name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

function generateStationId(name, usedIds) {
	const words = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.match(/[a-z]+/g) ?? [];
	const candidates = [
		...words.map((word) => word.slice(0, 3)),
		...words.flatMap((word) =>
			Array.from({ length: Math.max(0, word.length - 2) }, (_, index) =>
				word.slice(index, index + 3),
			),
		),
	];

	for (const candidate of candidates) {
		if (candidate.length === 3 && !usedIds.has(candidate)) {
			usedIds.add(candidate);
			return candidate;
		}
	}

	const seed = words.join('') || name.toLowerCase();
	let hash = 2166136261;
	for (const character of seed) {
		hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
	}

	for (let offset = 0; offset < 26 ** 3; offset += 1) {
		let value = (hash + offset) >>> 0;
		let candidate = '';
		for (let index = 0; index < 3; index += 1) {
			candidate = String.fromCharCode(97 + (value % 26)) + candidate;
			value = Math.floor(value / 26);
		}
		if (!usedIds.has(candidate)) {
			usedIds.add(candidate);
			return candidate;
		}
	}

	throw new Error('Could not generate a unique three-letter station ID.');
}

if (!query) {
	console.error('Usage: npm run find-station -- "<station name>"');
	console.error('Example: npm run find-station -- "madrid atocha"');
	process.exitCode = 1;
} else {
	try {
		async function searchStations(searchQuery) {
			const url = new URL('https://nominatim.openstreetmap.org/search');
			url.searchParams.set('q', searchQuery);
			url.searchParams.set('countrycodes', 'es,fr,pr');
			url.searchParams.set('format', 'jsonv2');
			url.searchParams.set('limit', '10');
			url.searchParams.set('namedetails', '1');

			const response = await fetch(url, {
				headers: {
					'User-Agent': 'ASFA-Game-Station-Lookup/1.0 (local development utility)',
				},
				signal: AbortSignal.timeout(15000),
			});

			if (!response.ok) {
				throw new Error(`OpenStreetMap search failed: HTTP ${response.status} ${response.statusText}`);
			}

			const results = await response.json();
			if (!Array.isArray(results)) {
				throw new Error('OpenStreetMap returned an unexpected response.');
			}

			return results.filter((result) =>
				result.category === 'railway' &&
				result.type === 'station' &&
				Number.isFinite(Number(result.lat)) &&
				Number.isFinite(Number(result.lon)),
			);
		}

		const searchQueries = [
			`${query} railway station`,
			`${query} train station`,
			`${query} estación de tren`,
			query,
		];
		const foundStations = new Map();

		for (const [index, searchQuery] of searchQueries.entries()) {
			if (index > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1100));
			}

			for (const station of await searchStations(searchQuery)) {
				foundStations.set(`${station.osm_type}/${station.osm_id}`, station);
			}

			if (foundStations.size > 0) {
				if (index > 0) {
					console.log(`Found station results using the search "${searchQuery}".`);
				}
				break;
			}
		}

		const stations = [...foundStations.values()];

		if (stations.length === 0) {
			console.log(`No train stations found for "${query}". Try adding the city or country.`);
		} else {
			const existingStations = JSON.parse(
				await readFile(new URL('../src/data/stations.json', import.meta.url), 'utf8'),
			);
			if (!Array.isArray(existingStations)) {
				throw new Error('The stations data file must contain a JSON array.');
			}
			const usedIds = new Set(existingStations.map((station) => station.id));

			for (const [index, station] of stations.entries()) {
				const latitude = Number(station.lat);
				const longitude = Number(station.lon);
				const name = station.name ?? station.display_name;
				const existingStation = existingStations.find(
					(candidate) => normalizeStationName(candidate.name) === normalizeStationName(name),
				);
				const id = existingStation?.id ?? generateStationId(name, usedIds);
				const osmType = station.osm_type;
				const osmLink = `https://www.openstreetmap.org/${osmType}/${station.osm_id}`;
				const mapsLink = new URL('https://www.google.com/maps/search/');
				mapsLink.searchParams.set('api', '1');
				mapsLink.searchParams.set('query', `${name}`);

				console.log(`${index + 1}. ${name}`);
				if (existingStation) {
					console.warn(`   WARNING: Already in stations.json as "${existingStation.name}" (ID: ${existingStation.id}).`);
				}
				console.log(`   Suggested ID: ${id}`);
				console.log(`   Coordinates: ${latitude}, ${longitude}`);
				console.log(`   Google Maps: ${mapsLink}`);
				console.log(`   OSM station: ${osmLink}`);
				console.log(`	{ "id": "${id}", "name": "${name}", "latitude": ${latitude}, "longitude": ${longitude} },`);
			}
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
