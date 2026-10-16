export const MAX_TRACTION_KN = 250;
export const MAX_BRAKING_KN = 350;

const TRAIN_MASS_KG = 400_000;
const EMERGENCY_BRAKING_KN = 450;
const ROLLING_RESISTANCE_COEFFICIENT = 0.0015;
const AERODYNAMIC_DRAG_COEFFICIENT = 4.6;
const EMERGENCY_BRAKE_LIMIT_KMH = 125;

export interface TrainPhysicsStep {
	previousDistanceMeters: number;
	emergencyBrakeActivated: boolean;
}

/**
 * Simplified train dynamics for the driving demo, with speed in km/h,
 * distance in metres, throttle as a percentage, and elapsed time in seconds.
 */
export class TrainPhysics {
	private currentSpeedKmh = 0;
	private currentDistanceMeters = 0;
	private emergencyBrakeApplied = false;

	get speedKmh(): number {
		return this.currentSpeedKmh;
	}

	get distanceMeters(): number {
		return this.currentDistanceMeters;
	}

	get emergencyBrakeActive(): boolean {
		return this.emergencyBrakeApplied;
	}

	reset(): void {
		this.currentSpeedKmh = 0;
		this.currentDistanceMeters = 0;
		this.emergencyBrakeApplied = false;
	}

	/**
	 * Integrates traction, braking, and resistance over one frame.
	 * Returns whether overspeed protection activated during this step.
	 */
	update(dt: number, throttlePercent: number): TrainPhysicsStep {
		const previousDistanceMeters = this.currentDistanceMeters;
		const speedMps = this.currentSpeedKmh / 3.6;
		const tractionN = Math.max(0, throttlePercent) / 100 * MAX_TRACTION_KN * 1000;
		const brakingN = this.emergencyBrakeApplied
			? EMERGENCY_BRAKING_KN * 1000
			: Math.abs(Math.min(0, throttlePercent)) / 100 * MAX_BRAKING_KN * 1000;
		const rollingResistanceN = speedMps > 0
			? TRAIN_MASS_KG * 9.81 * ROLLING_RESISTANCE_COEFFICIENT
			: 0;
		const aerodynamicDragN = AERODYNAMIC_DRAG_COEFFICIENT * speedMps * speedMps;
		const resistanceN = speedMps > 0 ? rollingResistanceN + aerodynamicDragN : 0;
		const accelerationMps2 = (tractionN - brakingN - resistanceN) / TRAIN_MASS_KG;
		const nextSpeedMps = Math.max(0, speedMps + accelerationMps2 * dt);
		this.currentSpeedKmh = nextSpeedMps * 3.6;

		const emergencyBrakeActivated = this.currentSpeedKmh > EMERGENCY_BRAKE_LIMIT_KMH
			&& !this.emergencyBrakeApplied;
		if (emergencyBrakeActivated) this.emergencyBrakeApplied = true;

		// Average speed gives a better distance step than using either frame endpoint.
		this.currentDistanceMeters += (speedMps + nextSpeedMps) / 2 * dt;

		return { previousDistanceMeters, emergencyBrakeActivated };
	}

	stopAtStation(): void {
		this.currentSpeedKmh = 0;
	}

	resetEmergencyBrake(): boolean {
		if (!this.emergencyBrakeApplied || this.currentSpeedKmh > 0) return false;
		this.emergencyBrakeApplied = false;
		return true;
	}
}
