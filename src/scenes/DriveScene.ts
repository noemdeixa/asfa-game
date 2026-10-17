import type { Scene, SceneManager } from '../core/SceneManager';
import heroineUrl from '../assets/heroine.png';
import mountainBackgroundUrl from '../assets/bg_mountains.png';
import trackBackgroundUrl from '../assets/bg_tracks.png';
import { STATIONS, SEGMENTS, type Station } from '../data/network';
import { createDemoSignals, SIGNAL_ASPECTS, type Signal, type SignalAuxiliaryLamp, type SignalLamp } from '../domain/signals';
import { MAX_BRAKING_KN, MAX_TRACTION_KN, TrainPhysics } from '../domain/TrainPhysics';
import type { JourneyDifficulty } from './JourneyScene';

interface DriveParams {
	fromId: string;
	toId: string;
	objectiveId: string;
	difficulty: JourneyDifficulty;
	elapsedSec: number;
	returnToMenu?: boolean;
}

interface WheelSpark {
	x: number;
	y: number;
	vx: number;
	vy: number;
	lifeSec: number;
	maxLifeSec: number;
	size: number;
}

export const FIXED_DRIVE_DISTANCE_METERS = 1200;
const TEST_STARTING_SPEED_KMH = 0;
const STOP_LINE_TOLERANCE_METERS = 8;
const STOP_SPEED_TOLERANCE_KMH = 1;
const MOUNTAIN_PARALLAX_PIXELS_PER_METER = 0.08;
const TRACK_SCROLL_PIXELS_PER_METER = 8;
const TRAIN_REVEAL_SPEED_KMH = 90;
const TRAIN_BOB_TIMES_SEC = [1.2, 5.1, 10.6, 14.4, 21.2, 25.8];
const TRAIN_BOB_CYCLE_SEC = 33;
const TRAIN_BOB_DURATION_SEC = 0.65;
const TRAIN_BOB_HEIGHT = 1.5;
const WHEEL_POSITIONS = [0.085, 0.2, 0.63, 0.75];
const MAX_SPARKS = 160;
const WHEEL_SPARK_VERTICAL_OFFSET_PX = 16;
const MIN_SPARK_ACCELERATION_MPS2 = 0.015;
const HARSH_ACCELERATION_THRESHOLD_MPS2 = 0.35;
const HIGH_SPEED_ACCELERATION_THRESHOLD_KMH = 30;
const MAX_SPARK_RATE_PER_SEC = 24;
const HIGH_SPEED_ACCELERATION_SPARK_MULTIPLIER = 0.01;
const TRACTION_SPARK_RATE_EXPONENT = 2;
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
	private trainSprite = new Image();
	private mountainSprite = new Image();
	private trackSprite = new Image();
	private manager: SceneManager;
	private params: DriveParams | null = null;
	private from: Station | null = null;
	private to: Station | null = null;
	private throttle = 0;
	private physics = new TrainPhysics();
	private driveElapsedSec = 0;
	private arrivedAtStation = false;
	private missedStation = false;
	private recognitionFeedbackSec = 0;
	private acknowledgedSignals = new Set<number>();
	private signals: Signal[] = [];
	private wheelSparks: WheelSpark[] = [];
	private root: HTMLElement | null = null;

	constructor(manager: SceneManager) {
		this.manager = manager;
	}

	enter(root: HTMLElement, params?: unknown): void {
		if (typeof params !== 'object' || params === null || !('fromId' in params)
			|| !('toId' in params) || !('objectiveId' in params) || !('difficulty' in params)
			|| !('elapsedSec' in params)
			|| ('returnToMenu' in params && typeof params.returnToMenu !== 'boolean')) {
			throw new Error('Drive scene requires journey parameters.');
		}

		const { fromId, toId, objectiveId, difficulty, elapsedSec, returnToMenu = false } = params as {
			fromId: unknown;
			toId: unknown;
			objectiveId: unknown;
			difficulty: unknown;
			elapsedSec: unknown;
			returnToMenu?: unknown;
		};
		if (typeof fromId !== 'string' || typeof toId !== 'string' || typeof objectiveId !== 'string'
			|| !isJourneyDifficulty(difficulty) || typeof elapsedSec !== 'number' || !Number.isFinite(elapsedSec)
			|| typeof returnToMenu !== 'boolean') {
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
		this.params = { fromId, toId, objectiveId, difficulty, elapsedSec, returnToMenu };
		this.throttle = 0;
		this.physics.reset(TEST_STARTING_SPEED_KMH);
		this.driveElapsedSec = 0;
		this.arrivedAtStation = false;
		this.missedStation = false;
		this.recognitionFeedbackSec = 0;
		this.acknowledgedSignals.clear();
		this.wheelSparks = [];
		this.signals = createDemoSignals();
		this.trainSprite.src = heroineUrl;
		this.mountainSprite.src = mountainBackgroundUrl;
		this.trackSprite.src = trackBackgroundUrl;

		root.innerHTML = `
			<div class="scene drive-scene">
				<header class="drive-heading">

					<p class="drive-route">${from.name} <span aria-hidden="true">-></span> ${to.name}</p>
				</header>
				<div class="drive-readouts">
					<div class="drive-stat"><span>STATION APPROACH</span><strong><span id="distance">0</span><small> / ${FIXED_DRIVE_DISTANCE_METERS} m</small></strong></div>
					<div id="brake-state" class="brake-state" aria-live="polite">ASFA OK!</div>
				</div>
				<div class="drive-cab">
					<canvas id="view" width="1000" height="420" aria-label="Pixel-art city hopper train driven by a chibi woman, passing city scenery and railway signals"></canvas>
					<div class="cab-dashboard">
						<div class="dashboard-heading"><span>Driver controls</span></div>
						<div class="dashboard-display">
							<span>TRAIN SPEED</span>
							<strong><span id="cab-speed">0</span><small> km/h</small></strong>
						</div>
						<div class="throttle-control">
							<div class="throttle-scale"><span>GO +${MAX_TRACTION_KN}</span><span>COAST</span><span>BRAKE -${MAX_BRAKING_KN}</span></div>
							<input id="throttle" type="range" min="-100" max="100" step="1" value="0" aria-label="Combined traction and braking lever">
							<label for="throttle">POWER LEVER <strong id="throttle-value">0 kN · coast</strong></label>
						</div>
					</div>
				</div>
				<p class="drive-prototype-note">Watch for signals and bring your train to a gentle stop at the platform.</p>
				<div class="drive-controls">
					<button id="recognize" disabled>ASFA · Reconocer señal</button>
					<button id="reset-brake" hidden>Rearmar freno de emergencia</button>
					<span id="signal-status" aria-live="polite">No hay señal que reconocer.</span>
				</div>
				<div id="station-warning" class="station-warning" role="status" hidden></div>
				<div id="station-outcome" class="journey-banner drive-outcome" hidden>
					<strong id="station-outcome-message"></strong>
					<button id="continue">${returnToMenu ? 'Finish drive' : 'Continue journey'}</button>
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
			if (this.physics.emergencyBrakeActive) return;
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
			&& signal.distance >= this.physics.distanceMeters
			&& signal.distance - this.physics.distanceMeters <= 230,
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
		if (!this.physics.resetEmergencyBrake()) return;
		const resetButton = this.root?.querySelector<HTMLButtonElement>('#reset-brake');
		const throttleInput = this.root?.querySelector<HTMLInputElement>('#throttle');
		const brakeState = this.root?.querySelector<HTMLElement>('#brake-state');
		if (resetButton) resetButton.hidden = true;
		if (throttleInput) throttleInput.disabled = false;
		if (brakeState) {
			brakeState.textContent = 'ASFA OK!';
			brakeState.classList.remove('is-emergency');
		}
	}

	private arrive(): void {
		if (!this.params || !this.from || !this.to) return;
		if (this.params.returnToMenu) {
			this.manager.switchTo('menu', { difficulty: this.params.difficulty });
			return;
		}
		this.manager.switchTo('journey', {
			...this.params,
			currentId: this.to.id,
			elapsedSec: this.params.elapsedSec + this.driveElapsedSec,
		});
	}

	private completeStationStop(): void {
		this.arrivedAtStation = true;
		this.physics.stopAtStation();
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
		if (!this.root) return;
		if (this.arrivedAtStation) {
			this.updateWheelSparks(dt);
			return;
		}
		const { previousDistanceMeters, emergencyBrakeActivated, accelerationMps2 } =
			this.physics.update(dt, this.throttle);
		if (emergencyBrakeActivated) {
			this.throttle = 0;
			const throttleInput = this.root.querySelector<HTMLInputElement>('#throttle');
			const throttleValue = this.root.querySelector<HTMLElement>('#throttle-value');
			if (throttleInput) {
				throttleInput.value = '0';
				throttleInput.disabled = true;
			}
			if (throttleValue) throttleValue.textContent = this.leverDescription();
		}
		this.updateWheelSparks(dt, accelerationMps2);
		if (this.physics.emergencyBrakeActive && this.physics.speedKmh === 0) {
			const resetButton = this.root.querySelector<HTMLButtonElement>('#reset-brake');
			if (resetButton) resetButton.hidden = false;
		}
		this.driveElapsedSec += dt;
		// A frame may cross the stopping marker, so judge both its endpoints.
		if (!this.missedStation && previousDistanceMeters < FIXED_DRIVE_DISTANCE_METERS
			&& this.physics.distanceMeters >= FIXED_DRIVE_DISTANCE_METERS) {
			if (this.physics.speedKmh <= STOP_SPEED_TOLERANCE_KMH
				&& Math.abs(this.physics.distanceMeters - FIXED_DRIVE_DISTANCE_METERS) <= STOP_LINE_TOLERANCE_METERS) {
				this.completeStationStop();
			} else {
				this.markStationMissed();
			}
		} else if (!this.missedStation && this.physics.speedKmh <= STOP_SPEED_TOLERANCE_KMH
			&& Math.abs(this.physics.distanceMeters - FIXED_DRIVE_DISTANCE_METERS) <= STOP_LINE_TOLERANCE_METERS) {
			this.completeStationStop();
		}
		const speed = this.root.querySelector<HTMLElement>('#speed');
		const distance = this.root.querySelector<HTMLElement>('#distance');
		const recognizeButton = this.root.querySelector<HTMLButtonElement>('#recognize');
		const outcome = this.root.querySelector<HTMLElement>('#station-outcome');
		const signalStatus = this.root.querySelector<HTMLElement>('#signal-status');
		const brakeState = this.root.querySelector<HTMLElement>('#brake-state');
		this.recognitionFeedbackSec = Math.max(0, this.recognitionFeedbackSec - dt);
		if (speed) speed.textContent = Math.round(this.physics.speedKmh).toString();
		const cabSpeed = this.root.querySelector<HTMLElement>('#cab-speed');
		if (cabSpeed) cabSpeed.textContent = Math.round(this.physics.speedKmh).toString();
		if (distance) distance.textContent = Math.round(this.physics.distanceMeters).toString();
		if (brakeState && this.physics.emergencyBrakeActive) {
			brakeState.textContent = 'FRENO DE EMERGENCIA';
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

		if (this.missedStation && this.physics.speedKmh <= STOP_SPEED_TOLERANCE_KMH && outcome?.hidden) {
			outcome.hidden = false;
			const message = this.root.querySelector<HTMLElement>('#station-outcome-message');
			if (message && this.to) {
				message.textContent = `Stopped beyond ${this.to.name}. The station stop was missed.`;
			}
			const continueButton = this.root.querySelector<HTMLButtonElement>('#continue');
			if (continueButton) continueButton.textContent = this.params?.returnToMenu ? 'Finish drive' : 'Continue journey';
			if (recognizeButton) recognizeButton.disabled = true;
		}
	}

	render(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) return;
		const { width, height } = canvas;

		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, width, height);
		this.drawMountainBackground();
		this.drawTrackBackground();
		// this.drawCatenary();
		// this.drawStationPlatform();
		// this.signals.forEach((signal, index) => this.drawSignal(signal, index));
		this.drawTrain();
		this.drawWheelSparks();
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
		if (this.physics.emergencyBrakeActive) {
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

	private drawMountainBackground(): void {
		const ctx = this.ctx;
		const image = this.mountainSprite;
		if (!ctx || !image.complete || image.naturalWidth === 0) return;
		const scale = ctx.canvas.height / image.naturalHeight;
		const imageWidth = image.naturalWidth * scale;
		const maxOffset = Math.max(0, imageWidth - ctx.canvas.width);
		const offsetX = -Math.min(maxOffset, this.physics.distanceMeters * MOUNTAIN_PARALLAX_PIXELS_PER_METER);
		ctx.drawImage(image, offsetX, 0, imageWidth, ctx.canvas.height);
	}

	private drawTrackBackground(): void {
		const ctx = this.ctx;
		const image = this.trackSprite;
		if (!ctx || !image.complete || image.naturalWidth === 0) return;
		const scale = ctx.canvas.height / image.naturalHeight;
		const tileWidth = image.naturalWidth * scale;
		const offsetX = -(this.physics.distanceMeters * TRACK_SCROLL_PIXELS_PER_METER % tileWidth);
		const offsetY = 22;
		for (let x = offsetX; x < ctx.canvas.width; x += tileWidth) {
			ctx.drawImage(image, x, offsetY, tileWidth, ctx.canvas.height);
		}
	}
	
	private drawCatenary(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const width = ctx.canvas.width;
		const phase = this.physics.distanceMeters * 0.42 % 190;
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

	private drawStationPlatform(): void {
		const ctx = this.ctx;
		if (!ctx || !this.to) return;
		const x = 270 + (FIXED_DRIVE_DISTANCE_METERS - this.physics.distanceMeters) * 0.35;
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
		const distanceAhead = signal.distance - this.physics.distanceMeters;
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
		const bounds = this.trainBounds();
		if (!ctx || !bounds) return;
		ctx.drawImage(this.trainSprite, bounds.x, bounds.y, bounds.width, bounds.height);
	}

	private trainBounds(): { x: number; y: number; width: number; height: number } | null {
		const ctx = this.ctx;
		if (!ctx || !this.trainSprite.complete || this.trainSprite.naturalWidth === 0) return null;
		const aspectRatio = this.trainSprite.naturalWidth / this.trainSprite.naturalHeight;
		const width = Math.min(540, ctx.canvas.width - 16, (ctx.canvas.height - 16) * aspectRatio);
		const height = width * this.trainSprite.naturalHeight / this.trainSprite.naturalWidth;
		const reveal = Math.max(0, Math.min(1, this.physics.speedKmh / TRAIN_REVEAL_SPEED_KMH));

		const trainWidth = Math.min(
			540,
			ctx.canvas.width - 16,
			(ctx.canvas.height - 16) * aspectRatio,
		);

		const maxX = 0;
		const minX = -(trainWidth - 160);

		const x = minX + (maxX - minX) * reveal;
		const bobPhase = this.driveElapsedSec % TRAIN_BOB_CYCLE_SEC;
		const bobStart = TRAIN_BOB_TIMES_SEC.find(time =>
			bobPhase >= time && bobPhase < time + TRAIN_BOB_DURATION_SEC,
		);
		const bobProgress = bobStart === undefined ? 0 : (bobPhase - bobStart) / TRAIN_BOB_DURATION_SEC;
		const bob = this.physics.speedKmh > 0
			? Math.sin(bobProgress * Math.PI) * TRAIN_BOB_HEIGHT
			: 0;
		const y = Math.min(ctx.canvas.height - height - 8, Math.max(8, ctx.canvas.height - height - 10 + bob));
		return { x, y, width, height };
	}

	private updateWheelSparks(dt: number, accelerationMps2 = 0): void {
		for (const spark of this.wheelSparks) {
			spark.lifeSec -= dt;
			spark.x += spark.vx * dt;
			spark.y += spark.vy * dt;
			spark.vy += 100 * dt;
		}
		this.wheelSparks = this.wheelSparks.filter(spark => spark.lifeSec > 0);

		const speedFactor = Math.min(1, this.physics.speedKmh / 20);
		const accelerationMagnitude = Math.abs(accelerationMps2);
		const isBraking = this.throttle < 0 || this.physics.emergencyBrakeActive;
		const isForwardAcceleration = this.throttle > 0 && accelerationMps2 > 0;
		const highSpeedAcceleration = isForwardAcceleration
			&& this.physics.speedKmh > HIGH_SPEED_ACCELERATION_THRESHOLD_KMH;
		const minimumAcceleration = isBraking || highSpeedAcceleration
			? MIN_SPARK_ACCELERATION_MPS2
			: isForwardAcceleration
				? HARSH_ACCELERATION_THRESHOLD_MPS2
				: Number.POSITIVE_INFINITY;
		const tractionFactor = Math.pow(this.throttle / 100, TRACTION_SPARK_RATE_EXPONENT);
		const accelerationSparkMultiplier = isBraking
			? 1
			: tractionFactor * (highSpeedAcceleration ? HIGH_SPEED_ACCELERATION_SPARK_MULTIPLIER : 1);
		const sparkRate = accelerationMagnitude < minimumAcceleration
			? 0
			: Math.min(MAX_SPARK_RATE_PER_SEC, accelerationMagnitude * 40)
				* speedFactor * accelerationSparkMultiplier;
		if (sparkRate === 0 || Math.random() >= 1 - Math.exp(-sparkRate * dt)) return;

		const bounds = this.trainBounds();
		const ctx = this.ctx;
		if (!bounds || !ctx) return;
		const wheelX = WHEEL_POSITIONS[Math.floor(Math.random() * WHEEL_POSITIONS.length)];
		if (wheelX === undefined) return;
		const x = bounds.x + bounds.width * wheelX;
		const y = bounds.y + bounds.height * 0.8 - WHEEL_SPARK_VERTICAL_OFFSET_PX;
		if (x < 0 || x > ctx.canvas.width || y < 0 || y > ctx.canvas.height) return;

		const count = 4 + Math.floor(Math.random() * 5);
		for (let i = 0; i < count && this.wheelSparks.length < MAX_SPARKS; i++) {
			this.wheelSparks.push({
				x,
				y,
				vx: -35 - Math.random() * 90,
				vy: -25 - Math.random() * 100,
				lifeSec: 0.12 + Math.random() * 0.2,
				maxLifeSec: 0.32,
				size: 1.5 + Math.random() * 2,
			});
		}
	}

	private drawWheelSparks(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		for (const spark of this.wheelSparks) {
			const alpha = Math.max(0, spark.lifeSec / spark.maxLifeSec);
			ctx.globalAlpha = alpha;
			ctx.fillStyle = '#fff2a6';
			ctx.fillRect(spark.x, spark.y, spark.size, spark.size);
			ctx.fillStyle = '#ff9d43';
			ctx.fillRect(spark.x - 1, spark.y + 1, spark.size, Math.max(1, spark.size - 1));
		}
		ctx.globalAlpha = 1;
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
