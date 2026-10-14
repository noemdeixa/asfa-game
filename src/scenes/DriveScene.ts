import type { Scene, SceneManager } from '../core/SceneManager';
import { STATIONS, SEGMENTS, type Station } from '../data/network';
import { createDemoSignals, SIGNAL_ASPECTS, type Signal, type SignalAuxiliaryLamp, type SignalLamp } from '../domain/signals';
import type { JourneyDifficulty } from './JourneyScene';

interface DriveParams {
	fromId: string;
	toId: string;
	objectiveId: string;
	difficulty: JourneyDifficulty;
	elapsedSec: number;
}

const STATION_STOP_LINE_METERS = 1200;
const STOP_LINE_TOLERANCE_METERS = 8;
const STOP_SPEED_TOLERANCE_KMH = 1;
const TRAIN_MASS_KG = 400_000;
const MAX_TRACTION_KN = 250;
const MAX_BRAKING_KN = 350;
const EMERGENCY_BRAKING_KN = 450;
const ROLLING_RESISTANCE_COEFFICIENT = 0.0015;
const AERODYNAMIC_DRAG_COEFFICIENT = 4.6;
const EMERGENCY_BRAKE_LIMIT_KMH = 125;
const SIGNAL_HEAD_TOP_OFFSET = 193;
const LAMP_HEX: Record<SignalLamp['color'], string> = {
	red: '#ff4b55',
	amber: '#ffc34d',
	green: '#55e08a',
	white: '#f4f7ff',
};

function isJourneyDifficulty(value: unknown): value is JourneyDifficulty {
	return value === 'full-map' || value === 'nearby' || value === 'station-names';
}

export class DriveScene implements Scene {
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private manager: SceneManager;
	private params: DriveParams | null = null;
	private from: Station | null = null;
	private to: Station | null = null;
	private throttle = 0;
	private speedKmh = 0;
	private distanceMeters = 0;
	private driveElapsedSec = 0;
	private emergencyBrake = false;
	private arrivedAtStation = false;
	private missedStation = false;
	private recognitionFeedbackSec = 0;
	private acknowledgedSignals = new Set<number>();
	private signals: Signal[] = [];
	private root: HTMLElement | null = null;

	constructor(manager: SceneManager) {
		this.manager = manager;
	}

