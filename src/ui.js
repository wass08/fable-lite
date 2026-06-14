const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;900&family=Crimson+Pro:ital@0;1&display=swap';

const CSS = `
  :root {
    --gold: #c9a14f;
    --gold-bright: #f0c674;
    --gold-dim: #8a6d35;
    --steel: #2a2620;
    --serif: 'Cinzel', Georgia, serif;
    --body: 'Crimson Pro', Georgia, serif;
    --dock-h: 132px; /* reserved height of the bottom touch spell bar */
  }
  canvas { cursor: crosshair; }
  #hud { position: fixed; inset: 0; pointer-events: none; font-family: var(--body); color: #efe5cc; user-select: none; }

  /* ornate plaque: layered metal bevel + gold inlay + corner rivets */
  .plaque {
    position: relative;
    background:
      linear-gradient(160deg, rgba(46,42,34,.92), rgba(16,14,11,.95));
    border: 2px solid #0c0a07;
    box-shadow:
      inset 0 0 0 1px var(--gold-dim),
      inset 0 0 0 3px rgba(0,0,0,.6),
      inset 0 0 22px rgba(201,161,79,.08),
      0 5px 16px rgba(0,0,0,.6);
    border-radius: 4px;
  }
  .plaque::before, .plaque::after {
    content: ''; position: absolute; width: 9px; height: 9px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffe9b0, var(--gold) 45%, #5a4413 90%);
    box-shadow: 0 1px 3px rgba(0,0,0,.8);
  }
  .plaque::before { top: 4px; left: 4px; }
  .plaque::after { top: 4px; right: 4px; }

  #hud .title { position: absolute; top: 14px; left: 16px; font-family: var(--serif); font-weight: 900;
    font-size: 20px; letter-spacing: 4px; padding: 10px 20px 8px; }
  #hud .title b { color: var(--gold-bright); }
  #hud .title .sub { display: block; font-family: var(--body); font-weight: 400; font-size: 10px; letter-spacing: 5px; opacity: .55; margin-top: 2px; }

  #hud .score { position: absolute; top: 14px; right: 16px; padding: 10px 18px; font-size: 15px; line-height: 1.7; min-width: 185px; }
  #hud .score .row { display: flex; justify-content: space-between; gap: 14px; }
  #hud .score .row span:last-child { font-family: var(--serif); color: var(--gold-bright); font-weight: 700; }
  #hud .score .lbl { opacity: .85; }

  /* --- the ornate spell dock --- */
  #hud .dock { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 0; }

  #hud .spellname { font-family: var(--serif); font-size: 13px; font-weight: 700; letter-spacing: 6px;
    color: var(--gold-bright); text-shadow: 0 0 14px rgba(240,198,116,.5), 0 2px 4px #000; margin-bottom: 6px; }

  #hud .dockframe { padding: 10px 26px 9px; border-radius: 10px 10px 14px 14px; }
  /* gold wings flanking the dock */
  #hud .dockframe .wing { position: absolute; top: 12px; width: 60px; height: 34px; pointer-events: none; }
  #hud .dockframe .wing.l { left: -54px; transform: scaleX(-1); }
  #hud .dockframe .wing.r { right: -54px; }
  #hud .dockframe .wing i { position: absolute; display: block; height: 4px; border-radius: 3px;
    background: linear-gradient(90deg, var(--gold) 0%, rgba(201,161,79,0) 95%);
    box-shadow: 0 1px 2px rgba(0,0,0,.7); }
  #hud .dockframe .wing i:nth-child(1) { top: 4px; left: 0; width: 58px; transform: rotate(-9deg); }
  #hud .dockframe .wing i:nth-child(2) { top: 14px; left: 0; width: 44px; transform: rotate(-4deg); }
  #hud .dockframe .wing i:nth-child(3) { top: 23px; left: 0; width: 30px; transform: rotate(2deg); }

  #hud .slots { display: flex; gap: 14px; align-items: flex-end; }
  #hud .slot { position: relative; width: 58px; height: 58px; border-radius: 50%;
    pointer-events: auto; cursor: pointer; touch-action: none;
    border: 2px solid var(--gold-dim);
    box-shadow: 0 0 0 2px #0c0a07, 0 4px 12px rgba(0,0,0,.6), inset 0 2px 6px rgba(255,255,255,.12), inset 0 -4px 10px rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
    transition: transform .16s cubic-bezier(.34,1.56,.64,1), border-color .16s, box-shadow .16s; }
  #hud .slot[data-spell="fireball"] { background: radial-gradient(circle at 38% 30%, #ffb35c, #b3401a 55%, #3a0f04 95%); }
  #hud .slot[data-spell="lightning"] { background: radial-gradient(circle at 38% 30%, #c79bff, #6d3fd4 55%, #1b0e3f 95%); }
  #hud .slot[data-spell="earth"] { background: radial-gradient(circle at 38% 30%, #9fd4ff, #2f6bb4 55%, #0b2038 95%); }
  #hud .slot[data-spell="kick"] { background: radial-gradient(circle at 38% 30%, #e8c894, #8a6a3c 55%, #2c1f0c 95%); }
  #hud .slot .ico { font-size: 24px; filter: drop-shadow(0 0 6px rgba(255,235,180,.55)) drop-shadow(0 2px 3px rgba(0,0,0,.7)); }
  #hud .slot .key { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%) rotate(45deg);
    width: 14px; height: 14px; background: linear-gradient(160deg, #3a342a, #14110c);
    border: 1px solid var(--gold-dim); box-shadow: 0 1px 3px rgba(0,0,0,.8); }
  #hud .slot .key i { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    transform: rotate(-45deg); font-style: normal; font-family: var(--serif); font-size: 9px; font-weight: 700; color: var(--gold-bright); }
  #hud .slot.sel { border-color: var(--gold-bright); transform: translateY(-6px) scale(1.1);
    box-shadow: 0 0 0 2px #0c0a07, 0 0 22px rgba(240,198,116,.55), 0 6px 14px rgba(0,0,0,.6), inset 0 2px 6px rgba(255,255,255,.18); }
  #hud .slot .cd { position: absolute; inset: -2px; border-radius: 50%; pointer-events: none; }
  #hud .slot.ready { animation: glint .35s ease-out; }
  @keyframes glint { 0% { box-shadow: 0 0 0 0 rgba(240,198,116,.8); } 100% { box-shadow: 0 0 0 14px rgba(240,198,116,0); } }

  /* framed resource bars under the slots */
  #hud .bars { margin-top: 9px; display: flex; flex-direction: column; gap: 4px; align-items: center;
    padding: 6px 10px; background: linear-gradient(160deg, rgba(40,36,28,.9), rgba(12,10,8,.92));
    border: 1px solid #0c0a07; box-shadow: inset 0 0 0 1px var(--gold-dim); border-radius: 4px; }
  #hud .barwrap { height: 9px; border-radius: 4px; background: rgba(5,6,8,.9);
    overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,.9); position: relative; border: 1px solid rgba(0,0,0,.8); }
  #hud .barfill { height: 100%; width: 100%; border-radius: 3px;
    box-shadow: inset 0 1px 1px rgba(255,255,255,.45); transition: width .12s linear; }
  #hud .barwrap::after { content: ''; position: absolute; inset: 0 0 55% 0; background: linear-gradient(180deg, rgba(255,255,255,.22), transparent); pointer-events: none; }
  #hud .hpwrap { width: 280px; }
  #hud .hpfill { background: linear-gradient(180deg, #ff8d6d 0%, #c93a22 50%, #7a160a 100%); }
  #hud .manawrap { width: 280px; }
  #hud .manafill { background: linear-gradient(180deg, #86c8ff 0%, #2961cf 50%, #173a96 100%); }
  #hud .stamwrap { width: 280px; }
  #hud .stamfill { background: linear-gradient(180deg, #bce98e 0%, #569e2c 50%, #275f14 100%); }
  #hud .barwrap.deny { animation: deny .4s ease-out; }
  @keyframes deny { 0%, 60% { border-color: #ff5a4a; box-shadow: 0 0 16px rgba(255,80,60,.7); transform: translateX(0); }
    15% { transform: translateX(-5px); } 30% { transform: translateX(5px); } 45% { transform: translateX(-3px); } 100% { transform: none; } }

  #hud .toast { position: absolute; left: 50%; top: 20%; transform: translate(-50%, 0) scale(.6); font-family: var(--serif);
    font-size: clamp(20px, 6vw, 34px); font-weight: 900; letter-spacing: 3px; color: var(--gold-bright);
    text-shadow: 0 0 24px rgba(240,180,80,.55), 0 3px 8px rgba(0,0,0,.8); opacity: 0;
    max-width: 92vw; text-align: center; }
  #hud .toast.big { font-size: clamp(24px, 7.5vw, 42px); }
  #hud .toast.pop { animation: toastPop 1.6s cubic-bezier(.22,1.4,.36,1) forwards; }
  @keyframes toastPop { 0% { opacity: 0; transform: translate(-50%, 12px) scale(.5); }
    12% { opacity: 1; transform: translate(-50%, 0) scale(1.06); } 20% { transform: translate(-50%, 0) scale(1); }
    80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -26px) scale(.98); } }

  #hud .help { position: absolute; bottom: 14px; left: 16px; font-size: 13px; line-height: 1.5; padding: 6px 12px; opacity: .9; }
  #hud .help b { color: var(--gold-bright); font-family: var(--serif); font-size: 10px; letter-spacing: 1px; }

  .fct { position: absolute; transform: translate(-50%, -100%); font-family: var(--serif); font-weight: 700;
    font-size: clamp(15px, 4.5vw, 20px); color: #fff0c8; text-shadow: 0 0 12px rgba(255,190,80,.6), 0 2px 4px #000;
    pointer-events: none; animation: fctUp 1.2s ease-out forwards; white-space: nowrap; max-width: 90vw; }
  .fct.record { font-size: clamp(20px, 6.5vw, 28px); color: var(--gold-bright); }
  .fct.zap { color: #bcd8ff; text-shadow: 0 0 14px rgba(130,180,255,.8), 0 2px 4px #000; }
  .fct.mana { color: #86c8ff; text-shadow: 0 0 14px rgba(60,130,255,.8), 0 2px 4px #000; }
  .fct.heal { color: #9be98e; text-shadow: 0 0 14px rgba(90,220,90,.8), 0 2px 4px #000; }

  #nomana { position: absolute; left: 50%; bottom: 175px; transform: translateX(-50%);
    font-family: var(--serif); font-size: 18px; font-weight: 700; letter-spacing: 3px; color: #ff6a5a;
    text-shadow: 0 0 14px rgba(255,60,40,.6), 0 2px 4px #000; opacity: 0; pointer-events: none; white-space: nowrap; }
  #nomana.show { animation: nomanaPop 1s ease-out; }
  @keyframes nomanaPop { 0% { opacity: 0; transform: translate(-50%, 8px); }
    15% { opacity: 1; transform: translate(-50%, 0); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -12px); } }
  @keyframes fctUp { 0% { opacity: 0; margin-top: 6px; } 10% { opacity: 1; } 70% { opacity: 1; margin-top: -34px; } 100% { opacity: 0; margin-top: -48px; } }

  /* center crosshair retired — the cursor itself is the aim, WoW-style */
  #xhair { display: none; position: fixed; left: 50%; top: 50%; width: 18px; height: 18px; transform: translate(-50%, -50%);
    pointer-events: none; opacity: .8; }
  #xhair::before { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px;
    transform: translate(-50%, -50%); border-radius: 50%; background: var(--gold-bright);
    box-shadow: 0 0 6px rgba(240,198,116,.9), 0 1px 2px rgba(0,0,0,.8); }
  #xhair::after { content: ''; position: absolute; inset: 0; border-radius: 50%;
    border: 1px solid rgba(240,198,116,.45); box-shadow: 0 0 4px rgba(0,0,0,.5); }

  #flash { position: fixed; inset: 0; background: #dfe9ff; opacity: 0; pointer-events: none; }
  #hurt { position: fixed; inset: 0; pointer-events: none; opacity: 0;
    background: radial-gradient(ellipse at center, transparent 45%, rgba(160,10,5,.55) 100%); }

  #death { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    background: radial-gradient(ellipse at center, rgba(40,4,2,.75) 0%, rgba(8,1,0,.96) 100%);
    color: #efe5cc; font-family: var(--body); cursor: pointer; opacity: 0; transition: opacity .8s; }
  #death h1 { font-family: var(--serif); font-weight: 900; font-size: 52px; letter-spacing: 8px; margin: 0; color: #ff6a4a;
    text-shadow: 0 0 40px rgba(255,80,40,.4), 0 4px 18px rgba(0,0,0,.9); }
  #death p { margin: 0; font-size: 18px; opacity: .8; font-style: italic; }
  #death .go { margin-top: 14px; font-family: var(--serif); font-size: 13px; letter-spacing: 4px; opacity: .55; animation: pulse 1.6s infinite; }

  #intro { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 16px;
    background: radial-gradient(ellipse at center, rgba(10,14,22,.55) 0%, rgba(4,6,10,.92) 100%);
    color: #efe5cc; font-family: var(--body); cursor: pointer; transition: opacity .5s; }
  #intro h1 { font-family: var(--serif); font-weight: 900; font-size: 56px; letter-spacing: 10px; margin: 0; color: var(--gold-bright);
    text-shadow: 0 0 40px rgba(240,198,116,.35), 0 4px 18px rgba(0,0,0,.9); }
  #intro .rule { width: 340px; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); }
  #intro p { margin: 0; font-size: 18px; opacity: .85; font-style: italic; }
  #intro .keys { font-size: 15px; opacity: .7; font-style: normal; }
  #intro .go { margin-top: 14px; font-family: var(--serif); font-size: 13px; letter-spacing: 4px; opacity: .55; animation: pulse 1.6s infinite; }
  @keyframes pulse { 50% { opacity: 1; } }

  /* --- touch controls ---
     layout: spell dock spans the full width at the very bottom; the joystick
     (left) and roll button (right) float in the band just above it */
  canvas { touch-action: none; }
  #stick { position: fixed; left: 24px; bottom: calc(var(--dock-h) + 18px);
    width: 150px; height: 150px; z-index: 7; touch-action: none; }
  #rollbtn { position: fixed; right: 24px; bottom: calc(var(--dock-h) + 30px);
    width: 70px; height: 70px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 30px; z-index: 7;
    touch-action: none; user-select: none; -webkit-user-select: none; }
  #rollbtn::before, #rollbtn::after { display: none; }
  #rollbtn:active { transform: scale(.92); }
  body.touch #hud .help, body.touch #xhair { display: none; }

  /* full-width spell dock pinned to the bottom edge */
  body.touch #hud .dock { left: 0; right: 0; bottom: 0; width: 100%; transform: none; align-items: center; gap: 4px; }
  body.touch #hud .dockframe { width: 100%; box-sizing: border-box; border-radius: 0;
    border-left: none; border-right: none; display: flex; flex-direction: column; align-items: center; }
  body.touch #hud .dockframe .wing { display: none; }
  body.touch #hud .spellname { margin: 0 0 4px; }
  @media (max-width: 560px) {
    body.touch #hud .slots { gap: 10px; }
    body.touch #hud .slot { width: 44px; height: 44px; }
    body.touch #hud .slot .ico { font-size: 18px; }
    body.touch #hud .hpwrap, body.touch #hud .manawrap, body.touch #hud .stamwrap { width: 46vw; max-width: 280px; }
    body.touch #stick { left: 16px; width: 130px; height: 130px; }
    body.touch #rollbtn { width: 60px; height: 60px; font-size: 26px; }
  }

  /* --- responsive HUD --- */
  @media (max-width: 860px) {
    #hud .title { font-size: 14px; letter-spacing: 2px; padding: 8px 12px 6px; }
    #hud .title .sub { font-size: 8px; letter-spacing: 3px; }
    #hud .score { font-size: 12px; min-width: 135px; padding: 8px 12px; line-height: 1.55; }
    #hud .slots { gap: 10px; }
    #hud .slot { width: 46px; height: 46px; }
    #hud .slot .ico { font-size: 19px; }
    #hud .dockframe { padding: 8px 14px 7px; }
    #hud .dockframe .wing { display: none; }
    #hud .spellname { font-size: 11px; letter-spacing: 4px; }
    #hud .hpwrap, #hud .manawrap, #hud .stamwrap { width: 190px; }
    #hud .help { display: none; }
    #intro h1, #death h1 { font-size: 32px; letter-spacing: 5px; text-align: center; }
    #intro p, #death p { font-size: 15px; padding: 0 18px; text-align: center; }
    #intro .rule { width: 220px; }
  }
  @media (max-height: 500px) {
    #hud .dock { bottom: 4px; }
    #hud .bars { margin-top: 5px; padding: 4px 8px; }
    #hud .title { display: none; }
  }
`;

