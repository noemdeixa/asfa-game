// core/loop.ts
const DT = 1 / 100;           // 10 ms sim step
let acc = 0, last = performance.now();

function frame(now: number) {
  acc += Math.min((now - last) / 1000, 0.25); // clamp to avoid spiral of death
  last = now;
  while (acc >= DT) {
    scene.update(DT);
    acc -= DT;
  }
  scene.render(acc / DT);
  requestAnimationFrame(frame);
}