	enter(root: HTMLElement, params?: unknown): void {
		if (typeof params !== 'object' || params === null || !('fromId' in params)
			|| !('toId' in params) || !('objectiveId' in params) || !('difficulty' in params)
			|| !('elapsedSec' in params)) {
			throw new Error('Drive scene requires journey parameters.');
		}

		const { fromId, toId, objectiveId, difficulty, elapsedSec } = params;
		if (typeof fromId !== 'string' || typeof toId !== 'string' || typeof objectiveId !== 'string'
			|| !isJourneyDifficulty(difficulty) || typeof elapsedSec !== 'number' || !Number.isFinite(elapsedSec)) {
			throw new Error('Drive scene received invalid journey parameters.');
		}

		const from = STATIONS.find(station => station.id === fromId);
		const to = STATIONS.find(station => station.id === toId);
		const segment = SEGMENTS.find(route => route.from === fromId && route.to === toId
			|| route.from === toId && route.to === fromId);
		if (!from || !to || !segment) throw new Error(`No route exists from "${fromId}" to "${toId}".`);

		this.root = root;
		this.from = from;
		this.to = to;
		this.params = { fromId, toId, objectiveId, difficulty, elapsedSec };
		this.throttle = 0;
		this.speedKmh = 0;
		this.distanceMeters = 0;
		this.driveElapsedSec = 0;
		this.emergencyBrake = false;
		this.arrivedAtStation = false;
		this.missedStation = false;
		this.recognitionFeedbackSec = 0;
		this.acknowledgedSignals.clear();
		this.signals = createDemoSignals();

		root.innerHTML = `
			<div class="scene drive-scene">
				<h2>Driving to ${to.name}</h2>
				<p class="drive-route">${from.name} to ${to.name} · ASFA proof of concept</p>
				<p class="drive-prototype-note">Signal aspects use a simplified block sequence. ASFA behavior is a proof of concept, not operational rules.</p>
				<div class="drive-readouts">
					<div>Speed <strong id="speed">0</strong> km/h</div>
					<div>Distance <strong id="distance">0</strong> / ${STATION_STOP_LINE_METERS} m to station</div>
					<div id="brake-state" class="brake-state" aria-live="polite">Traction available</div>
				</div>
				<div class="drive-cab">
					<canvas id="view" width="1000" height="420" aria-label="Side-scrolling train view with simplified block signals approaching from the right"></canvas>
					<div class="cab-dashboard">
						<div class="dashboard-heading"><span>ASFA DIGITAL</span><span>Cab controls</span></div>
						<div class="dashboard-display">
							<span>VELOCIDAD</span>
							<strong><span id="cab-speed">0</span><small> km/h</small></strong>
						</div>
						<div class="throttle-control">
							<div class="throttle-scale"><span>+${MAX_TRACTION_KN} kN</span><span>0</span><span>−${MAX_BRAKING_KN} kN</span></div>
							<input id="throttle" type="range" min="-100" max="100" step="1" value="0" aria-label="Combined traction and braking lever">
							<label for="throttle">TRACCIÓN / FRENO <strong id="throttle-value">0 kN · coast</strong></label>
						</div>
					</div>
				</div>
				<div class="drive-controls">
					<button id="recognize" disabled>ASFA · Reconocer señal</button>
					<button id="reset-brake" hidden>Rearmar freno de emergencia</button>
					<span id="signal-status" aria-live="polite">No hay señal que reconocer.</span>
				</div>
				<div id="station-warning" class="station-warning" role="status" hidden></div>
				<div id="station-outcome" class="journey-banner drive-outcome" hidden>
					<strong id="station-outcome-message"></strong>
					<button id="continue">Continue journey</button>
				</div>
				<button id="menu">Back to menu</button>
			</div>
		`;

		this.canvas = root.querySelector<HTMLCanvasElement>('#view');
		if (!this.canvas) throw new Error('Driving canvas was not created.');
		this.ctx = this.canvas.getContext('2d');
		if (!this.ctx) throw new Error('Could not initialize the driving canvas.');

		const throttleInput = root.querySelector<HTMLInputElement>('#throttle');
		const recognizeButton = root.querySelector<HTMLButtonElement>('#recognize');
		const resetBrakeButton = root.querySelector<HTMLButtonElement>('#reset-brake');
		const continueButton = root.querySelector<HTMLButtonElement>('#continue');
		const menuButton = root.querySelector<HTMLButtonElement>('#menu');
		if (!throttleInput || !recognizeButton || !resetBrakeButton || !continueButton || !menuButton) {
			throw new Error('Driving controls were not created.');
		}
		throttleInput.addEventListener('input', () => {
			if (this.emergencyBrake) return;
			this.throttle = Number(throttleInput.value);
			const value = root.querySelector<HTMLElement>('#throttle-value');
			if (value) value.textContent = this.leverDescription();
		});
		recognizeButton.addEventListener('click', () => this.acknowledgeSignal());
		resetBrakeButton.addEventListener('click', () => this.resetEmergencyBrake());
		continueButton.addEventListener('click', () => this.arrive());
		menuButton.addEventListener('click', () => this.manager.switchTo('menu', { difficulty }));
	}

	private activeSignalIndex(): number {
		return this.signals.findIndex((signal, index) =>
			!this.acknowledgedSignals.has(index)
			&& signal.distance >= this.distanceMeters
			&& signal.distance - this.distanceMeters <= 230,
		);
	}

	private acknowledgeSignal(): void {
		const signalIndex = this.activeSignalIndex();
		if (signalIndex < 0) return;
		this.acknowledgedSignals.add(signalIndex);
		this.recognitionFeedbackSec = 2;
		const status = this.root?.querySelector<HTMLElement>('#signal-status');
		if (status) status.textContent = 'Reconocimiento registrado (demo).';
	}

	private resetEmergencyBrake(): void {
		if (!this.emergencyBrake || this.speedKmh > 0) return;
		this.emergencyBrake = false;
		const resetButton = this.root?.querySelector<HTMLButtonElement>('#reset-brake');
		const throttleInput = this.root?.querySelector<HTMLInputElement>('#throttle');
		const brakeState = this.root?.querySelector<HTMLElement>('#brake-state');
		if (resetButton) resetButton.hidden = true;
		if (throttleInput) throttleInput.disabled = false;
		if (brakeState) {
			brakeState.textContent = 'Traction available';
			brakeState.classList.remove('is-emergency');
		}
	}

