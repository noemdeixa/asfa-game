import type { Scene, SceneManager } from '../core/SceneManager';
import { STATIONS, SEGMENTS, type Station } from '../data/network';
import { buildAdjacency, type Neighbour } from '../domain/graph';

export type JourneyDifficulty = 'full-map' | 'nearby' | 'station-names';

const MIN_LATITUDE = Math.min(...STATIONS.map(station => station.latitude));
const MAX_LATITUDE = Math.max(...STATIONS.map(station => station.latitude));
const MIN_LONGITUDE = Math.min(...STATIONS.map(station => station.longitude));
const MAX_LONGITUDE = Math.max(...STATIONS.map(station => station.longitude));

export class JourneyScene implements Scene {
	private adjacency = buildAdjacency(STATIONS, SEGMENTS);
	private difficulty: JourneyDifficulty = 'full-map';
	private currentId = 'mad';
	private objectiveId = 'bar';
	private elapsedSec = 0;
	private finished = false;
	private root: HTMLElement | null = null;
	private manager: SceneManager;

	constructor(manager: SceneManager) {
		this.manager = manager;
	}

	enter(root: HTMLElement, params?: unknown): void {
		this.root = root;
		if (typeof params === 'object' && params !== null && 'currentId' in params
			&& 'objectiveId' in params && 'difficulty' in params && 'elapsedSec' in params) {
			const { currentId, objectiveId, difficulty, elapsedSec } = params;
			if (typeof currentId !== 'string' || !STATIONS.some(station => station.id === currentId)
				|| typeof objectiveId !== 'string' || !STATIONS.some(station => station.id === objectiveId)
				|| (difficulty !== 'full-map' && difficulty !== 'nearby' && difficulty !== 'station-names')
				|| typeof elapsedSec !== 'number' || !Number.isFinite(elapsedSec)) {
				throw new Error('Journey scene received invalid journey parameters.');
			}
			this.currentId = currentId;
			this.objectiveId = objectiveId;
			this.difficulty = difficulty;
			this.elapsedSec = elapsedSec;
			this.finished = this.currentId === this.objectiveId;
		} else {
			if (typeof params === 'object' && params !== null && 'difficulty' in params
				&& (params.difficulty === 'full-map' || params.difficulty === 'nearby' || params.difficulty === 'station-names')) {
				this.difficulty = params.difficulty;
			}
			this.pickRandomJourney();
		}
		this.paint();
	}

	private pickRandomJourney(): void {
		const ids = STATIONS.map(s => s.id);
		const origin = ids[Math.floor(Math.random() * ids.length)];
		let destination = origin;
		while (destination === origin) {
		destination = ids[Math.floor(Math.random() * ids.length)];
		}
		this.currentId = origin;
		this.objectiveId = destination;
		this.elapsedSec = 0;
		this.finished = false;
	}

	private stationById(id: string): Station {
		return STATIONS.find(s => s.id === id)!;
	}

	private neighbours(): Neighbour[] {
		return this.adjacency.get(this.currentId) ?? [];
	}

	private isNeighbour(id: string): boolean {
		return this.neighbours().some(n => n.station.id === id);
	}

	private travelTo(neighbour: Neighbour): void {
		this.manager.switchTo('drive', {
			fromId: this.currentId,
			toId: neighbour.station.id,
			objectiveId: this.objectiveId,
			difficulty: this.difficulty,
			elapsedSec: this.elapsedSec,
		});
	}

	private formatTime(sec: number): string {
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = Math.floor(sec % 60);
		return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}

