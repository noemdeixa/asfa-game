import type { Scene, SceneManager } from '../core/SceneManager';
import { STATIONS, SEGMENTS, type Station } from '../data/network';
import { buildAdjacency, segmentDurationSec, type Neighbour } from '../domain/graph';

export type JourneyDifficulty = 'full-map' | 'nearby' | 'station-names';

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 700;
const MAP_STATION_MARGIN_X = 50;
const MAP_STATION_MARGIN_Y = 85;
const MAP_STATION_WIDTH = MAP_WIDTH - MAP_STATION_MARGIN_X * 2;
const MAP_STATION_HEIGHT = MAP_HEIGHT - MAP_STATION_MARGIN_Y * 2;
const MAP_PROJECTION_SCALE = 1.2;
const CENTER_LATITUDE = (Math.min(...STATIONS.map(station => station.latitude))
	+ Math.max(...STATIONS.map(station => station.latitude))) / 2;
const LONGITUDE_SCALE = Math.cos(CENTER_LATITUDE * Math.PI / 180);
const MIN_PROJECTED_LONGITUDE = Math.min(...STATIONS.map(station => station.longitude * LONGITUDE_SCALE));
const MAX_PROJECTED_LONGITUDE = Math.max(...STATIONS.map(station => station.longitude * LONGITUDE_SCALE));
const MIN_LATITUDE = Math.min(...STATIONS.map(station => station.latitude));
const MAX_LATITUDE = Math.max(...STATIONS.map(station => station.latitude));
const MAP_UNITS_PER_DEGREE = Math.min(
	MAP_STATION_WIDTH / (MAX_PROJECTED_LONGITUDE - MIN_PROJECTED_LONGITUDE),
	MAP_STATION_HEIGHT / (MAX_LATITUDE - MIN_LATITUDE),
) * MAP_PROJECTION_SCALE;
const MAP_PAN_LEEWAY = 180;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 4;
const STATION_LABEL_FONT_SIZE = 11;
const STATION_LABEL_LINE_HEIGHT = 13;
const STATION_NODE_RADIUS = 3.5;
const LABEL_GAP = 5;

type StationLabel = {
	x: number;
	y: number;
	lines: string[];
	width: number;
	height: number;
};

type MapBounds = { left: number; right: number; top: number; bottom: number };

