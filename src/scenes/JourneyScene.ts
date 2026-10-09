import type { Scene, SceneManager } from '../core/SceneManager';

export class JourneyScene implements Scene {
    private manager: SceneManager

    constructor(manager: SceneManager) {
        this.manager = manager;
    }

    enter(root: HTMLElement): void {
        root.innerHTML = `
        <div class="scene">
            <h2>Journey</h2>
            <p>You are at <strong>Madrid-Atocha</strong>.</p>
            <div class="placeholder">[ map goes here ]</div>
            <button id="drive">Drive to next station</button>
            <button id="menu">Back to menu</button>
        </div>
        `;
        root.querySelector<HTMLButtonElement>('#drive')!
        .addEventListener('click', () => this.manager.switchTo('drive'));
        root.querySelector<HTMLButtonElement>('#menu')!
        .addEventListener('click', () => this.manager.switchTo('menu'));
    }

    exit(): void {}
    update(): void {}
    render(): void {}
}