const SPELL_LABELS = { fireball: 'FIREBALL', lightning: 'LIGHTNING', earth: 'EARTH', kick: 'KICK' };

export class UI {
  constructor() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_LINK;
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.hud = document.createElement('div');
    this.hud.id = 'hud';
    this.hud.innerHTML = `
      <div class="title plaque">FABLE <b>LITE</b><span class="sub">A CHICKEN'S NIGHTMARE</span></div>
      <div class="score plaque">
        <div class="row"><span class="lbl">🐔 Chickens punted</span><span id="kicks">0</span></div>
        <div class="row"><span class="lbl">🍗 Chickens slain</span><span id="slain">0</span></div>
        <div class="row"><span class="lbl">🏆 Best punt</span><span id="best">0.0 m</span></div>
      </div>
      <div class="dock">
        <div class="spellname" id="spellname">FIREBALL</div>
        <div class="dockframe plaque">
          <div class="wing l"><i></i><i></i><i></i></div>
          <div class="wing r"><i></i><i></i><i></i></div>
          <div class="slots">
            <div class="slot" data-spell="fireball"><div class="ico">🔥</div><div class="key"><i>1</i></div><div class="cd"></div></div>
            <div class="slot" data-spell="lightning"><div class="ico">⚡</div><div class="key"><i>2</i></div><div class="cd"></div></div>
            <div class="slot" data-spell="earth"><div class="ico">🪨</div><div class="key"><i>3</i></div><div class="cd"></div></div>
            <div class="slot" data-spell="kick"><div class="ico">🦶</div><div class="key"><i>F</i></div><div class="cd"></div></div>
          </div>
          <div class="bars">
            <div class="barwrap hpwrap"><div class="barfill hpfill"></div></div>
            <div class="barwrap manawrap"><div class="barfill manafill"></div></div>
            <div class="barwrap stamwrap"><div class="barfill stamfill"></div></div>
          </div>
        </div>
      </div>
      <div class="toast" id="toast"></div>
      <div id="nomana">INSUFFICIENT MANA</div>
      <div id="xhair"></div>
      <div class="help plaque"><b>MOUSE</b> aim · <b>R-DRAG</b> look · <b>WASD</b> move · <b>SHIFT</b> sprint · <b>CTRL</b> roll · <b>CLICK</b> cast · <b>1/2/3</b> spell · <b>F</b> kick</div>
    `;
    document.body.appendChild(this.hud);

