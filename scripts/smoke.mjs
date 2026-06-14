// Headless smoke test: boots the game, plays a few seconds, casts every spell,
// kicks, and fails on any console error. Run with the dev server up on :5173.
import { chromium } from 'playwright-core';

const EXECUTABLE = process.env.CHROMIUM_PATH
  ?? '/Users/wawa/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()} @ ${msg.location().url}`);
  else console.log(`[page:${msg.type()}]`, msg.text());
});
page.on('response', (r) => {
  if (r.status() === 404) console.log('404 url:', r.url());
});

await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// start the game (intro click also requests pointer lock)
await page.mouse.click(640, 360);
await page.waitForTimeout(500);
// one more click in case the lock wasn't granted from the intro gesture
await page.mouse.click(640, 360);
await page.waitForTimeout(300);
console.log('pointer lock:', await page.evaluate(() => document.pointerLockElement?.tagName ?? 'none'));

// god-mode for the whole run: the flock now swarms and kamikazes on first
// provocation, and an early death pauses the world and breaks every later
// assertion. The peck test below briefly restores real health.
await page.evaluate(() => { window.__game.stats.health = 100000; });

// move around
for (const key of ['w', 'a', 's', 'd']) {
  await page.keyboard.down(key);
  await page.waitForTimeout(250);
  await page.keyboard.up(key);
}

// fireball — screenshot mid-flight
await page.mouse.move(900, 300);
await page.mouse.click(900, 300);
await page.waitForTimeout(250);
await page.screenshot({ path: 'scripts/smoke-fireball.png' });
await page.waitForTimeout(900);

// lightning — screenshot while the bolt is alive
await page.keyboard.press('2');
await page.mouse.click(500, 300);
await page.waitForTimeout(120);
await page.screenshot({ path: 'scripts/smoke-lightning.png' });
await page.waitForTimeout(900);

// earth spell — screenshot while the spikes are up
await page.keyboard.press('3');
await page.mouse.click(700, 350);
await page.waitForTimeout(250);
await page.screenshot({ path: 'scripts/smoke-earth.png' });
await page.waitForTimeout(1400);

// sprint — stamina should drain
await page.keyboard.down('Shift');
await page.keyboard.down('w');
await page.waitForTimeout(700);
await page.keyboard.up('w');
await page.keyboard.up('Shift');
const stamina = await page.evaluate(() => window.__game.stats.stamina);
if (stamina > 95) errors.push(`sprint did not drain stamina (${stamina})`);
else console.log(`sprint drained stamina to ${stamina.toFixed(0)}`);

// roll
await page.keyboard.press('Control');
await page.waitForTimeout(120);
const rolling = await page.evaluate(() => window.__game.player.isRolling);
if (!rolling) errors.push('ctrl did not trigger a roll');
else console.log('roll triggered');
await page.waitForTimeout(600);

// chicken revenge — provoke the flock, drop an attacker next to the wizard
await page.evaluate(() => {
  const g = window.__game;
  g.stats.health = 100; // mortal again so the pecks register
  g.chickens.provoke(8, g.player.position);
  const angry = g.chickens.chickens.find((c) => c.anger > 0);
  angry.position.set(g.player.position.x + 1.2, 0, g.player.position.z);
});
await page.waitForTimeout(2500);
const health = await page.evaluate(() => window.__game.stats.health);
const angryCount = await page.evaluate(() => window.__game.chickens.angryCount);
if (health >= 100) errors.push(`angry chickens never pecked (health=${health})`);
else console.log(`pecked down to ${health.toFixed(0)} hp, ${angryCount} chickens enraged`);
await page.screenshot({ path: 'scripts/smoke-attack.png' });
// the swarm may well have killed the wizard — rise again before continuing
// (the respawn click only unlocks 2s after the death screen appears)
if (await page.evaluate(() => !!document.querySelector('#death'))) {
  await page.waitForTimeout(2200);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(800);
  console.log('wizard died to the swarm, respawned');
}
await page.evaluate(() => {
  window.__game.chickens.calmAll();
  window.__game.stats.health = 100000; // back to god-mode for the physics waits
});

// kick — teleport a chicken right in front of the hero, then punt it
await page.evaluate(() => {
  const g = window.__game;
  const c = g.chickens.chickens[0];
  c.state = 'wander';
  const f = g.player.forward();
  c.position.set(g.player.position.x + f.x * 1.5, 0, g.player.position.z + f.z * 1.5);
});
await page.keyboard.press('f');
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/smoke-kick.png' });
await page.waitForTimeout(2500); // let it fly, bounce, and settle

// lethal blast: chicken dies on landing, reinforcements arrive
const before = await page.evaluate(() => window.__game.chickens.chickens.length);
await page.evaluate(() => {
  const g = window.__game;
  const c = g.chickens.chickens.find((ch) => ch.state !== 'flying') ?? g.chickens.chickens[0];
  g.chickens.blast(c.position.clone(), 2, 12, { chickenHit() {}, squawk() {} }, 0.8);
});
await page.waitForTimeout(5000); // launched birds can bounce for a while before settling
const killed = await page.evaluate(() => window.__game.chickens.killCount);
const after = await page.evaluate(() => window.__game.chickens.chickens.length);
if (killed < 1) errors.push(`lethal blast did not kill (killCount=${killed})`);
else console.log(`kill confirmed (${killed} slain), flock ${before} -> ${after}`);
// kamikaze chain reactions can shrink the flock mid-wait; reinforcements show
// up as the total-ever-spawned exceeding the starting headcount
if (after + killed <= before) errors.push(`no reinforcements spawned (${before} -> ${after}, ${killed} slain)`);

// potion pickup: drop a mana flask at the wizard's feet, watch it restore
await page.evaluate(() => {
  const g = window.__game;
  g.stats.mana = 5;
  g.pickups.spawn('mana', g.player.position.clone());
});
await page.waitForTimeout(600);
const mana = await page.evaluate(() => window.__game.stats.mana);
if (mana < 40) errors.push(`mana potion not collected (mana=${mana})`);
else console.log(`mana potion collected (mana=${mana.toFixed(0)})`);

const kicks = await page.evaluate(() => window.__game.ui.kicks);
if (kicks < 1) errors.push(`kick did not register a punt (kicks=${kicks})`);
else console.log(`punt registered, best=${await page.evaluate(() => window.__game.ui.best.toFixed(1))} m`);

await page.screenshot({ path: 'scripts/smoke.png' });
await browser.close();

if (errors.length) {
  console.error('FAILED with errors:');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('SMOKE OK — screenshot at scripts/smoke.png');
