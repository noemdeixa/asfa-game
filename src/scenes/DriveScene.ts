import type { Scene, SceneManager } from '../core/SceneManager';

export class DriveScene implements Scene {
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private t = 0;
	private manager: SceneManager;

	constructor(manager: SceneManager) {
		this.manager = manager;
	}

	enter(root: HTMLElement): void {
		root.innerHTML = `
		<div class="scene">
			<h2>Driving</h2>
			<canvas id="view" width="800" height="300"></canvas>
			<button id="back">Back to journey</button>
		</div>
		`;
		this.canvas = root.querySelector<HTMLCanvasElement>('#view')!;
		this.ctx = this.canvas.getContext('2d');
		this.t = 0;

		root.querySelector<HTMLButtonElement>('#back')!
		.addEventListener('click', () => this.manager.switchTo('journey'));
	}

	update(dt: number): void {
		this.t += dt;
	}

	render(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) return;

		const w = canvas.width;
		const h = canvas.height;

		ctx.fillStyle = '#1a2030';
		ctx.fillRect(0, 0, w, h);

		ctx.fillStyle = '#2b3242';
		ctx.fillRect(0, h - 80, w, 80);

		const x = ((this.t * 100) % (w + 100)) - 50;
		ctx.fillStyle = '#e6e9ef';
		ctx.fillRect(x, h - 110, 80, 30);

		ctx.fillStyle = '#9aa4b8';
		ctx.font = '14px monospace';
		ctx.fillText(`t = ${this.t.toFixed(1)} s`, 12, 22);
	}

	exit(): void {}
}