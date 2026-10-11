// Headless auto-player for the Discord Simulator ruleset.
// Usage: node sim/autoplay.js [games=100] [strategy=random] [ruleset=discord]
// Plays full games with no GUI, picking choices by the given strategy, and
// prints a report of how the games ended.
const fs = require('fs');
const path = require('path');

const GAMES = parseInt(process.argv[2] || '100', 10);
const STRATEGY = process.argv[3] || 'random';
const RULESET = process.argv[4] || 'discord';
const MAX_WEEKS = 3000;
const STATIC_DIR = path.join(__dirname, '..', 'static');

// The engine loads YAML with XMLHttpRequest. Serve it from disk instead.
global.XMLHttpRequest = class {
  static DONE = 4;
  open(method, url) { this.url = url; }
  send() {
    try {
      this.responseText = fs.readFileSync(path.join(STATIC_DIR, this.url), 'utf8');
      this.status = 200;
    } catch (e) {
      this.status = 404;
      this.statusText = String(e);
    }
    this.readyState = 4;
    setImmediate(() => this.onreadystatechange());
  }
};

const { GameEngine } = require('./build/gameEngine');
const { EndGameState } = require('./build/endGameState');

// Strategies get the choice list ([messageKey, index][]) and the engine.
const strategies = {
  random: (choices) => choices[Math.floor(Math.random() * choices.length)][1],
  // Random, except it always accepts the opening invite.
  'random-joined': (choices) => {
    const join = choices.find(c => c[0] === 'message.acceptInvite');
    return join ? join[1] : strategies.random(choices);
  },
  // A reasonable human-like player: goes for promotions, looks after vibes
  // and mods, and works the proposal pipeline.
  sensible: (choices, engine) => {
    const avail = new Map(choices.map(c => [c[0], c[1]]));
    const v = (n) => engine.variableStore.getVar(n, false);
    const items = (id) => engine.inventory.count(id);
    const has = (id) => engine.statusTable.count(id) > 0;
    const first = (...keys) => {
      for (const k of keys) if (avail.has(k)) return avail.get(k);
      return null;
    };
    const vibes = v('player.vibes');
    const prefs = [
      'message.acceptInvite', 'message.acceptMod', 'message.acceptAdmin',
      'message.passReins', 'message.takeBreak', 'message.mediate',
      'message.logOff',
    ];
    let pick = first(...prefs);
    if (pick !== null) return pick;
    if (vibes >= 15 && has('adminRole') && items('mod') < 3) pick = first('message.recruit');
    if (pick !== null) return pick;
    const admin = has('adminRole');
    if (vibes < (admin ? 12 : 20)) pick = first('message.touchGrass');
    else if (has('burnout') && !admin) pick = first('message.touchGrass');
    else if (has('burnout') && admin && vibes < 40) pick = first('message.touchGrass');
    else if (admin && items('mod') > 0 && v('mod.morale') < 45 && vibes >= 30) pick = first('message.modYourself');
    else if (vibes < (admin ? 40 : 32)) pick = first('message.voiceChat');
    if (pick !== null) return pick;
    if (has('adminRole')) {
      const order = ['message.banRaiders'];
      if (items('mod') < 7) order.push('message.recruit');
      order.push('message.revise', 'message.testWaters', 'message.announce',
                 'message.draft', 'message.listen');
      pick = first(...order);
    } else {
      const order = ['message.banRaiders', 'message.submitEmoji',
                     'message.polishBanger'];
      if (items('inJoke') > 0) order.push('message.post');
      if (has('modTitle')) order.push('message.clearReports');
      order.push(v('community.trust') < 20 && Math.random() < 0.5
        ? 'message.helpNewbie' : 'message.lurk');
      pick = first(...order);
    }
    return pick !== null ? pick : strategies.random(choices);
  },
};

class HeadlessProxy {
  constructor(pick) { this.pick = pick; this.engine = null; this.log = []; }
  displayMessage(message) { this.log.push(message); return Promise.resolve(); }
  displayChoices(message, choices) {
    const idx = this.pick(choices, this.engine, message);
    const chosen = choices.find(c => c[1] === idx);
    if (process.env.TRACE && this.engine.statusTable.count('adminRole') > 0) {
      const g = (n) => this.engine.variableStore.getVar(n, false);
      process.stderr.write(`w${g('elapsedWeek')} members=${g('server.members')} vibes=${g('player.vibes')} mods=${this.engine.inventory.count('mod')} morale=${g('mod.morale')} | ${choices.map(c => c[0].replace('message.', '')).join(',')} -> ${chosen ? chosen[0].replace('message.', '') : idx}\n`);
    }
    this.log.push(`> ${chosen ? chosen[0] : idx}`);
    return Promise.resolve(idx);
  }
}

