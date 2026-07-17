// Asserts the generated Bank Editor covers every palette param exactly once
// (static + mode-variant dynamic keys), the enum label tables match the DSP,
// and the palette-specific interactions work: mode-dependent mod cells, the
// macro route cursor, float/label wire codecs, select-write cache drop.
// Run: node tests/canvas_banks.test.mjs   (after regenerating src/canvas.js)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "canvas.js"), "utf8");
(0, eval)(src);
const be = globalThis.bank_editor;
const T = be._test;

let failures = 0;
function fail(m) { failures++; console.error("FAIL " + m); }
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) fail(`${msg}: got ${a}, want ${e}`);
  else console.log(`ok   ${msg}`);
}

// The authoritative editable-param set (chain_params in palette.c, minus the
// nav-only keys: editor itself, current_level, randomizer triggers).
const EXPECTED = [];
for (let n = 1; n <= 4; n++) EXPECTED.push(`fx${n}_select`, `fx${n}_amount`, `fx${n}_macro`, `fx${n}_drift`);
for (let n = 1; n <= 3; n++) EXPECTED.push(
  `m${n}_mode`, `m${n}_sync`, `m${n}_lfo_rate`, `m${n}_lfo_wave`, `m${n}_lfo_fade`,
  `m${n}_env_a`, `m${n}_env_dr`, `m${n}_env_s`,
  `m${n}_rnd_rate`, `m${n}_rnd_lag`, `m${n}_rnd_prob`,
  `m${n}_dest`, `m${n}_level`);
for (let n = 1; n <= 4; n++) EXPECTED.push(`macro${n}`, `macro${n}_dest`, `macro${n}_level`);
EXPECTED.push("input_vol", "mix", "feedback", "fx_reorder",
              "tempo_src", "tempo_bpm", "time_div", "current_preset");

const covered = new Set();
for (const b of T.BANKS) {
  for (const c of b.knobs) if (typeof c.key === "string") {
    if (covered.has(c.key)) fail(`duplicate param ${c.key}`);
    covered.add(c.key);
  }
  for (const k of b.dynamicKeys || []) {
    if (covered.has(k)) fail(`duplicate dynamic key ${k}`);
    covered.add(k);
  }
}
for (const k of EXPECTED) if (!covered.has(k)) fail(`missing param: ${k}`);
for (const k of covered) if (!EXPECTED.includes(k)) fail(`unexpected param: ${k}`);
eq(covered.size, EXPECTED.length, `all ${EXPECTED.length} params covered exactly once`);

// Enum tables sized to the DSP's (palette.c FX_NAMES=25, mod.h PM_NDEST=22,
// 24 reorder permutations, 15 time divisions).
eq(T.FX_NAMES.length, 25, "FX select list has 25 entries (Off + 24 effects)");
eq(T.FX_NAMES[0], "Off", "FX index 0 is Off");
eq(T.DEST_LABELS.length, 22, "22 mod/macro destinations");
eq(T.FX_REORDER_LABELS.length, 24, "24 reorder permutations");
eq(T.FX_REORDER_LABELS[0], "1-2-3-4", "reorder identity first (lex order)");
eq(T.FX_REORDER_LABELS[23], "4-3-2-1", "reorder reverse last (lex order)");
eq(T.TIMEDIV_LABELS.length, 15, "15 time divisions");

function makeCtx(over = {}) {
  const store = Object.assign({}, T.DEFAULTS, over);
  const writes = [];
  return {
    store, writes, state: {}, width: 128, height: 64,
    getParam: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? String(store[k]) : null),
    setParam(k, v) { writes.push([k, v]); store[k] = v; },
    getValue: () => "0", setValue: () => {},
    setPixel() {}, fillRect() {}, drawRect() {}, print() {},
    measureText: (s) => String(s).length * 6
  };
}
const midi = (ctx, cc, d2) => be.onMidi(ctx, { data: [0xB0, cc, d2] });

// Mod banks swap their shape cells (knobs 3-5) by the live m{n}_mode.
{
  const ctx = makeCtx({ m1_mode: "Envelope" });
  eq(T.cellsFor(ctx, T.BANKS[4], 0, ctx.state)[2].key, "m1_env_a", "Envelope mode -> Atk cell");
  ctx.store.m1_mode = "Random";
  eq(T.cellsFor(ctx, T.BANKS[4], 0, ctx.state)[2].key, "m1_rnd_rate", "Random mode -> Rate cell");
  eq(T.headerFor(ctx, T.BANKS[4], ctx.state), "Mod 1: Random", "mod header is live");
}