	private arrive(): void {
		if (!this.params || !this.from || !this.to) return;
		this.manager.switchTo('journey', {
			...this.params,
			currentId: this.to.id,
			elapsedSec: this.params.elapsedSec + this.driveElapsedSec,
		});
	}

	private completeStationStop(): void {
		this.arrivedAtStation = true;
		this.speedKmh = 0;
		this.throttle = 0;
		const throttleInput = this.root?.querySelector<HTMLInputElement>('#throttle');
		const throttleValue = this.root?.querySelector<HTMLElement>('#throttle-value');
		const outcome = this.root?.querySelector<HTMLElement>('#station-outcome');
		const message = this.root?.querySelector<HTMLElement>('#station-outcome-message');
		if (throttleInput) {
			throttleInput.value = '0';
			throttleInput.disabled = true;
		}
		if (throttleValue) throttleValue.textContent = this.leverDescription();
		if (message && this.to) message.textContent = `Stopped at the ${this.to.name} stopping marker.`;
		if (outcome) outcome.hidden = false;
	}

	private markStationMissed(): void {
		this.missedStation = true;
		const message = this.root?.querySelector<HTMLElement>('#station-outcome-message');
		const outcome = this.root?.querySelector<HTMLElement>('#station-outcome');
		const warning = this.root?.querySelector<HTMLElement>('#station-warning');
		if (message && this.to) {
			message.textContent = `You passed ${this.to.name}. Keep driving; the station stop was missed.`;
		}
		if (warning && this.to) {
			warning.textContent = `Station passed — you missed the stopping line at ${this.to.name}.`;
			warning.hidden = false;
		}
		if (outcome) outcome.hidden = true;
	}

	private leverDescription(): string {
		if (this.throttle > 0) {
			return `${Math.round(this.throttle * MAX_TRACTION_KN / 100)} kN · traction`;
		}
		if (this.throttle < 0) {
			return `${Math.round(Math.abs(this.throttle) * MAX_BRAKING_KN / 100)} kN · braking`;
		}
		return '0 kN · coast';
	}