	private paint(): void {
		if (!this.root) return;
		const current = this.stationById(this.currentId);
		const objective = this.stationById(this.objectiveId);

		this.root.innerHTML = `
		<div class="scene">
			<div class="journey-difficulty">${this.difficultyLabel()}</div>
			<div class="journey-header">
				<div>At <strong>${current.name}</strong></div>
				<div>Goal <strong>${objective.name}</strong></div>
				<div>Elapsed <strong>${this.formatTime(this.elapsedSec)}</strong></div>
			</div>
			${this.finished
			? `<div class="journey-banner">You reached ${objective.name} in ${this.formatTime(this.elapsedSec)}.</div>
				<button id="again">New journey</button>`
			: ''}
			<button id="menu">Back to menu</button>
			${this.difficulty === 'station-names' && !this.finished ? this.renderStationChoices() : ''}
			<svg id="map" viewBox="0 0 1000 700" xmlns="http://www.w3.org/2000/svg">
			${this.renderSegments()}
			${this.renderStations()}
			</svg>
		</div>
		`;

		if (this.difficulty === 'station-names') {
			this.root.querySelectorAll<HTMLButtonElement>('.station-choice').forEach(button => {
				button.addEventListener('click', () => {
					const neighbour = this.neighbours().find(n => n.station.id === button.dataset.id);
					if (neighbour) this.travelTo(neighbour);
				});
			});
		} else {
			this.root.querySelectorAll<SVGGElement>('.station').forEach(g => {
				const id = g.dataset.id!;
				if (!this.isNeighbour(id)) return;
				g.addEventListener('click', () => {
					const n = this.neighbours().find(n => n.station.id === id);
					if (n) this.travelTo(n);
				});
				g.addEventListener('keydown', event => {
					if (event.key !== 'Enter' && event.key !== ' ') return;
					event.preventDefault();
					const n = this.neighbours().find(n => n.station.id === id);
					if (n) this.travelTo(n);
				});
			});
		}

		this.root.querySelector<HTMLButtonElement>('#again')?.addEventListener('click', () => {
			this.pickRandomJourney();
			this.paint();
		});
		this.root.querySelector<HTMLButtonElement>('#menu')?.addEventListener('click', () => {
			this.manager.switchTo('menu', { difficulty: this.difficulty });
		});
	}

	private difficultyLabel(): string {
		switch (this.difficulty) {
			case 'full-map': return 'Full map';
			case 'nearby': return 'Nearby stations';
			case 'station-names': return 'Station names';
		}
	}

	private renderStationChoices(): string {
		return `<div class="station-choices" aria-label="Choose the next station">
			${this.neighbours().map(n =>
				`<button class="station-choice" data-id="${n.station.id}">${n.station.name}</button>`,
			).join('')}
		</div>`;
	}

	private position(station: Station): { x: number; y: number } {
		return {
			x: 90 + ((station.longitude - MIN_LONGITUDE) / (MAX_LONGITUDE - MIN_LONGITUDE)) * 820,
			y: 610 - ((station.latitude - MIN_LATITUDE) / (MAX_LATITUDE - MIN_LATITUDE)) * 500,
		};
	}

	private isVisible(station: Station): boolean {
		return this.difficulty !== 'nearby'
			|| station.id === this.currentId
			|| this.isNeighbour(station.id);
	}

	private renderSegments(): string {
		return SEGMENTS.map(seg => {
			const a = this.stationById(seg.from);
			const b = this.stationById(seg.to);
			if (!this.isVisible(a) || !this.isVisible(b)) return '';
			const from = this.position(a);
			const to = this.position(b);
			return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
							stroke="#2f3a4d" stroke-width="4" />`;
		}).join('');
	}

	private renderStations(): string {
		return STATIONS.filter(s => this.isVisible(s)).map(s => {
		const isCurrent = s.id === this.currentId;
		const isObjective = s.id === this.objectiveId;
		const isNeighbour = this.isNeighbour(s.id);
		const { x, y } = this.position(s);

		const fill = isCurrent ? '#5eead4'
					: isObjective ? '#f472b6'
					: isNeighbour ? '#93c5fd'
					: '#4a5568';

		const canClick = this.difficulty !== 'station-names' && isNeighbour && !this.finished;
		const cursor = canClick ? 'pointer' : 'default';
		const showName = this.difficulty !== 'station-names';
		const interactionAttributes = canClick
			? `role="button" tabindex="0" aria-label="Travel to ${s.name}"`
			: '';

		return `
			<g class="station" data-id="${s.id}" style="cursor:${cursor}" ${interactionAttributes}>
			${canClick ? `<circle cx="${x}" cy="${y}" r="24" fill="transparent" pointer-events="all" />` : ''}
			<circle cx="${x}" cy="${y}" r="14" fill="${fill}" />
			${showName ? `<text x="${x}" y="${y - 24}" text-anchor="middle"
					font-size="16" fill="#e6e9ef">${s.name}</text>` : ''}
			</g>
		`;
		}).join('');
	}

	update(): void {}
	render(): void {}
	exit(): void { this.root = null; }
}