import './styles.css';
import { SceneManager } from './core/SceneManager';
import { MenuScene } from './scenes/MenuScene';
import { JourneyScene } from './scenes/JourneyScene';
import { DriveScene } from './scenes/DriveScene';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

const manager = new SceneManager(root);
manager.register('menu', () => new MenuScene(manager));
manager.register('journey', () => new JourneyScene(manager));
manager.register('drive', () => new DriveScene(manager));
manager.switchTo('menu');

const DT = 1 / 60;
let acc = 0;
let last = performance.now();

function frame(now: number): void {
	acc += Math.min((now - last) / 1000, 0.25);
	last = now;

	while (acc >= DT) {
		manager.update(DT);
		acc -= DT;
	}
	manager.render(acc / DT);

	requestAnimationFrame(frame);
}

requestAnimationFrame(frame);