	update(dt: number): void {
		if (!this.root || this.arrivedAtStation) return;
		const previousDistance = this.distanceMeters;
		const speedMps = this.speedKmh / 3.6;
		const tractionN = Math.max(0, this.throttle) / 100 * MAX_TRACTION_KN * 1000;
		const brakingN = this.emergencyBrake
			? EMERGENCY_BRAKING_KN * 1000
			: Math.abs(Math.min(0, this.throttle)) / 100 * MAX_BRAKING_KN * 1000;
		const rollingResistanceN = speedMps > 0
			? TRAIN_MASS_KG * 9.81 * ROLLING_RESISTANCE_COEFFICIENT
			: 0;
		const aerodynamicDragN = AERODYNAMIC_DRAG_COEFFICIENT * speedMps * speedMps;
		const resistanceN = speedMps > 0 ? rollingResistanceN + aerodynamicDragN : 0;
		const accelerationMps2 = (tractionN - brakingN - resistanceN) / TRAIN_MASS_KG;
		const nextSpeedMps = Math.max(0, speedMps + accelerationMps2 * dt);
		this.speedKmh = nextSpeedMps * 3.6;
		if (this.speedKmh > EMERGENCY_BRAKE_LIMIT_KMH && !this.emergencyBrake) {
			this.emergencyBrake = true;
			this.throttle = 0;
			const throttleInput = this.root.querySelector<HTMLInputElement>('#throttle');
			const throttleValue = this.root.querySelector<HTMLElement>('#throttle-value');
			if (throttleInput) {
				throttleInput.value = '0';
				throttleInput.disabled = true;
			}
			if (throttleValue) throttleValue.textContent = this.leverDescription();
		}
		if (this.emergencyBrake && this.speedKmh === 0) {
			const resetButton = this.root.querySelector<HTMLButtonElement>('#reset-brake');
			if (resetButton) resetButton.hidden = false;
		}
		const distanceStep = (speedMps + nextSpeedMps) / 2 * dt;
		this.distanceMeters += distanceStep;
		this.driveElapsedSec += dt;
		if (!this.missedStation && previousDistance < STATION_STOP_LINE_METERS
			&& this.distanceMeters >= STATION_STOP_LINE_METERS) {
			if (this.speedKmh <= STOP_SPEED_TOLERANCE_KMH
				&& Math.abs(this.distanceMeters - STATION_STOP_LINE_METERS) <= STOP_LINE_TOLERANCE_METERS) {
				this.completeStationStop();
			} else {
				this.markStationMissed();
			}
		} else if (!this.missedStation && this.speedKmh <= STOP_SPEED_TOLERANCE_KMH
			&& Math.abs(this.distanceMeters - STATION_STOP_LINE_METERS) <= STOP_LINE_TOLERANCE_METERS) {
			this.completeStationStop();
		}
		const speed = this.root.querySelector<HTMLElement>('#speed');
		const distance = this.root.querySelector<HTMLElement>('#distance');
		const recognizeButton = this.root.querySelector<HTMLButtonElement>('#recognize');
		const outcome = this.root.querySelector<HTMLElement>('#station-outcome');
		const signalStatus = this.root.querySelector<HTMLElement>('#signal-status');
		const brakeState = this.root.querySelector<HTMLElement>('#brake-state');
		this.recognitionFeedbackSec = Math.max(0, this.recognitionFeedbackSec - dt);
		if (speed) speed.textContent = Math.round(this.speedKmh).toString();
		const cabSpeed = this.root.querySelector<HTMLElement>('#cab-speed');
		if (cabSpeed) cabSpeed.textContent = Math.round(this.speedKmh).toString();
		if (distance) distance.textContent = Math.round(this.distanceMeters).toString();
		if (brakeState && this.emergencyBrake) {
			brakeState.textContent = this.speedKmh > 0
				? 'FRENO DE EMERGENCIA · BRAKING'
				: 'FRENO DE EMERGENCIA · STOPPED';
			brakeState.classList.add('is-emergency');
		}

		const activeSignalIndex = this.activeSignalIndex();
		if (recognizeButton) recognizeButton.disabled = activeSignalIndex < 0;
		if (signalStatus && activeSignalIndex >= 0 && !this.acknowledgedSignals.has(activeSignalIndex)) {
			const activeSignal = this.signals[activeSignalIndex];
			if (!activeSignal) throw new Error(`Active signal was not found at index ${activeSignalIndex}.`);
			signalStatus.textContent = `Señal próxima: ${SIGNAL_ASPECTS[activeSignal.aspect].label}. Pulsa Reconocer (demo).`;
		} else if (signalStatus && activeSignalIndex < 0 && this.recognitionFeedbackSec === 0
			&& !this.signals.every((_, index) => this.acknowledgedSignals.has(index))) {
			signalStatus.textContent = 'No hay señal que reconocer.';
		}

		if (this.missedStation && this.speedKmh <= STOP_SPEED_TOLERANCE_KMH && outcome?.hidden) {
			outcome.hidden = false;
			const message = this.root.querySelector<HTMLElement>('#station-outcome-message');
			if (message && this.to) {
				message.textContent = `Stopped beyond ${this.to.name}. The station stop was missed.`;
			}
			const continueButton = this.root.querySelector<HTMLButtonElement>('#continue');
			if (continueButton) continueButton.textContent = 'Continue journey';
			if (recognizeButton) recognizeButton.disabled = true;
		}
	}

	render(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) return;
		const { width, height } = canvas;

