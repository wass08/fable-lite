// Grab a native-res crop of the wizard for visual inspection.
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
await page.mouse.move(800, 360);
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/closeup.png', clip: { x: 280, y: 100, width: 720, height: 560 } });
// walk toward a tree to inspect branches + collision
await page.keyboard.down('w');
await page.waitForTimeout(2200);
await page.keyboard.up('w');
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/closeup2.png' });
await browser.close();
console.log('done');
