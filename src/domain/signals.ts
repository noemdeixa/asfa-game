export type LampColor = 'red' | 'amber' | 'green' | 'white';
export type LampState = 'on' | 'off' | 'blink';

export interface SignalLamp {
	color: LampColor;
	state: LampState;
	row: number;
	column: number;
}

export interface SignalAuxiliaryLamp {
	color: 'white';
	state: 'on' | 'blink';
}

export interface SignalPattern {
	lamps: readonly SignalLamp[];
	auxiliaryLamp?: SignalAuxiliaryLamp;
}

const THREE_LAMP_COLORS = ['green', 'red', 'amber'] as const;

function threeLampPattern(activeStates: readonly [LampState, LampState, LampState]): SignalPattern {
	return {
		lamps: THREE_LAMP_COLORS.map((color, row) => ({
			color,
			state: activeStates[row]!,
			row,
			column: 0,
		})),
	};
}

export const SIGNAL_PATTERNS = {
	red: threeLampPattern(['off', 'on', 'off']),
	whiteAuxiliary: {
		...threeLampPattern(['off', 'on', 'off']),
		auxiliaryLamp: { color: 'white', state: 'on' },
	},
	flashingWhite: {
		...threeLampPattern(['off', 'on', 'off']),
		auxiliaryLamp: { color: 'white', state: 'blink' },
	},

	amber: threeLampPattern(['off', 'off', 'on']),
	flashingAmber: threeLampPattern(['off', 'off', 'blink']),

	green: threeLampPattern(['on', 'off', 'off']),
	conditionalProceed: threeLampPattern(['blink', 'off', 'off']),

	greenamber: threeLampPattern(['on', 'off', 'on']),
} as const satisfies Record<string, SignalPattern>;

export type SignalPatternId = keyof typeof SIGNAL_PATTERNS;

export interface SignalAspectDefinition {
	label: string;
	pattern: SignalPatternId;
}

export const SIGNAL_ASPECTS = {
	stop: { label: 'Parada', pattern: 'red' },
	
	stopOverride: { label: 'Rebase autorizado', pattern: 'whiteAuxiliary' },
	stopOverrideFlashing: { label: 'Rebase autorizado', pattern: 'flashingWhite' },
	
	preStopAhead: { label: 'Preanuncio de parada', pattern: 'flashingAmber' },
	stopAhead: { label: 'Anuncio de parada', pattern: 'amber' },
	stopAheadClose: { label: 'Anuncio de parada inmediata', pattern: 'flashingAmber' },

	caution: { label: 'Anuncio de precaución', pattern: 'greenamber' },

	proceed: { label: 'Vía libre', pattern: 'green' },
	conditionalProceed: { label: 'Vía libre condicional', pattern: 'conditionalProceed' },
} as const satisfies Record<string, SignalAspectDefinition>;

export type SignalAspect = keyof typeof SIGNAL_ASPECTS;

export interface Signal {
	distance: number;
	aspect: SignalAspect;
	lamps: readonly SignalLamp[];
	auxiliaryLamp?: SignalAuxiliaryLamp;
	maxSpeedKmh?: number;
	plate?: string;
}

const SIGNAL_PLATES = ['P', '7', '12', '8 →', '14 ←'];
const DEMO_ROUTE_SIGNALS: readonly {
	distance: number;
	aspect: SignalAspect;
	plate?: string;
	maxSpeedKmh?: number;
}[] = [
	{ distance: 100, aspect: 'stop', plate: 'P' },
	{ distance: 210, aspect: 'stopOverride' },
	{ distance: 320, aspect: 'stopOverrideFlashing', plate: '7' },
	{ distance: 430, aspect: 'preStopAhead', plate: '12' },
	{ distance: 540, aspect: 'stopAhead' },
	{ distance: 650, aspect: 'stopAheadClose', plate: '8 →' },
	{ distance: 760, aspect: 'caution', plate: '14 ←' },
	{ distance: 980, aspect: 'proceed' },
	{ distance: 1090, aspect: 'conditionalProceed', plate: 'P', maxSpeedKmh: 30 },
];

function aspectForNextSignal(nextAspect: SignalAspect): SignalAspect {
	return nextAspect === 'stop' ? 'caution' : 'proceed';
}

export function createSignalSequence(
	distances: readonly number[],
	terminalAspect: SignalAspect,
): Signal[] {
	for (let index = 0; index < distances.length; index++) {
		const distance = distances[index];
		if (distance === undefined || !Number.isFinite(distance) || distance < 0
			|| (index > 0 && distance <= distances[index - 1]!)) {
			throw new Error('Signal distances must be finite, non-negative, and in ascending order.');
		}
	}

	const aspects = new Array<SignalAspect>(distances.length);
	let nextAspect = terminalAspect;
	for (let index = distances.length - 1; index >= 0; index--) {
		const aspect = index === distances.length - 1
			? terminalAspect
			: aspectForNextSignal(nextAspect);
		aspects[index] = aspect;
		nextAspect = aspect;
	}

	return distances.map((distance, index): Signal => {
		const resolvedAspect = aspects[index];
		if (!resolvedAspect) throw new Error(`Signal aspect was not resolved at index ${index}.`);
		const pattern = SIGNAL_PATTERNS[SIGNAL_ASPECTS[resolvedAspect].pattern];
		return {
			distance,
			aspect: resolvedAspect,
			lamps: pattern.lamps,
			...(pattern.auxiliaryLamp ? { auxiliaryLamp: pattern.auxiliaryLamp } : {}),
			plate: SIGNAL_PLATES[index % SIGNAL_PLATES.length]!,
		};
	});
}

export function createDemoSignals(): Signal[] {
	return DEMO_ROUTE_SIGNALS.map(({ distance, aspect, plate, maxSpeedKmh }) => {
		const pattern = SIGNAL_PATTERNS[SIGNAL_ASPECTS[aspect].pattern];
		return {
			distance,
			aspect,
			lamps: pattern.lamps,
			...(pattern.auxiliaryLamp ? { auxiliaryLamp: pattern.auxiliaryLamp } : {}),
			...(plate === undefined ? {} : { plate }),
			...(maxSpeedKmh === undefined ? {} : { maxSpeedKmh }),
		};
	});
}