async function playOne(pick) {
  const base = `rulesets/${RULESET}/`;
  const proxy = new HeadlessProxy(pick);
  const engine = new GameEngine({
    attributeDefinitionUrl: base + 'attributes.yaml',
    itemDefinitionUrl: base + 'items.yaml',
    statusDefinitionUrl: base + 'status.yaml',
    eventDefinitionUrl: base + 'events.yaml',
  }, proxy);
  proxy.engine = engine;
  let ended = null;
  engine.onGameEnd = (_, e) => { ended = e; };
  await engine.start(true);

  const v = (name) => engine.variableStore.getVar(name, false);
  const has = (id) => engine.statusTable.count(id) > 0;
  const stats = {
    modWeek: null, adminWeek: null, peakMembers: 0, peakMods: 0,
    maxVanity: 0, maxEmoji: 0, membersAtAdmin: null, adopted: 0,
    lowestVibes: 100,
  };
  let lastSnapshot = null;
  for (let t = 0; t < MAX_WEEKS && !ended; t++) {
    await engine.tick();
    if (ended) break;
    const week = v('elapsedWeek');
    if (stats.modWeek === null && has('modTitle')) stats.modWeek = week;
    if (stats.adminWeek === null && has('adminRole')) {
      stats.adminWeek = week;
      stats.membersAtAdmin = v('server.members');
    }
    stats.peakMembers = Math.max(stats.peakMembers, v('server.members'));
    stats.peakMods = Math.max(stats.peakMods, engine.inventory.count('mod'));
    stats.maxVanity = Math.max(stats.maxVanity, engine.inventory.count('vanityRole'));
    stats.maxEmoji = Math.max(stats.maxEmoji, engine.inventory.count('customEmoji'));
    stats.adopted = engine.inventory.count('adoptedChange');
    stats.lowestVibes = Math.min(stats.lowestVibes, v('player.vibes'));
    if (week % 20 === 0) (stats.traj = stats.traj || []).push(`${week}:${v('server.members')}/${engine.inventory.count('mod')}m/${v('player.vibes')}v/${engine.inventory.count('backlash')}b`);
    lastSnapshot = {
      week, members: v('server.members'), vibes: v('player.vibes'),
      trust: v('community.trust'), morale: v('mod.morale'),
      mods: engine.inventory.count('mod'),
    };
  }
  return {
    ending: ended ? ended.endingType || (ended.state === EndGameState.Win ? 'win' : 'loss') : 'stalled',
    won: ended ? ended.state === EndGameState.Win : false,
    weeks: lastSnapshot ? lastSnapshot.week + 1 : 1,
    last: lastSnapshot,
    ...stats,
  };
}

function pct(n, d) { return d ? `${(100 * n / d).toFixed(0)}%` : '-'; }
function median(xs) {
  if (!xs.length) return '-';
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function range(xs) {
  if (!xs.length) return '-';
  return `${Math.min(...xs)}–${Math.max(...xs)} (median ${median(xs)})`;
}

(async () => {
  const pick = strategies[STRATEGY];
  if (!pick) throw new Error(`Unknown strategy ${STRATEGY}`);
  const origLog = console.log;
  console.log = () => {}; // silence engine load messages
  const results = [];
  for (let i = 0; i < GAMES; i++) results.push(await playOne(pick));
  console.log = origLog;

  const byEnding = {};
  for (const r of results) byEnding[r.ending] = (byEnding[r.ending] || 0) + 1;
  const reachedMod = results.filter(r => r.modWeek !== null);
  const reachedAdmin = results.filter(r => r.adminWeek !== null);
  const wins = results.filter(r => r.ending === 'business' || r.ending === 'passedReins');

  console.log(`\n=== ${GAMES} games, strategy: ${STRATEGY} ===\n`);
  console.log('Endings:');
  for (const [k, n] of Object.entries(byEnding).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${String(n).padStart(4)}  ${pct(n, GAMES)}`);
  }
  console.log('\nProgression:');
  console.log(`  reached mod       ${reachedMod.length} (${pct(reachedMod.length, GAMES)}), week ${range(reachedMod.map(r => r.modWeek))}`);
  console.log(`  reached admin     ${reachedAdmin.length} (${pct(reachedAdmin.length, GAMES)}), week ${range(reachedAdmin.map(r => r.adminWeek))}`);
  console.log(`  members at admin  ${range(reachedAdmin.map(r => r.membersAtAdmin))}`);
  console.log(`  peak members      ${range(results.map(r => r.peakMembers))}`);
  console.log(`  peak mods (admin) ${range(reachedAdmin.map(r => r.peakMods))}`);
  console.log(`  adopted changes   ${range(reachedAdmin.map(r => r.adopted))}`);
  console.log(`  vanity roles      ${range(results.map(r => r.maxVanity))}`);
  console.log(`  custom emoji      ${range(results.map(r => r.maxEmoji))}`);
  console.log(`  game length (wk)  ${range(results.map(r => r.weeks))}`);
  if (wins.length) console.log(`  win length (wk)   ${range(wins.map(r => r.weeks))}`);
  if (reachedAdmin.length) {
    console.log(`  weeks as admin    ${range(reachedAdmin.map(r => r.weeks - r.adminWeek))}`);
  }
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(results, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
