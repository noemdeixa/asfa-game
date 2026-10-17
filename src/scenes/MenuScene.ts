import type { Scene, SceneManager } from '../core/SceneManager';
import type { JourneyDifficulty } from './JourneyScene';
import { FIXED_DRIVE_DISTANCE_METERS } from './DriveScene';

export class MenuScene implements Scene {
    private manager: SceneManager;
    private difficulty: JourneyDifficulty = 'full-map';

    constructor(manager: SceneManager) {
        this.manager = manager;
    }

    enter(root: HTMLElement, params?: unknown): void {
        if (typeof params === 'object' && params !== null && 'difficulty' in params) {
            const difficulty = params.difficulty;
            if (difficulty === 'full-map' || difficulty === 'nearby' || difficulty === 'station-names') {
                this.difficulty = difficulty;
            }
        }
        root.innerHTML = `
        <div class="scene">
            <h1>Pocholo Adventures</h1>
            <label for="difficulty">Difficulty</label>
            <select id="difficulty">
                <option value="full-map">Full map — see every station and name</option>
                <option value="nearby">Nearby — see only stations next to you</option>
                <option value="station-names">Station names — identify your next stop by name</option>
            </select>
            <button id="start">Start Journey</button>
            <button id="start-drive">Start ${FIXED_DRIVE_DISTANCE_METERS.toLocaleString()} m Drive</button>
        </div>
        `;
        const difficultySelect = root.querySelector<HTMLSelectElement>('#difficulty')!;
        difficultySelect.value = this.difficulty;
        difficultySelect.addEventListener('change', () => {
            const selectedDifficulty = difficultySelect.value;
            if (selectedDifficulty === 'full-map' || selectedDifficulty === 'nearby' || selectedDifficulty === 'station-names') {
                this.difficulty = selectedDifficulty;
            }
        });
        root.querySelector<HTMLButtonElement>('#start')!
            .addEventListener('click', () => this.manager.switchTo('journey', { difficulty: this.difficulty }));
        root.querySelector<HTMLButtonElement>('#start-drive')!
            .addEventListener('click', () => this.manager.switchTo('drive', {
                fromId: 'mad',
                toId: 'gua',
                objectiveId: 'gua',
                difficulty: this.difficulty,
                elapsedSec: 0,
                returnToMenu: true,
            }));
    }

    exit(): void {}
    update(): void {}
    render(): void {}
}