		ctx.clearRect(0, 0, width, height);
		const sky = ctx.createLinearGradient(0, 0, 0, 270);
		sky.addColorStop(0, '#80c7f3');
		sky.addColorStop(0.72, '#d5effa');
		sky.addColorStop(1, '#ffe6ba');
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, width, height);

		ctx.fillStyle = 'rgba(255, 239, 178, 0.92)';
		ctx.beginPath();
		ctx.arc(805, 67, 34, 0, Math.PI * 2);
		ctx.fill();
		this.drawCloud(110 - (this.distanceMeters * 0.018 % 1200), 73, 1.05);
		this.drawCloud(540 - (this.distanceMeters * 0.01 % 1200), 116, 0.7);
		this.drawDistantLandscape();
		this.drawFields();
		this.drawCatenary();
		this.drawTrack();
		this.drawStationPlatform();
		this.signals.forEach((signal, index) => this.drawSignal(signal, index));
		this.drawTrain();
		this.drawCabFrame();

		const activeIndex = this.activeSignalIndex();
		if (activeIndex >= 0) {
			const activeSignal = this.signals[activeIndex];
			if (!activeSignal) throw new Error(`Active signal was not found at index ${activeIndex}.`);
			ctx.fillStyle = 'rgba(15, 24, 35, 0.74)';
			this.roundRect(22, 22, 460, 38, 10);
			ctx.fill();
			ctx.fillStyle = '#f5f7fa';
			ctx.font = '600 15px system-ui, sans-serif';
			ctx.fillText(`ASFA · ${SIGNAL_ASPECTS[activeSignal.aspect].label}`, 40, 46, 420);
		}
		if (this.emergencyBrake) {
			ctx.fillStyle = 'rgba(137, 24, 35, 0.9)';
			this.roundRect(width - 365, 22, 340, 38, 10);
			ctx.fill();
			ctx.fillStyle = '#fff';
			ctx.font = '700 15px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText('FRENO DE EMERGENCIA', width - 195, 46);
			ctx.textAlign = 'left';
		}
	}

	private drawCloud(x: number, y: number, scale: number): void {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
		ctx.beginPath();
		ctx.ellipse(x, y, 34 * scale, 15 * scale, 0, Math.PI, 0);
		ctx.ellipse(x + 28 * scale, y - 9 * scale, 24 * scale, 21 * scale, 0, Math.PI, 0);
		ctx.ellipse(x + 55 * scale, y - 2 * scale, 36 * scale, 17 * scale, 0, Math.PI, 0);
		ctx.fill();
	}

	private drawDistantLandscape(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const width = ctx.canvas.width;
		ctx.fillStyle = '#a5c7bb';
		ctx.beginPath();
		ctx.moveTo(0, 236);
		for (let x = -80; x <= width + 100; x += 35) {
			const peak = 181 + Math.sin((x + 80) * 0.012) * 19 + Math.sin(x * 0.027) * 9;
			ctx.lineTo(x, peak);
		}
		ctx.lineTo(width, 302);
		ctx.lineTo(0, 302);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#8ec478';
		ctx.beginPath();
		ctx.moveTo(0, 260);
		for (let x = -60; x <= width + 80; x += 110) {
			const drift = this.distanceMeters * 0.04 % 110;
			ctx.quadraticCurveTo(x + 50 - drift, 224 + Math.sin(x * 0.021) * 13, x + 110 - drift, 260);
		}
		ctx.lineTo(width, 337);
		ctx.lineTo(0, 337);
		ctx.closePath();
		ctx.fill();

		for (let i = 0; i < 7; i++) {
			const x = (i * 179 + 62 - this.distanceMeters * 0.035 % 1240 + 1240) % 1240 - 120;
			const y = 250 + (i % 3) * 12;
			this.drawTree(x, y, 0.45 + (i % 2) * 0.15);
		}
	}

	private drawTree(x: number, y: number, scale: number): void {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.fillStyle = '#735747';
		ctx.fillRect(x - 3 * scale, y - 19 * scale, 6 * scale, 24 * scale);
		ctx.fillStyle = '#347b55';
		ctx.beginPath();
		ctx.arc(x, y - 25 * scale, 14 * scale, 0, Math.PI * 2);
		ctx.arc(x - 10 * scale, y - 17 * scale, 10 * scale, 0, Math.PI * 2);
		ctx.arc(x + 10 * scale, y - 17 * scale, 10 * scale, 0, Math.PI * 2);
		ctx.fill();
	}

	private drawFields(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const width = ctx.canvas.width;
		const field = ctx.createLinearGradient(0, 275, 0, 420);
		field.addColorStop(0, '#95c96c');
		field.addColorStop(1, '#c9a760');
		ctx.fillStyle = field;
		ctx.fillRect(0, 266, width, 154);
		for (let row = 0; row < 8; row++) {
			const y = 277 + row * 15;
			const drift = (this.distanceMeters * (0.045 + row * 0.012)) % 145;
			ctx.strokeStyle = row % 2 ? 'rgba(246, 227, 157, 0.25)' : 'rgba(48, 120, 66, 0.22)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			for (let x = -145 - drift; x < width + 120; x += 145) {
				ctx.moveTo(x, y);
				ctx.lineTo(x + 112, y);
			}
			ctx.stroke();
		}
		for (let i = 0; i < 16; i++) {
			const x = (i * 97 - this.distanceMeters * 0.13 % 1100 + 1100) % 1100 - 50;
			const y = 285 + (i * 31 % 45);
			ctx.fillStyle = i % 3 === 0 ? '#fff0a8' : '#fff8d5';
			ctx.beginPath();
			ctx.arc(x, y, 2.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	private drawCatenary(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const width = ctx.canvas.width;
		const phase = this.distanceMeters * 0.42 % 190;
		for (let i = 0; i < 8; i++) {
			const x = i * 190 - phase;
			if (x < -40 || x > width + 40) continue;
			ctx.strokeStyle = '#5b6c60';
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(x, 297);
			ctx.lineTo(x, 133);
			ctx.moveTo(x - 20, 137);
			ctx.lineTo(x + 43, 137);
			ctx.stroke();
			ctx.strokeStyle = '#7b8c78';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(x + 10, 137);
			ctx.lineTo(x + 10, 295);
			ctx.stroke();
		}
		ctx.strokeStyle = '#485f67';
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.moveTo(0, 142);
		ctx.quadraticCurveTo(width / 2, 130, width, 142);
		ctx.stroke();
		ctx.strokeStyle = '#82918b';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(0, 153);
		ctx.quadraticCurveTo(width / 2, 143, width, 153);
		ctx.stroke();
	}

	private drawTrack(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const { width } = ctx.canvas;
		ctx.fillStyle = '#ad9877';
		ctx.fillRect(0, 320, width, 100);
		ctx.fillStyle = '#817565';
		ctx.fillRect(0, 329, width, 76);

		const sleeperOffset = this.distanceMeters * 1.5 % 46;
		for (let x = -46 - sleeperOffset; x < width + 46; x += 46) {
			ctx.fillStyle = '#51493f';
			ctx.fillRect(x, 340, 30, 55);
			ctx.fillStyle = 'rgba(214, 192, 155, 0.3)';
			ctx.fillRect(x + 3, 343, 3, 48);
		}

		for (const y of [343, 391]) {
			const rail = ctx.createLinearGradient(0, y - 5, 0, y + 7);
			rail.addColorStop(0, '#f1f5ee');
			rail.addColorStop(0.35, '#aebdc0');
			rail.addColorStop(0.55, '#697c83');
			rail.addColorStop(1, '#dbe3dc');
			ctx.fillStyle = rail;
			ctx.fillRect(0, y - 5, width, 11);
			ctx.fillStyle = 'rgba(255,255,255,0.76)';
			ctx.fillRect(0, y - 5, width, 2);
		}
	}

	private drawStationPlatform(): void {
		const ctx = this.ctx;
		if (!ctx || !this.to) return;
		const x = 270 + (STATION_STOP_LINE_METERS - this.distanceMeters) * 0.35;
		if (x < -180 || x > ctx.canvas.width + 180) return;

		ctx.fillStyle = '#d6d0bd';
		ctx.fillRect(x - 115, 307, 230, 14);
		ctx.fillStyle = '#8c928c';
		ctx.fillRect(x - 115, 307, 230, 3);
		ctx.fillStyle = '#f5cf65';
		ctx.fillRect(x - 115, 318, 230, 3);
		ctx.fillStyle = '#5c6d70';
		ctx.fillRect(x - 2, 322, 4, 76);
		ctx.fillStyle = '#f3edda';
		ctx.fillRect(x - 58, 267, 116, 37);
		ctx.strokeStyle = '#59666a';
		ctx.lineWidth = 2;
		ctx.strokeRect(x - 58, 267, 116, 37);
		ctx.fillStyle = '#24323a';
		ctx.font = '600 12px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(this.to.name, x, 285, 106);
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.fillStyle = '#fff2b5';
		ctx.fillRect(x - 4, 324, 8, 70);
		ctx.fillStyle = '#dfad38';
		ctx.fillRect(x - 4, 324, 8, 4);
	}

	private drawSignal(signal: Signal, index: number): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const distanceAhead = signal.distance - this.distanceMeters;
		const x = 620 + distanceAhead * 0.35;
		if (x < -80 || x > ctx.canvas.width + 80) return;
		const scale = Math.max(0.55, Math.min(1.18, 1.08 - distanceAhead / 2400));
		const groundY = 333;
		const lampRadius = 6.7 * scale;
		const lampSpacing = 20 * scale;
		const rowCount = Math.max(1, ...signal.lamps.map(lamp => lamp.row + 1));
		const columnCount = Math.max(1, ...signal.lamps.map(lamp => lamp.column + 1));
		const housingWidth = Math.max(30 * scale, (columnCount - 1) * lampSpacing + 18 * scale);
		const lampBoxHeight = (rowCount - 1) * lampSpacing + 17 * scale;
		const plateSize = 33 * scale;
		const auxiliaryLampBoxSize = signal.auxiliaryLamp ? 25 * scale : 0;
		const auxiliaryLampGap = signal.auxiliaryLamp ? 7 * scale : 0;
		const lampBoxTop = groundY - SIGNAL_HEAD_TOP_OFFSET * scale;
		const lampBoxBottom = lampBoxTop + lampBoxHeight;

		ctx.fillStyle = 'rgba(38, 47, 54, 0.2)';
		ctx.beginPath();
		ctx.ellipse(x + 10 * scale, groundY + 2, 27 * scale, 6 * scale, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#59666a';
		ctx.fillRect(x - 2.3 * scale, lampBoxBottom, 4.6 * scale, groundY - lampBoxBottom);
		ctx.fillStyle = '#36454c';
		ctx.fillRect(x - housingWidth / 2, lampBoxTop, housingWidth, lampBoxHeight);
		ctx.fillStyle = '#829096';
		ctx.fillRect(x - housingWidth / 2, lampBoxTop, 3 * scale, lampBoxHeight);

		signal.lamps.forEach(lamp => {
			const lampX = x + (lamp.column - (columnCount - 1) / 2) * lampSpacing;
			const lampY = lampBoxTop + 8 * scale + lamp.row * lampSpacing;
			this.drawLamp(lampX, lampY, lampRadius, lamp);
		});

		let attachmentY = lampBoxBottom + 9 * scale;
		if (signal.auxiliaryLamp) {
			const auxiliaryBoxTop = lampBoxBottom + auxiliaryLampGap;
			const auxiliaryBoxWidth = 28 * scale;
			ctx.fillStyle = '#36454c';
			ctx.fillRect(x - auxiliaryBoxWidth / 2, auxiliaryBoxTop, auxiliaryBoxWidth, auxiliaryLampBoxSize);
			this.drawLamp(
				x,
				auxiliaryBoxTop + auxiliaryLampBoxSize / 2,
				lampRadius * 0.82,
				signal.auxiliaryLamp,
			);
			attachmentY = auxiliaryBoxTop + auxiliaryLampBoxSize + 9 * scale;
		}

		if (signal.plate !== undefined) {
			ctx.fillStyle = '#070a0c';
			ctx.fillRect(x - plateSize / 2, attachmentY, plateSize, plateSize);
			ctx.strokeStyle = '#596267';
			ctx.lineWidth = Math.max(1, 2 * scale);
			ctx.strokeRect(x - plateSize / 2, attachmentY, plateSize, plateSize);
			ctx.strokeStyle = '#242d32';
			ctx.lineWidth = Math.max(1, scale);
			ctx.strokeRect(x - plateSize / 2 + 3 * scale, attachmentY + 3 * scale, plateSize - 6 * scale, plateSize - 6 * scale);
			ctx.fillStyle = '#f4f7ff';
			ctx.font = `700 ${Math.max(7, 14 * scale)}px ui-monospace, monospace`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.shadowColor = '#dcecff';
			ctx.shadowBlur = 5 * scale;
			ctx.fillText(signal.plate, x, attachmentY + plateSize / 2, plateSize - 6 * scale);
			ctx.shadowBlur = 0;
			ctx.shadowColor = 'transparent';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
			attachmentY += plateSize + 6 * scale;
		}

		if (signal.maxSpeedKmh !== undefined) {
			const speedBoardY = attachmentY;
			const speedBoardWidth = 42 * scale;
			const speedBoardHeight = 28 * scale;
			ctx.fillStyle = '#e7e4d6';
			ctx.fillRect(x - speedBoardWidth / 2, speedBoardY, speedBoardWidth, speedBoardHeight);
			ctx.strokeStyle = '#343d40';
			ctx.lineWidth = Math.max(1, 2 * scale);
			ctx.strokeRect(x - speedBoardWidth / 2, speedBoardY, speedBoardWidth, speedBoardHeight);
			ctx.fillStyle = '#20292e';
			ctx.font = `700 ${Math.max(7, 12 * scale)}px system-ui, sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(signal.maxSpeedKmh), x, speedBoardY + speedBoardHeight / 2, speedBoardWidth - 4 * scale);
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
		}

		if (this.acknowledgedSignals.has(index) && x > -20 && x < ctx.canvas.width + 20) {
			ctx.fillStyle = '#e8f3f7';
			ctx.font = `600 ${Math.max(8, 10 * scale)}px system-ui, sans-serif`;
			ctx.textAlign = 'center';
			ctx.fillText('RECONOCIDA', x, groundY + 22 * scale);
			ctx.textAlign = 'left';
		}
	}

	private drawLamp(x: number, y: number, radius: number, lamp: SignalLamp | SignalAuxiliaryLamp): void {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.fillStyle = '#10171b';
		ctx.beginPath();
		ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
		ctx.fill();
		const illuminated = lamp.state === 'on'
			|| (lamp.state === 'blink' && Math.floor(this.driveElapsedSec * 2) % 2 === 0);
		const color = LAMP_HEX[lamp.color];
		if (illuminated) {
			const glow = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius * 2.3);
			glow.addColorStop(0, color);
			glow.addColorStop(1, `${color}00`);
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(x, y, radius * 2.3, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.fillStyle = illuminated ? color : '#20282c';
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = illuminated ? 'rgba(255,255,255,0.72)' : '#596267';
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	private drawCabFrame(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const { width, height } = ctx.canvas;
		ctx.strokeStyle = 'rgba(30, 53, 65, 0.55)';
		ctx.lineWidth = 8;
		ctx.strokeRect(4, 4, width - 8, height - 8);
	}

	private drawTrain(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const x = 92;
		const y = 267;

		ctx.fillStyle = 'rgba(52, 55, 46, 0.25)';
		ctx.beginPath();
		ctx.ellipse(x + 84, 339, 96, 10, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#23495b';
		ctx.fillRect(x + 15, y + 37, 144, 35);
		ctx.fillStyle = '#e8f2f1';
		ctx.beginPath();
		ctx.moveTo(x, y + 46);
		ctx.lineTo(x + 25, y + 14);
		ctx.quadraticCurveTo(x + 34, y + 3, x + 52, y + 3);
		ctx.lineTo(x + 143, y + 3);
		ctx.quadraticCurveTo(x + 161, y + 3, x + 169, y + 23);
		ctx.lineTo(x + 178, y + 46);
		ctx.lineTo(x + 178, y + 67);
		ctx.lineTo(x, y + 67);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#2496bd';
		ctx.beginPath();
		ctx.moveTo(x + 34, y + 16);
		ctx.lineTo(x + 145, y + 16);
		ctx.lineTo(x + 157, y + 41);
		ctx.lineTo(x + 19, y + 41);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#d5f6ff';
		ctx.beginPath();
		ctx.moveTo(x + 41, y + 19);
		ctx.lineTo(x + 70, y + 19);
		ctx.lineTo(x + 70, y + 36);
		ctx.lineTo(x + 29, y + 36);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#17303b';
		for (const wheelX of [x + 42, x + 125]) {
			ctx.beginPath();
			ctx.arc(wheelX, y + 71, 10, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#afc2c2';
			ctx.beginPath();
			ctx.arc(wheelX, y + 71, 4, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#17303b';
		}
		ctx.fillStyle = '#fff1aa';
		ctx.beginPath();
		ctx.arc(x + 170, y + 47, 4, 0, Math.PI * 2);
		ctx.fill();
	}

	private roundRect(x: number, y: number, width: number, height: number, radius: number): void {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.beginPath();
		ctx.roundRect(x, y, width, height, radius);
	}

	exit(): void {
		this.canvas = null;
		this.ctx = null;
		this.root = null;
	}
}
