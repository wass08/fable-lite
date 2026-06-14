// Teleport next to a tree and the flock for visual inspection.
import { chromium } from 'playwright-core';

const EXECUTABLE = process.env.CHROMIUM_PATH
  ?? '/Users/wawa/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.mouse.click(640, 360);
await page.waitForTimeout(800);

// stand south of a tree so it fills the camera-forward (+z) view
await page.evaluate(() => {
  const g = window.__game;
  const tree = g.chickens.obstacles.find((o) => o.r === 0.7);
  if (tree) g.player.position.set(tree.x, 0, tree.z - 7);
});
await page.waitForTimeout(800);
await page.screenshot({ path: 'scripts/tree.png' });

// kick pose: teleport a chicken in front, kick, snap mid-swing for the pants
await page.evaluate(() => {
  const g = window.__game;
  const c = g.chickens.chickens.find((ch) => ch.state !== 'flying');
  const f = g.player.forward();
  c.position.set(g.player.position.x + f.x * 1.4, 0, g.player.position.z + f.z * 1.4);
});
await page.keyboard.press('f');
await page.waitForTimeout(140);
await page.screenshot({ path: 'scripts/kickpose.png', clip: { x: 420, y: 160, width: 460, height: 420 } });

await browser.close();
console.log('done');
