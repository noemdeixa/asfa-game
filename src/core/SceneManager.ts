export interface Scene {
	enter(root: HTMLElement, params?: unknown): void;
	exit(): void;
	update(dt: number): void;
	render(alpha: number): void;
}

export class SceneManager {
  	private current: Scene | null = null;
	private factories = new Map<string, () => Scene>();
	private root: HTMLElement;

	constructor(root: HTMLElement) {
		this.root = root;
	}

	register(name: string, factory: () => Scene): void {
		this.factories.set(name, factory);
	}

	switchTo(name: string, params?: unknown): void {
		const factory = this.factories.get(name);
		if (!factory) throw new Error(`No scene registered as "${name}"`);
		this.current?.exit();
		this.root.innerHTML = '';
		this.current = factory();
		this.current.enter(this.root, params);
	}

	update(dt: number): void {
		this.current?.update(dt);
	}

	render(alpha: number): void {
		this.current?.render(alpha);
	}
}