    this.flash = document.createElement('div');
    this.flash.id = 'flash';
    document.body.appendChild(this.flash);

    this.slots = {};
    for (const slot of this.hud.querySelectorAll('.slot')) this.slots[slot.dataset.spell] = slot;
    this.manawrap = this.hud.querySelector('.manawrap');
    this.manafill = this.hud.querySelector('.manafill');
    this.hpfill = this.hud.querySelector('.hpfill');
    this.stamfill = this.hud.querySelector('.stamfill');
    this.spellname = this.hud.querySelector('#spellname');
    this.cdState = {};

    this.hurtEl = document.createElement('div');
    this.hurtEl.id = 'hurt';
    document.body.appendChild(this.hurtEl);

    this.kicks = 0;
    this.best = 0;
    this.slain = 0;
  }

  // make the HUD playable by hand: spell slots select, the kick slot kicks
  bindActions({ onSpell, onKick, onRoll }) {
    this.onRoll = onRoll;
    for (const [name, slot] of Object.entries(this.slots)) {
      slot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (name === 'kick') onKick?.();
        else onSpell?.(name);
      });
    }
  }

  // touch-only chrome: roll button bottom-right (the joystick lives in main)
  enableTouch() {
    document.body.classList.add('touch');
    const btn = document.createElement('div');
    btn.id = 'rollbtn';
    btn.className = 'plaque';
    btn.textContent = '🌀';
    document.body.appendChild(btn);
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.onRoll?.();
    });
  }

  addSlain() {
    this.slain++;
    this.hud.querySelector('#slain').textContent = this.slain;
  }

  setHealth(frac) {
    this.hpfill.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  setStamina(frac) {
    this.stamfill.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  hurt() {
    this.hurtEl.style.transition = 'none';
    this.hurtEl.style.opacity = '1';
    requestAnimationFrame(() => {
      this.hurtEl.style.transition = 'opacity .5s';
      this.hurtEl.style.opacity = '0';
    });
  }

  showDeath(onRespawn) {
    const el = document.createElement('div');
    el.id = 'death';
    el.innerHTML = `
      <h1>PECKED TO DEATH</h1>
      <p>The flock remembers every punt.</p>
      <div class="go">— CLICK TO RISE AGAIN —</div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    // let the death sink in: the respawn prompt (and the click) unlock after 2s
    const go = el.querySelector('.go');
    go.style.visibility = 'hidden';
    setTimeout(() => {
      go.style.visibility = 'visible';
      el.addEventListener('pointerdown', () => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 850);
        onRespawn();
      }, { once: true });
    }, 2000);
  }

  showIntro(onStart) {
    const el = document.createElement('div');
    el.id = 'intro';
    el.innerHTML = `
      <h1>FABLE LITE</h1>
      <div class="rule"></div>
      <p>Fling fireballs. Call down lightning. Raise the earth. Kick chickens.</p>
      <p class="keys">${document.body.classList.contains('touch')
        ? 'joystick to move · drag to look · tap to cast · 🌀 to roll · tap 🦶 to kick'
        : 'mouse aims · right-drag looks · WASD move · SHIFT sprint · CTRL roll · click cast · 1/2/3 spell · F kick'}</p>
      <div class="go">— CLICK TO BEGIN YOUR LEGEND —</div>
    `;
    document.body.appendChild(el);
    el.addEventListener('pointerdown', () => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 550);
      onStart();
    }, { once: true });
  }

  selectSpell(name) {
    for (const [key, slot] of Object.entries(this.slots)) {
      if (key !== 'kick') slot.classList.toggle('sel', key === name);
    }
    this.spellname.textContent = SPELL_LABELS[name] ?? '';
  }

  flashKick() {
    const slot = this.slots.kick;
    slot.classList.add('sel');
    setTimeout(() => slot.classList.remove('sel'), 220);
  }

  // frac: 1 = just used, 0 = ready
  setCooldown(name, frac) {
    const slot = this.slots[name];
    if (!slot) return;
    const was = this.cdState[name] ?? 0;
    this.cdState[name] = frac;
    const cd = slot.querySelector('.cd');
    if (frac <= 0) {
      cd.style.background = 'none';
      if (was > 0) {
        slot.classList.remove('ready');
        void slot.offsetWidth;
        slot.classList.add('ready');
      }
    } else {
      const deg = (frac * 360).toFixed(1);
      cd.style.background = `conic-gradient(rgba(6,8,14,.82) ${deg}deg, transparent ${deg}deg)`;
    }
  }

  setMana(frac) {
    this.manafill.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  denyMana() {
    this.manawrap.classList.remove('deny');
    void this.manawrap.offsetWidth;
    this.manawrap.classList.add('deny');
  }

  insufficientMana() {
    const el = this.hud.querySelector('#nomana');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  toast(text, big = false) {
    const t = this.hud.querySelector('#toast');
    t.textContent = text;
    t.classList.toggle('big', big); // size lives in CSS so it can stay responsive
    t.classList.remove('pop');
    void t.offsetWidth;
    t.classList.add('pop');
  }

  floatText(text, x, y, cls = '') {
    const el = document.createElement('div');
    el.className = `fct ${cls}`;
    el.textContent = text;
    // keep the centered text clear of both screen edges
    const margin = Math.min(70, window.innerWidth * 0.2);
    el.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - margin))}px`;
    el.style.top = `${y}px`;
    this.hud.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  addKick(distance) {
    this.kicks++;
    this.hud.querySelector('#kicks').textContent = this.kicks;
    let record = false;
    if (distance > this.best) {
      this.best = distance;
      this.hud.querySelector('#best').textContent = `${distance.toFixed(1)} m`;
      record = this.kicks > 1;
    }
    return record;
  }

  screenFlash(opacity = 0.35) {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(opacity);
    requestAnimationFrame(() => {
      this.flash.style.transition = 'opacity .35s';
      this.flash.style.opacity = '0';
    });
  }
}