export class JourneyScene implements Scene {
	private adjacency = buildAdjacency(STATIONS, SEGMENTS);
	private difficulty: JourneyDifficulty = 'full-map';
	private currentId = 'mad';
	private objectiveId = 'bar';
	private elapsedSec = 0;
	private finished = false;
	private root: HTMLElement | null = null;
	private manager: SceneManager;
	private zoom = MIN_ZOOM;
	private mapCenterX = MAP_WIDTH / 2;
	private mapCenterY = MAP_HEIGHT / 2;
	private mapInteractionController: AbortController | null = null;
	private suppressMapClick = false;

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
				|| typeof elapsedSec !== 'number' || !Number.isFinite(elapsedSec)
				|| ('zoom' in params && (typeof params.zoom !== 'number' || !Number.isFinite(params.zoom)))
				|| ('mapCenterX' in params && (typeof params.mapCenterX !== 'number' || !Number.isFinite(params.mapCenterX)))
				|| ('mapCenterY' in params && (typeof params.mapCenterY !== 'number' || !Number.isFinite(params.mapCenterY)))) {
				throw new Error('Journey scene received invalid journey parameters.');
			}
			this.currentId = currentId;
			this.objectiveId = objectiveId;
			this.difficulty = difficulty;
			this.elapsedSec = elapsedSec;
			this.zoom = 'zoom' in params && typeof params.zoom === 'number' ? params.zoom : MIN_ZOOM;
			this.mapCenterX = 'mapCenterX' in params && typeof params.mapCenterX === 'number'
				? params.mapCenterX : MAP_WIDTH / 2;
			this.mapCenterY = 'mapCenterY' in params && typeof params.mapCenterY === 'number'
				? params.mapCenterY : MAP_HEIGHT / 2;
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
		const initialStationPosition = this.position(this.stationById(origin));
		this.mapCenterX = initialStationPosition.x;
		this.mapCenterY = initialStationPosition.y;
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
		this.manager.switchTo('journey', {
			currentId: neighbour.station.id,
			objectiveId: this.objectiveId,
			difficulty: this.difficulty,
			elapsedSec: this.elapsedSec + segmentDurationSec(neighbour.segment, STATIONS),
			zoom: this.zoom,
			mapCenterX: this.mapCenterX,
			mapCenterY: this.mapCenterY,
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
		this.mapInteractionController?.abort();
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
			<div class="map-controls" aria-label="Map zoom controls">
				<button id="zoom-out" type="button" aria-label="Zoom out">−</button>
				<output id="zoom-level">${Math.round(this.zoom * 100)}%</output>
				<button id="zoom-in" type="button" aria-label="Zoom in">+</button>
				<button id="zoom-reset" type="button">Reset zoom</button>
				<span class="map-pan-hint">Drag to pan</span>
			</div>
			<svg id="map" viewBox="${this.viewBoxForZoom()}" xmlns="http://www.w3.org/2000/svg">
			${this.renderSegments()}
			${this.renderStations()}
			</svg>
		</div>
		`;

		this.root.querySelectorAll<SVGGElement>('.station').forEach(g => {
			const id = g.dataset.id!;
			const label = this.root?.querySelector<SVGGElement>(`.station-label[data-id="${id}"]`);
			const setHighlight = (highlighted: boolean) => {
				g.classList.toggle('is-highlighted', highlighted);
				label?.classList.toggle('is-highlighted', highlighted);
			};
			g.addEventListener('pointerenter', () => setHighlight(true));
			g.addEventListener('pointerleave', () => setHighlight(false));
			g.addEventListener('focus', () => setHighlight(true));
			g.addEventListener('blur', () => setHighlight(false));
		});

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
		this.root.querySelector<HTMLButtonElement>('#zoom-in')?.addEventListener('click', () => {
			this.setZoom(this.zoom * 1.25);
		});
		this.root.querySelector<HTMLButtonElement>('#zoom-out')?.addEventListener('click', () => {
			this.setZoom(this.zoom / 1.25);
		});
		this.root.querySelector<HTMLButtonElement>('#zoom-reset')?.addEventListener('click', () => {
			this.mapCenterX = MAP_WIDTH / 2;
			this.mapCenterY = MAP_HEIGHT / 2;
			this.setZoom(MIN_ZOOM);
		});
		const map = this.root.querySelector<SVGSVGElement>('#map');
		if (!map) throw new Error('Journey map SVG was not rendered.');
		map.addEventListener('wheel', event => {
			event.preventDefault();
			this.setZoom(this.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
		});
		const controller = new AbortController();
		this.mapInteractionController = controller;
		let drag: {
			pointerId: number;
			startX: number;
			startY: number;
			centerX: number;
			centerY: number;
			moved: boolean;
		} | null = null;
		map.addEventListener('pointerdown', event => {
			if (!this.canPanMap() || event.button !== 0) return;
			drag = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				centerX: this.mapCenterX,
				centerY: this.mapCenterY,
				moved: false,
			};
			map.classList.add('is-panning');
		});
		window.addEventListener('pointermove', event => {
			if (!drag || drag.pointerId !== event.pointerId) return;
			if (!(event.buttons & 1)) return;
			const bounds = map.getBoundingClientRect();
			if (bounds.width === 0 || bounds.height === 0) return;
			const deltaX = event.clientX - drag.startX;
			const deltaY = event.clientY - drag.startY;
			if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
			const viewWidth = MAP_WIDTH / this.zoom;
			const viewHeight = MAP_HEIGHT / this.zoom;
			this.mapCenterX = this.clampMapCenterX(drag.centerX - deltaX * viewWidth / bounds.width);
			this.mapCenterY = this.clampMapCenterY(drag.centerY - deltaY * viewHeight / bounds.height);
			map.setAttribute('viewBox', this.viewBoxForZoom());
		}, { signal: controller.signal });
		const endDrag = (event: PointerEvent) => {
			if (!drag || drag.pointerId !== event.pointerId) return;
			this.suppressMapClick = drag.moved;
			map.classList.remove('is-panning');
			if (drag.moved) {
				window.setTimeout(() => { this.suppressMapClick = false; }, 0);
			}
			drag = null;
		};
		window.addEventListener('pointerup', endDrag, { signal: controller.signal });
		window.addEventListener('pointercancel', endDrag, { signal: controller.signal });
		map.addEventListener('click', event => {
			if (!this.suppressMapClick) return;
			event.preventDefault();
			event.stopPropagation();
			this.suppressMapClick = false;
		}, true);
		this.setZoom(this.zoom);
	}

	private viewBoxForZoom(): string {
		const width = MAP_WIDTH / this.zoom;
		const height = MAP_HEIGHT / this.zoom;
		return `${this.mapCenterX - width / 2} ${this.mapCenterY - height / 2} ${width} ${height}`;
	}

	private clampMapCenterX(center: number): number {
		const halfWidth = MAP_WIDTH / this.zoom / 2;
		return Math.max(halfWidth - MAP_PAN_LEEWAY, Math.min(MAP_WIDTH - halfWidth + MAP_PAN_LEEWAY, center));
	}

	private clampMapCenterY(center: number): number {
		const halfHeight = MAP_HEIGHT / this.zoom / 2;
		return Math.max(halfHeight - MAP_PAN_LEEWAY, Math.min(MAP_HEIGHT - halfHeight + MAP_PAN_LEEWAY, center));
	}

	private canPanMap(): boolean {
		return this.zoom > MIN_ZOOM
			|| this.mapCenterX !== MAP_WIDTH / 2
			|| this.mapCenterY !== MAP_HEIGHT / 2;
	}

	private setZoom(zoom: number): void {
		this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
		this.mapCenterX = this.clampMapCenterX(this.mapCenterX);
		this.mapCenterY = this.clampMapCenterY(this.mapCenterY);
		const map = this.root?.querySelector<SVGSVGElement>('#map');
		map?.setAttribute('viewBox', this.viewBoxForZoom());
		map?.classList.toggle('is-draggable', this.canPanMap());
		const level = this.root?.querySelector<HTMLOutputElement>('#zoom-level');
		if (level) level.value = `${Math.round(this.zoom * 100)}%`;
		const zoomOut = this.root?.querySelector<HTMLButtonElement>('#zoom-out');
		const zoomIn = this.root?.querySelector<HTMLButtonElement>('#zoom-in');
		if (zoomOut) zoomOut.disabled = this.zoom <= MIN_ZOOM;
		if (zoomIn) zoomIn.disabled = this.zoom >= MAX_ZOOM;
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
			x: MAP_WIDTH / 2
				+ (station.longitude * LONGITUDE_SCALE
					- (MIN_PROJECTED_LONGITUDE + MAX_PROJECTED_LONGITUDE) / 2) * MAP_UNITS_PER_DEGREE,
			y: MAP_HEIGHT / 2
				- (station.latitude - (MIN_LATITUDE + MAX_LATITUDE) / 2) * MAP_UNITS_PER_DEGREE,
		};
	}

	private isVisible(station: Station): boolean {
		return this.difficulty !== 'nearby'
			|| station.id === this.currentId
			|| this.isNeighbour(station.id);
	}

	private wrapStationLabel(name: string): string[] {
		const maxLineLength = 20;
		const lines: string[] = [];
		let line = '';
		for (const word of name.split(/\s+/)) {
			const nextLine = line ? `${line} ${word}` : word;
			if (line && nextLine.length > maxLineLength) {
				lines.push(line);
				line = word;
			} else {
				line = nextLine;
			}
		}
		if (line) lines.push(line);
		return lines;
	}

	private stationLabelPositions(): Map<string, StationLabel> {
		const placements = new Map<string, StationLabel>();
		const placedBounds: MapBounds[] = [];
		const stationPositions = new Map(STATIONS.map(station => [station.id, this.position(station)]));
		const stations = STATIONS.filter(station => this.isVisible(station));
		const visibleStationIds = new Set(stations.map(station => station.id));
		const trackSegments = SEGMENTS.filter(segment =>
			visibleStationIds.has(segment.from) && visibleStationIds.has(segment.to),
		).map(segment => ({
			from: stationPositions.get(segment.from)!,
			to: stationPositions.get(segment.to)!,
		}));
		stations.sort((a, b) =>
			(this.adjacency.get(b.id)?.length ?? 0) - (this.adjacency.get(a.id)?.length ?? 0)
			|| b.name.length - a.name.length
			|| a.id.localeCompare(b.id));

		for (const station of stations) {
			const { x, y } = this.position(station);
			const lines = this.wrapStationLabel(station.name);
			const width = Math.max(...lines.map(line => line.length)) * 5.9;
			const height = lines.length * STATION_LABEL_LINE_HEIGHT;
			const boundsFor = (centerX: number, centerY: number) => ({
				left: centerX - width / 2,
				right: centerX + width / 2,
				top: centerY - height / 2,
				bottom: centerY + height / 2,
			});
			const neighbours = (this.adjacency.get(station.id) ?? [])
				.filter(neighbour => visibleStationIds.has(neighbour.station.id));
			const neighbourDirection = neighbours.reduce((direction, neighbour) => {
				const neighbourPosition = stationPositions.get(neighbour.station.id)!;
				direction.x += neighbourPosition.x - x;
				direction.y += neighbourPosition.y - y;
				return direction;
			}, { x: 0, y: 0 });
			const preferredAngle = Math.hypot(neighbourDirection.x, neighbourDirection.y) > 0.001
				? Math.atan2(-neighbourDirection.y, -neighbourDirection.x)
				: Math.atan2(y - MAP_HEIGHT / 2, x - MAP_WIDTH / 2);
			let bestPlacement: StationLabel | null = null;
			let bestBounds: MapBounds | null = null;
			let bestScore = Number.POSITIVE_INFINITY;
			for (let directionIndex = 0; directionIndex < 24; directionIndex++) {
				const angle = preferredAngle + (directionIndex / 24) * Math.PI * 2;
				const directionX = Math.cos(angle);
				const directionY = Math.sin(angle);
				const edgeDistance = Math.min(
					Math.abs(directionX) < 0.001 ? Number.POSITIVE_INFINITY
						: width / 2 / Math.abs(directionX),
					Math.abs(directionY) < 0.001 ? Number.POSITIVE_INFINITY
						: height / 2 / Math.abs(directionY),
				);
				const minimumDistance = STATION_NODE_RADIUS + LABEL_GAP + edgeDistance;

				for (const extraDistance of [0, 3, 7, 12]) {
					const distance = minimumDistance + extraDistance;
					const centerX = x + directionX * distance;
					const centerY = y + directionY * distance;
					const bounds = boundsFor(centerX, centerY);
					if (bounds.left < 8 || bounds.right > MAP_WIDTH - 8
						|| bounds.top < 8 || bounds.bottom > MAP_HEIGHT - 8) continue;

					const labelOverlapArea = placedBounds.reduce((area, other) =>
						area + this.boundsOverlapArea(bounds, other, 3), 0);
					const stationOverlaps = stations.filter(other => {
						if (other.id === station.id) return false;
						const position = stationPositions.get(other.id)!;
						return bounds.left < position.x + 6 && bounds.right > position.x - 6
							&& bounds.top < position.y + 6 && bounds.bottom > position.y - 6;
					}).length;
					const linkOverlaps = trackSegments.filter(segment =>
						this.segmentIntersectsBounds(segment.from.x, segment.from.y, segment.to.x, segment.to.y, bounds),
					).length;
					const angleDifference = Math.abs(Math.atan2(
						Math.sin(angle - preferredAngle), Math.cos(angle - preferredAngle),
					));
					const score = labelOverlapArea * 80 + stationOverlaps * 30000
						+ linkOverlaps * 9000 + angleDifference * 8 + extraDistance * 5;
					if (score >= bestScore) continue;
					bestScore = score;
					bestPlacement = { x: centerX, y: centerY, lines, width, height };
					bestBounds = bounds;
				}
			}
			if (bestPlacement && bestBounds) {
				placements.set(station.id, bestPlacement);
				placedBounds.push(bestBounds);
			}
		}
		return placements;
	}

	private boundsOverlapArea(a: MapBounds, b: MapBounds, gap: number): number {
		const width = Math.max(0, Math.min(a.right + gap, b.right) - Math.max(a.left - gap, b.left));
		const height = Math.max(0, Math.min(a.bottom + gap, b.bottom) - Math.max(a.top - gap, b.top));
		return width * height;
	}

	private segmentIntersectsBounds(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		bounds: MapBounds,
	): boolean {
		const dx = x2 - x1;
		const dy = y2 - y1;
		let near = 0;
		let far = 1;
		const clips: Array<[number, number]> = [
			[-dx, x1 - bounds.left],
			[dx, bounds.right - x1],
			[-dy, y1 - bounds.top],
			[dy, bounds.bottom - y1],
		];
		for (const [direction, distance] of clips) {
			if (direction === 0) {
				if (distance < 0) return false;
				continue;
			}
			const ratio = distance / direction;
			if (direction < 0) near = Math.max(near, ratio);
			else far = Math.min(far, ratio);
			if (near > far) return false;
		}
		return true;
	}

	private renderSegments(): string {
		return SEGMENTS.map(seg => {
			const a = this.stationById(seg.from);
			const b = this.stationById(seg.to);
			if (!this.isVisible(a) || !this.isVisible(b)) return '';
			const from = this.position(a);
			const to = this.position(b);
			return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
							class="track-segment" />`;
		}).join('');
	}

	private renderStations(): string {
		const labels: Map<string, StationLabel> = this.difficulty === 'station-names'
			? new Map<string, StationLabel>() : this.stationLabelPositions();
		const stationNodes: string[] = [];
		const labelTexts: string[] = [];

		for (const station of STATIONS.filter(s => this.isVisible(s))) {
			const isCurrent = station.id === this.currentId;
			const isObjective = station.id === this.objectiveId;
			const isNeighbour = this.isNeighbour(station.id);
			const { x, y } = this.position(station);
			const fill = isCurrent ? '#5eead4'
				: isObjective ? '#f472b6'
				: isNeighbour ? '#93c5fd'
				: '#4a5568';
			const canClick = this.difficulty !== 'station-names' && isNeighbour && !this.finished;
			const cursor = canClick ? 'pointer' : 'default';
			const interactionAttributes = canClick
				? `role="button" tabindex="0" aria-label="Travel to ${station.name}"`
				: '';
			const label = labels.get(station.id);

			const nodeSize = STATION_NODE_RADIUS;

			stationNodes.push(`
				<g class="station" data-id="${station.id}" style="cursor:${cursor}" ${interactionAttributes}>
					<circle cx="${x}" cy="${y}" r="${canClick ? 14 : 9}"
						fill="transparent" pointer-events="all" class="station-hit-area" />
					<circle cx="${x}" cy="${y}" r="${nodeSize}" fill="${fill}" />
				</g>`);

			if (!label) continue;

			labelTexts.push(`
				<g class="station-label" data-id="${station.id}">
					<text x="${label.x}"
						y="${label.y - ((label.lines.length - 1) * STATION_LABEL_LINE_HEIGHT) / 2 + STATION_LABEL_FONT_SIZE * 0.35}"
						text-anchor="middle" font-size="${STATION_LABEL_FONT_SIZE}">
						${label.lines.map((line: string, index: number) => `<tspan x="${label.x}" dy="${index === 0 ? 0 : STATION_LABEL_LINE_HEIGHT}">${line}</tspan>`).join('')}
					</text>
				</g>`);
		}

		return `${stationNodes.join('')}<g class="station-labels">${labelTexts.join('')}</g>`;
	}

	update(): void {}
	render(): void {}
	exit(): void {
		this.mapInteractionController?.abort();
		this.mapInteractionController = null;
		this.root = null;
	}
}