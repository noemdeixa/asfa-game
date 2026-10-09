import type { Scene, SceneManager } from '../core/SceneManager';

export class MenuScene implements Scene {
    private manager: SceneManager;

    constructor(manager: SceneManager) {
        this.manager = manager;
    }

    enter(root: HTMLElement): void {
        root.innerHTML = `
        <div class="scene">
            <h1>Rail Trainer</h1>
            <p>Drive trains across Spain. Learn the protection systems.</p>
            <button id="start">Start Run</button>
        </div>
        `;
        root.querySelector<HTMLButtonElement>('#start')!
        .addEventListener('click', () => this.manager.switchTo('journey'));
    }

    exit(): void {}
    update(): void {}
    render(): void {}
}