// Macro route cursor: local state, retargets dest/level, no param write.
{
  const ctx = makeCtx();
  be.onOpen(ctx); ctx.state.bank = 7; be.draw(ctx);
  eq(T.cellsFor(ctx, T.BANKS[7], 0, ctx.state)[5].key, "macro1_dest", "route starts at M1");
  midi(ctx, 75, 1); midi(ctx, 75, 1);   // knob 5 = cursor, KIT_SENS=2 -> one fire
  eq(ctx.state.macroSel, 2, "cursor advances local state");
  eq(T.cellsFor(ctx, T.BANKS[7], 0, ctx.state)[5].key, "macro2_dest", "dest cell follows the cursor");
  eq(T.headerFor(ctx, T.BANKS[7], ctx.state), "Macros > M2", "macro header follows the cursor");
  eq(ctx.writes.length, 0, "cursor writes no param");
}

// Wire codecs: float 0..1 and 0..2, label enums, preset "N Name".
{
  const ctx = makeCtx({ fx1_amount: "0.63", input_vol: "1.5", m1_level: "0.75",
                        fx1_select: "Phaser", current_preset: "7 Tape Wash" });
  const fx1 = T.BANKS[0].knobs;
  eq(T.getRaw(ctx, fx1[1]), 63, "float wire 0.63 -> 63");
  eq(T.formatCell(ctx, fx1[0]).text, "Phaser", "select shows the label");
  eq(T.getRaw(ctx, fx1[0]), 9, "select label parses to its index");
  const glob = T.BANKS[8].knobs;
  eq(T.getRaw(ctx, glob[0]), 150, "input_vol 1.5 -> 150");
  eq(T.formatCell(ctx, glob[0]).text, "1.50", "input_vol reads back 1.50");
  eq(T.getRaw(ctx, glob[7]), 7, "preset parses leading int");
  eq(T.formatCell(ctx, glob[7]).text, "7 Tape Wash", "preset shows the raw string");
  const lvl = T.BANKS[4].knobs[6];
  eq(T.formatCell(ctx, lvl).text, "+50", "level 0.75 shows +50 (signed percent)");
}

// Knob writes go out in wire format; select writes drop their cache entry so
// the display re-reads the LANDED effect (the DSP skip-walk may move it).
{
  const ctx = makeCtx({ fx1_amount: "0.5", fx1_select: "Off" });
  be.onOpen(ctx); ctx.state.bank = 0; be.draw(ctx);   // install cache wrappers
  midi(ctx, 72, 1); midi(ctx, 72, 1);                 // amount +1 (KIT_SENS=2)
  eq(ctx.writes[ctx.writes.length - 1], ["fx1_amount", "0.51"], "float write in wire format");
  ctx.writes.length = 0;
  for (let i = 0; i < 7; i++) midi(ctx, 71, 1);       // select +1 (enum sens=7)
  eq(ctx.writes[ctx.writes.length - 1], ["fx1_select", "1"], "select writes the index");
  ctx.store.fx1_select = "Sweeten";                   // pretend the walk skipped Drive
  eq(ctx.getParam("fx1_select"), "Sweeten", "select cache dropped -> landed value read");
  ctx.getParam("m1_level");                           // warm the level cache
  ctx.setParam("m1_dest", "5");
  ctx.store.m1_level = "0.9";
  eq(ctx.getParam("m1_level"), "0.9", "dest write drops the level mirror");
}

// Draw smoke over all 9 banks + picker + enum overlay.
{
  const ctx = makeCtx();
  be.onOpen(ctx);
  try {
    for (let b = 0; b < T.BANKS.length; b++) { ctx.state.bank = b; be.draw(ctx); }
    ctx.state.bank = 0; ctx.state.lastKnob = 0; be.draw(ctx);  // select overlay
    be.onMidi(ctx, { data: [0x90, 9, 127] }); be.draw(ctx);    // jog-touch picker
    eq(true, true, "draw smoke over all banks");
  } catch (e) {
    fail("draw smoke threw: " + (e && e.message));
  }
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall palette canvas tests passed");
