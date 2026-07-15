/* ---- PALETTE — on-device canvas editor (Bank Editor) ----
 * Loaded by the host as a type:"canvas" overlay (canvas.js#palette_editor),
 * wired to the "editor" param (see palette.c chain_params: canvas_script
 * "canvas.js#palette_editor"). Ported from the Echidna FX Suite's
 * src/canvas.js (same GPL codebase; this port is MIT per this repo's
 * license): reuses its pixel font, cell-bank architecture, SHIFT+jog section
 * picker, scrolling enum-picker HUD, knob-touch handling and accum/sens
 * acceleration verbatim. The cell/bank CONTENT below is palette-specific —
 * palette's 4 FX slots are GENERIC (no per-type param maps), so this drops
 * echidna's driveParams/modParams/spaceParams/filterParams/dynParams
 * entirely in favour of 9 fixed banks: FX1-4, Mod1-3, Macros, Global.
 *
 * Param contract (see src/dsp/mod.h + src/dsp/palette.c set_param/get_param):
 * enum params exchange DISPLAY values — labels (e.g. "LFO", "FX2 Macro") on
 * read; writes send the option INDEX as a string (palette's pm_enum_from_str /
 * pm_dest_from_str / fxN_select handler all resolve digit-first, else exact
 * label match, else index 0). Floats are 0..1 (or 0..2 for input_vol),
 * dest/level cells are a per-source CURSOR into a depth table (dest picks
 * which destination cell "level" edits — same mechanism for the 3 modulators
 * and the 4 macros). Wrapped in an IIFE so top-level helpers stay scoped. */
(function () {

/* ---- pure helpers (verbatim from the donor) ---- */

function dirFromCC(d2) {
  if (d2 >= 1 && d2 <= 63) return 1;
  if (d2 >= 65 && d2 <= 127) return -1;
  return 0;
}

function clampBank(idx, count) {
  if (idx < 0) return 0;
  if (idx > count - 1) return count - 1;
  return idx;
}

function accumStep(accum, dir, sens) {
  if ((accum > 0 && dir < 0) || (accum < 0 && dir > 0)) accum = 0;
  accum += dir;
  if (Math.abs(accum) >= sens) return { accum: 0, fire: true };
  return { accum: accum, fire: false };
}

function wrapInc(cur, dir, n) {
  if (n <= 0) return 0;
  var v = (cur + dir) % n;
  if (v < 0) v += n;
  return v;
}

function clampInt(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* Detents per unit change for CONTINUOUS params — >1 slows the knob feel and
 * cuts the blocking-write rate (each write is a ~2.6ms host round-trip). */
var KNOB_SENS = 3;
/* Detents per step for ENUM cells (select/dest/reorder/time-div lists) —
 * slower than continuous so long lists are scannable; lists CLAMP at the
 * ends (no wrap-around). */
var ENUM_SENS = 5;

/* ---- mcufont: 5x5 monospace bitmap font (ported verbatim from the donor,
 * itself from schwung-davebox assets/fonts/mcufont.h). draw() overrides
 * ctx.print/ctx.measureText to use these so all layout code renders in this
 * font. Uppercase only; 5px glyph + 1px gap = 6px advance. ---- */
var PF_GLYPH_W = 5, PF_GLYPH_H = 5, PF_ADVANCE = 6;
var PF_FONT = {
  "A": ["01110", "10001", "11111", "10001", "10001"],
  "B": ["11110", "10001", "11110", "10001", "11110"],
  "C": ["01111", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "11100", "10000", "11111"],
  "F": ["11111", "10000", "11100", "10000", "10000"],
  "G": ["01111", "10000", "10011", "10001", "01111"],
  "H": ["10001", "10001", "11111", "10001", "10001"],
  "I": ["11111", "00100", "00100", "00100", "11111"],
  "J": ["11111", "00010", "00010", "10010", "01100"],
  "K": ["10010", "10100", "11000", "10100", "10010"],
  "L": ["10000", "10000", "10000", "10000", "11111"],
  "M": ["11111", "10101", "10101", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001"],
  "O": ["01110", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "11110", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10010", "01101"],
  "R": ["11110", "10001", "11110", "10010", "10001"],
  "S": ["01111", "10000", "01110", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "01010", "01010", "00100"],
  "W": ["10001", "10001", "10101", "10101", "11011"],
  "X": ["10001", "01010", "00100", "01010", "10001"],
  "Y": ["10001", "01010", "00100", "00100", "00100"],
  "Z": ["11111", "00010", "00100", "01000", "11111"],
  "0": ["01110", "10001", "10101", "10001", "01110"],
  "1": ["01100", "10100", "00100", "00100", "11111"],
  "2": ["01110", "10001", "00110", "01000", "11111"],
  "3": ["11111", "00001", "01110", "00001", "11110"],
  "4": ["10010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "01110", "00001", "11110"],
  "6": ["01110", "10000", "11110", "10001", "01110"],
  "7": ["11111", "00010", "00100", "01000", "01000"],
  "8": ["01110", "10001", "01110", "10001", "01110"],
  "9": ["11111", "10001", "11111", "00001", "00001"],
  " ": ["00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "01110", "00000", "00000"],
  "+": ["00000", "00100", "01110", "00100", "00000"],
  ".": ["00000", "00000", "00000", "00000", "01000"],
  ":": ["00000", "01000", "00000", "01000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000"],
  ">": ["10000", "01000", "00100", "01000", "10000"],
  "×": ["00000", "01010", "00100", "01010", "00000"]
};

function pfWidth(text) {
  return Math.max(0, String(text).length * PF_ADVANCE - 1);
}

function pfPrint(ctx, x, y, text, color) {
  var s = String(text).toUpperCase();
  var v = color ? 1 : 0;
  var ox0 = Math.round(x), oy = Math.round(y);
  for (var i = 0; i < s.length; i++) {
    var rows = PF_FONT[s[i]] || PF_FONT[" "];
    var ox = ox0 + i * PF_ADVANCE;
    for (var r = 0; r < PF_GLYPH_H; r++) {
      var row = rows[r];
      for (var c = 0; c < PF_GLYPH_W; c++) {
        if (row[c] === "1") ctx.setPixel(ox + c, oy + r, v);
      }
    }
  }
}

/* ---- enum label tables (must match the engine's get_param output EXACTLY —
 * see src/dsp/mod.h PM_MODE_NAMES/PM_SYNC_NAMES/PM_WAVE_NAMES/pm_dest_label,
 * and palette.c FX_NAMES / DIVS[] / tempo_src / fx_reorder PERM[]). ---- */

/* FX select list — 25 entries, index 0 = "Off" (palette.c FX_NAMES[PFX_COUNT]). */
const FX_NAMES = ["Off", "Drive", "Sweeten", "Fuzz", "Howl", "Fold", "Swell",
                  "Doubler", "Vibrato", "Phaser", "Tremolo", "Pitch", "Shift",
                  "Cascade", "Reels", "Collage", "Reverse", "Space", "Bloom",
                  "Filter", "Squash", "Cassette", "Broken", "Interference", "Halo"];

/* Destination labels 0..21 (mod.h PM_NDEST=22 / pm_dest_label): None, then
 * FXn Amount/Macro/Drift (n=1..4), Mix, Feedback, Input Vol, Mod1-3 Rate,
 * Mod1-3 Level. */
const DEST_LABELS = ["None", "FX1 Amount", "FX1 Macro", "FX1 Drift",
                     "FX2 Amount", "FX2 Macro", "FX2 Drift",
                     "FX3 Amount", "FX3 Macro", "FX3 Drift",
                     "FX4 Amount", "FX4 Macro", "FX4 Drift",
                     "Mix", "Feedback", "Input Vol",
                     "Mod 1 Rate", "Mod 2 Rate", "Mod 3 Rate",
                     "Mod 1 Level", "Mod 2 Level", "Mod 3 Level"];

const MODE_LABELS     = ["LFO", "Envelope", "Random"];             /* m{n}_mode */
const MODSYNC_LABELS  = ["Free", "Key", "BPM", "BPM+Key"];         /* m{n}_sync */
const LFOWAVE_LABELS  = ["Triangle", "Square", "Pulse 25", "Trapezoid", "Chaos", "Saw Down"]; /* m{n}_lfo_wave */
const TEMPOSRC_LABELS = ["Move", "Int"];                           /* tempo_src */
const TIMEDIV_LABELS  = ["Free", "1/1", "1/2", "1/2T", "1/2D", "1/4", "1/4T", "1/4D",
                         "1/8", "1/8T", "1/8D", "1/16", "1/16T", "1/16D", "1/32"]; /* time_div */

/* FX reorder — 24 permutations of [1,2,3,4] in lexicographic order, "N-N-N-N"
 * strings. Matches palette.c PERM[24][4] (0-based lex order + 1). Generated
 * here rather than hand-listed so the order can't drift from the algorithm. */
const FX_REORDER_LABELS = (function () {
  function permsOf(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      const subs = permsOf(rest);
      for (let j = 0; j < subs.length; j++) out.push([arr[i]].concat(subs[j]));
    }
    return out;
  }
  const all = permsOf([1, 2, 3, 4]);
  all.sort((a, b) => {
    for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  return all.map((p) => p.join("-"));
})();

/* ---- cell descriptor constructors ----
 * kinds: uni (0..1), bip (0..1 centered at 0.5), raw (custom lo..hi, e.g.
 * input_vol 0..2), count (int lo..hi), enum (label options), cursor (local
 * UI counter 1..4, no param write), preset (special: display the raw "N
 * Name" string, write parses the leading int ±1), blank. Enum cells carry
 * `options` (full labels — index match + picker) and a `picker` flag for
 * long lists that get the scrolling HUD. */
function uni(key, label)  { return { key, label, kind: "uni",  min: 0, max: 1, step: 0.02, dflt: 0.3 }; }
function bip(key, label)  { return { key, label, kind: "bip",  min: 0, max: 1, step: 0.02, dflt: 0.5 }; }
function rawc(key, label, lo, hi, step, dflt) { return { key, label, kind: "raw", min: lo, max: hi, step, dflt }; }
function countc(key, label, lo, hi, dflt) { return { key, label, kind: "count", min: lo, max: hi, step: 1, dflt: dflt != null ? dflt : lo }; }
function enumc(key, label, options, picker) { return { key, label, kind: "enum", options, picker: !!picker }; }
function destc(key, label) { return enumc(key, label, DEST_LABELS, true); }
function cursorc(label, val) { return { key: null, label, kind: "cursor", min: 1, max: 4, val }; }
function presetc(key, label) { return { key, label, kind: "preset" }; }
function blank() { return { key: null, label: "", kind: "blank" }; }

/* ---- value reads ---- */

function getStr(ctx, key, dflt) {
  const v = ctx.getParam(key);
  return (v == null) ? dflt : v;
}

/* Enum cell -> current option index (label match, numeric fallback, else 0). */
function enumIndex(ctx, key, options) {
  const raw = ctx.getParam(key);
  if (raw == null) return 0;
  const i = options.indexOf(String(raw));
  if (i >= 0) return i;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : clampInt(n, 0, options.length - 1);
}
function cellEnumIndex(ctx, cell) { return enumIndex(ctx, cell.key, cell.options); }

/* Numeric cell -> current value (float; display units as the engine returns). */
function getNum(ctx, cell) {
  if (cell.kind === "cursor") return cell.val;
  const v = parseFloat(getStr(ctx, cell.key, String(cell.dflt != null ? cell.dflt : cell.min)));
  return isNaN(v) ? (cell.dflt != null ? cell.dflt : cell.min) : v;
}

/* Wire-format a numeric write, snapped to the cell's step grid. */
function fmtWrite(cell, v) {
  if (cell.kind === "count" || cell.kind === "cursor") return String(Math.round(v));
  const q = Math.round(v / cell.step) * cell.step;
  return String(+q.toFixed(4));
}

/* ---- bank cell sets ---- */

function fxCells(ctx, n) {
  const pfx = "fx" + n + "_";
  return [
    enumc(pfx + "select", "Select", FX_NAMES, true),
    uni(pfx + "amount", "Amount"),
    uni(pfx + "macro", "Macro"),
    uni(pfx + "drift", "Drift"),
    blank(), blank(), blank(), blank()
  ];
}
function fxHeader(ctx, n) {
  return "FX " + n + ": " + getStr(ctx, "fx" + n + "_select", "Off");
}

/* Mode-dependent shape cells (knobs 3-5), re-read m{n}_mode each render. */
function modShape(mode, pfx) {
  if (mode === 0) return [uni(pfx + "lfo_rate", "Rate"), enumc(pfx + "lfo_wave", "Wave", LFOWAVE_LABELS), uni(pfx + "lfo_fade", "Fade")];
  if (mode === 1) return [uni(pfx + "env_a", "Atk"), uni(pfx + "env_dr", "D-R"), uni(pfx + "env_s", "Sus")];
  return [uni(pfx + "rnd_rate", "Rate"), uni(pfx + "rnd_lag", "Lag"), uni(pfx + "rnd_prob", "Prob")]; // Random
}
function modCells(ctx, n) {
  const pfx = "m" + n + "_";
  const mode = enumIndex(ctx, pfx + "mode", MODE_LABELS);
  return [
    enumc(pfx + "mode", "Mode", MODE_LABELS),
    enumc(pfx + "sync", "Sync", MODSYNC_LABELS),
    ...modShape(mode, pfx),
    destc(pfx + "dest", "Dest"),
    bip(pfx + "level", "Lvl"),
    blank()
  ];
}
function modHeader(ctx, n) {
  const pfx = "m" + n + "_";
  return "Mod " + n + ": " + MODE_LABELS[enumIndex(ctx, pfx + "mode", MODE_LABELS)];
}

/* Macros bank: 4 macro values, a local "which macro" route cursor, then
 * DEST + LEVEL for the cursored macro (knob 8 blank). The DSP has no
 * "route" concept — macro{n}_dest/level ARE independently addressable per
 * macro already; the cursor is purely this UI's way of picking which one
 * knobs 6-7 currently edit. */
function macroCells(ctx, s) {
  const sel = clampInt((s && s.macroSel) || 1, 1, 4);
  return [
    uni("macro1", "M1"), uni("macro2", "M2"), uni("macro3", "M3"), uni("macro4", "M4"),
    cursorc("Route", sel),
    destc("macro" + sel + "_dest", "Dest"),
    bip("macro" + sel + "_level", "Lvl"),
    blank()
  ];
}
function macroHeader(ctx, s) {
  return "Macros > M" + clampInt((s && s.macroSel) || 1, 1, 4);
}

function globalCells(ctx) {
  return [
    rawc("input_vol", "InVol", 0, 2, 0.02, 1),
    uni("mix", "Mix"),
    uni("feedback", "Fdbk"),
    enumc("fx_reorder", "Reorder", FX_REORDER_LABELS, true),
    enumc("tempo_src", "TmpSrc", TEMPOSRC_LABELS),
    countc("tempo_bpm", "Tempo", 10, 500, 120),
    enumc("time_div", "TimeDiv", TIMEDIV_LABELS, true),
    presetc("current_preset", "Preset")
  ];
}

/* ---- the bank set ---- */
const BANKS = [
  { label: "FX 1", dynamicCells: (ctx) => fxCells(ctx, 1), headerFn: (ctx) => fxHeader(ctx, 1) },
  { label: "FX 2", dynamicCells: (ctx) => fxCells(ctx, 2), headerFn: (ctx) => fxHeader(ctx, 2) },
  { label: "FX 3", dynamicCells: (ctx) => fxCells(ctx, 3), headerFn: (ctx) => fxHeader(ctx, 3) },
  { label: "FX 4", dynamicCells: (ctx) => fxCells(ctx, 4), headerFn: (ctx) => fxHeader(ctx, 4) },
  { label: "Mod 1", dynamicCells: (ctx) => modCells(ctx, 1), headerFn: (ctx) => modHeader(ctx, 1) },
  { label: "Mod 2", dynamicCells: (ctx) => modCells(ctx, 2), headerFn: (ctx) => modHeader(ctx, 2) },
  { label: "Mod 3", dynamicCells: (ctx) => modCells(ctx, 3), headerFn: (ctx) => modHeader(ctx, 3) },
  { label: "Macros", macros: true, dynamicCells: (ctx, s) => macroCells(ctx, s), headerFn: (ctx, s) => macroHeader(ctx, s) },
  { label: "Global", dynamicCells: (ctx) => globalCells(ctx), headerFn: () => "Global" }
];

/* Shift+jog section picker — 1:1 with banks here (each bank is its own
 * section), but kept so the scrolling nav popover matches the donor. */
const JUMP_SECTIONS = BANKS.map((b, i) => ({ name: b.label.toUpperCase(), bank: i }));
function activeSection(bankIdx) { return clampInt(bankIdx, 0, JUMP_SECTIONS.length - 1); }

function cellsFor(ctx, bank, s) {
  return bank.knobs || bank.dynamicCells(ctx, s);
}
function headerFor(ctx, bank, s) {
  return bank.headerFn ? bank.headerFn(ctx, s) : bank.label;
}

/* ---- state / lifecycle ---- */
function readState(ctx) {
  const s = ctx.state;
  if (!s.init) {
    s.init = true;
    let v = parseInt((ctx.getValue && ctx.getValue()) || "0", 10);
    if (isNaN(v)) v = 0;
    s.bank = clampBank(v, BANKS.length);
    s.accum = [0, 0, 0, 0, 0, 0, 0, 0];
    s.lastKnob = -1;
    s.macroSel = 1;    // Macros bank: which macro's dest/level is being edited
    s.shift = false;   // SHIFT held (CC 15) -> section picker
    s.jogTouch = false; // jog capacitive touch (note 9) -> same picker, no hold
  }
  return s;
}

/* ---- layout renderers (verbatim from the donor) ---- */
const HDR_H2 = 9;
const TAB_Y = 64;

function fitText(ctx, text, maxW) {
  if (maxW <= 0) return "";
  let t = String(text);
  while (t.length > 0 && ctx.measureText(t) > maxW) t = t.slice(0, -1);
  return t;
}

/* Resolve {text, bar, centerBar} for a cell. bar = 0..1 left-anchored fill;
 * centerBar = -1..1 center-out fill. */
function formatCell(ctx, cell) {
  if (cell.kind === "blank") return { text: "--", bar: null, centerBar: null };
  if (cell.kind === "enum") {
    const idx = cellEnumIndex(ctx, cell);
    const name = cell.options[idx] || ("#" + idx);
    return { text: name, bar: null, centerBar: null };
  }
  if (cell.kind === "cursor") return { text: String(cell.val), bar: null, centerBar: null };
  if (cell.kind === "preset") {
    return { text: getStr(ctx, cell.key, "1 Init"), bar: null, centerBar: null };
  }
  const v = getNum(ctx, cell);
  if (cell.kind === "bip") {
    const signed = (v - 0.5) * 2;
    return { text: (signed > 0 ? "+" : "") + Math.round(signed * 100), bar: null, centerBar: clamp(signed, -1, 1) };
  }
  if (cell.kind === "count") {
    return { text: String(Math.round(v)), bar: null, centerBar: null };
  }
  if (cell.kind === "raw") {
    const frac = cell.max > cell.min ? clamp((v - cell.min) / (cell.max - cell.min), 0, 1) : 0;
    return { text: v.toFixed(2), bar: frac, centerBar: null };
  }
  // unipolar 0..1 -> percent readout + left-anchored bar
  return { text: String(Math.round(clamp(v, 0, 1) * 100)), bar: clamp(v, 0, 1), centerBar: null };
}

function drawChrome(ctx, fullHeaderText) {
  ctx.fillRect(0, 0, ctx.width, HDR_H2, 1);
  ctx.print(2, 1, fitText(ctx, fullHeaderText, ctx.width - 4), 0);
}

/* Section-jump navigator overlay — shown while SHIFT is held or a finger rests
 * on the jog (verbatim behaviour from the donor). */
function drawSectionNav(ctx, s) {
  if (!s.shift && !s.jogTouch) return;
  const items = JUMP_SECTIONS;
  const active = activeSection(s.bank);
  const x = 4, y = 2, w = ctx.width - 8, h = ctx.height - 4;
  ctx.fillRect(x, y, w, h, 0);
  ctx.drawRect(x, y, w, h, 1);
  const rowH = 8, listY = y + 3, visible = 7;
  let top = active - Math.floor(visible / 2);
  top = Math.max(0, Math.min(Math.max(0, items.length - visible), top));
  for (let r = 0; r < visible; r++) {
    const i = top + r;
    if (i >= items.length) break;
    const ry = listY + r * rowH;
    const sel = i === active;
    if (sel) ctx.fillRect(x + 2, ry - 1, w - 6, rowH, 1);
    ctx.print(x + 4, ry, items[i].name, sel ? 0 : 1);
  }
  const trackY = listY - 1, trackH = visible * rowH;
  const thumbH = Math.max(4, Math.round(trackH * visible / items.length));
  const denom = Math.max(1, items.length - visible);
  const thumbY = trackY + Math.round((trackH - thumbH) * top / denom);
  ctx.fillRect(x + w - 2, trackY, 1, trackH, 1);
  ctx.fillRect(x + w - 3, thumbY, 2, thumbH, 1);
}

/* Value bar under a cell: unipolar -> left-anchored fill; bipolar/centered ->
 * center-out fill with a permanent center tick. */
function drawValueBar(ctx, x, y, w, th, fmt, fg) {
  const bg = fg === 1 ? 0 : 1;
  if (fmt.centerBar != null) {
    ctx.fillRect(x, y, w, th, bg);
    const half = Math.floor(w / 2), cx = x + half;
    const sgn = clamp(fmt.centerBar, -1, 1);
    const mag = Math.round(half * Math.abs(sgn));
    if (sgn >= 0) { if (mag > 0) ctx.fillRect(cx, y, mag, th, fg); }
    else if (mag > 0) ctx.fillRect(cx - mag, y, mag, th, fg);
    ctx.fillRect(cx, y, 1, th, fg);
    return true;
  }
  if (fmt.bar != null) {
    ctx.fillRect(x, y, w, th, bg);
    const fillW = Math.round(w * fmt.bar);
    if (fillW > 0) ctx.fillRect(x, y, fillW, th, fg);
    return true;
  }
  return false;
}

function drawCellBox(ctx, x, y, w, h, label, fmt, highlighted) {
  if (highlighted) ctx.fillRect(x, y, w, h, 1);
  const fg = highlighted ? 0 : 1;
  const innerW = w - 4;
  if (h < 18) { ctx.print(x + 2, y + 1, fitText(ctx, label, innerW), fg); return; }
  const hasBar = fmt.bar != null || fmt.centerBar != null;
  const blockH = 20;
  const ly = y + Math.max(1, Math.floor((h - blockH) / 2));
  ctx.print(x + 2, ly, fitText(ctx, label, innerW), fg);
  ctx.print(x + 2, ly + 8, fitText(ctx, fmt.text, innerW), fg);
  if (hasBar) drawValueBar(ctx, x + 2, ly + 18, innerW, 2, fmt, fg);
}

/* Scrolling enum picker pop-over (any enum cell flagged `picker`). Surfaces
 * while that knob is held: the live option inverted in the middle, its
 * neighbours above/below — so a 25-entry list is navigable on 128px. */
function drawPickerHud(ctx, cells, s) {
  const idx = s.lastKnob;
  const cell = idx >= 0 ? cells[idx] : null;
  if (!cell || !cell.picker || cell.kind !== "enum") return false;
  const sel = cellEnumIndex(ctx, cell);
  const opts = cell.options;
  const x = 6, y = 11, w = 116, h = 40;
  ctx.fillRect(x, y, w, h, 0);
  ctx.drawRect(x, y, w, h, 1);
  ctx.print(x + 3, y + 2, fitText(ctx, cell.label, w - 34), 1);
  const pos = (sel + 1) + "/" + opts.length;
  ctx.print(x + w - 3 - ctx.measureText(pos), y + 2, pos, 1);
  ctx.fillRect(x + 1, y + 9, w - 2, 1, 1);
  const rowH = 9, rows = 3, mid = Math.floor(rows / 2);
  const listY = y + 11;
  for (let r = 0; r < rows; r++) {
    const oi = sel - mid + r;
    if (oi < 0 || oi >= opts.length) continue;
    const ry = listY + r * rowH;
    const isSel = oi === sel;
    if (isSel) ctx.fillRect(x + 2, ry - 1, w - 4, rowH, 1);
    ctx.print(x + 4, ry, fitText(ctx, opts[oi], w - 8), isSel ? 0 : 1);
  }
  return true;
}

/* 2x4 cell grid. */
function drawGrid(ctx, bank, cells, s) {
  drawChrome(ctx, headerFor(ctx, bank, s));
  const COL_X0 = 0, ROW_Y0 = HDR_H2 + 1, ROW_GAP = 2, CELL_W = 32;
  const CELL_H = Math.floor(((TAB_Y - 1) - ROW_Y0 + 1 - ROW_GAP) / 2);
  const gLeft = 0, gRight = 128, gTop = ROW_Y0 - 1;
  const rowDivY = ROW_Y0 + CELL_H;
  const gBot = ROW_Y0 + 2 * CELL_H + ROW_GAP;
  ctx.drawRect(gLeft, gTop, gRight - gLeft, gBot - gTop, 1);
  for (let c = 1; c < 4; c++) ctx.fillRect(COL_X0 + c * CELL_W - 1, gTop, 1, gBot - gTop, 1);
  ctx.fillRect(gLeft, rowDivY, gRight - gLeft, 1, 1);
  const colL = (c) => (c === 0 ? gLeft : COL_X0 + c * CELL_W - 1);
  const colR = (c) => (c === 3 ? gRight - 1 : COL_X0 + (c + 1) * CELL_W - 1);
  for (let k = 0; k < 8; k++) {
    const cell = cells[k];
    if (!cell) continue;
    const col = k % 4, row = k < 4 ? 0 : 1;
    const lx = colL(col), rx = colR(col);
    const ty = row === 0 ? gTop : rowDivY, by = row === 0 ? rowDivY : gBot - 1;
    drawCellBox(ctx, lx + 1, ty + 1, rx - lx - 1, by - ty - 1, cell.label, formatCell(ctx, cell), k === s.lastKnob);
  }
  drawPickerHud(ctx, cells, s);
}

function draw(ctx, bank, cells, s) { drawGrid(ctx, bank, cells, s); drawSectionNav(ctx, s); }

/* ---- overlay object ---- */
const palette_editor = {
  onOpen(ctx) {
    ctx.state.init = false; // force re-seed from the persisted value
    readState(ctx);
  },

  onMidi(ctx, payload) {
    const d = payload && payload.data;
    if (!d || d.length < 3) return;
    const s = readState(ctx);
    const status = d[0] & 0xF0;

    if (status === 0x90 || status === 0x80) { // capacitive touch: notes 0-7 knobs, 9 jog
      const note = d[1];
      if (note <= 7) s.lastKnob = (status === 0x90 && d[2] >= 64) ? note : -1;
      if (note === 9) s.jogTouch = (status === 0x90 && d[2] >= 64);
      return;
    }
    if (status !== 0xB0) return;
    const cc = d[1], val = d[2];

    if (cc === 15) { s.shift = val >= 64; return; } // SHIFT (hold) -> section picker

    if (cc === 14) { // jog: cycle banks (shift+jog jumps sections — 1:1 here)
      const jd = dirFromCC(val);
      if (jd) {
        if (s.shift) {
          const ni = clampBank(activeSection(s.bank) + jd, JUMP_SECTIONS.length);
          s.bank = JUMP_SECTIONS[ni].bank;
        } else {
          s.bank = clampBank(s.bank + jd, BANKS.length);
        }
        if (ctx.setValue) ctx.setValue(String(s.bank));
        s.lastKnob = -1;
      }
      return;
    }

    if (cc < 71 || cc > 78) return;
    const k = cc - 71;
    const dir = dirFromCC(val);
    if (!dir) return;
    const cell = cellsFor(ctx, BANKS[s.bank], s)[k];
    if (!cell || cell.kind === "blank") return;
    s.lastKnob = k;

    if (cell.kind === "cursor") { // local macro-route cursor (no param write)
      const r = accumStep(s.accum[k], dir, KNOB_SENS);
      s.accum[k] = r.accum;
      if (!r.fire) return;
      s.macroSel = clampInt((s.macroSel || 1) + dir, 1, 4);
      return;
    }

    if (cell.kind === "enum") {
      const r = accumStep(s.accum[k], dir, ENUM_SENS);
      s.accum[k] = r.accum;
      if (!r.fire) return;
      const cur = cellEnumIndex(ctx, cell);
      const nv = clampInt(cur + dir, 0, cell.options.length - 1); // no wrap-around
      if (nv !== cur) ctx.setParam(cell.key, String(nv)); // write index; DSP digit-fallback resolves it
      return;
    }

    if (cell.kind === "preset") { // current_preset: parse leading int, write int +- 1 (DSP clamps 1..N)
      const r = accumStep(s.accum[k], dir, KNOB_SENS);
      s.accum[k] = r.accum;
      if (!r.fire) return;
      const raw = getStr(ctx, cell.key, "1");
      const cur = parseInt(raw, 10);
      const base = isNaN(cur) ? 1 : cur;
      ctx.setParam(cell.key, String(base + dir));
      return;
    }

    // numeric (uni/bip/raw/count)
    const r = accumStep(s.accum[k], dir, KNOB_SENS);
    s.accum[k] = r.accum;
    if (!r.fire) return;
    const cur = getNum(ctx, cell);
    const nv = clamp(cur + dir * cell.step, cell.min, cell.max);
    const w = fmtWrite(cell, nv);
    if (w !== fmtWrite(cell, cur)) ctx.setParam(cell.key, w);
  },

  tick(ctx) { /* no animated content — draw() is called by the host each frame */ },

  draw(ctx) {
    if (!ctx._pfInstalled) {
      // (1) route all text through the ported pixel font
      ctx.print = function (x, y, text, color) { pfPrint(ctx, x, y, text, color ? 1 : 0); };
      ctx.measureText = function (str) { return pfWidth(str); };
      // (2) getParam cache: each device getParam is a ~2.6ms blocking round-trip
      // and the layout reads one per cell every frame. Cache reads; write-through
      // on setParam; invalidate the dest->level mirror (changing dest changes
      // which depth-table cell "level" reads/writes).
      var rawGet = ctx.getParam, rawSet = ctx.setParam;
      ctx._pcache = {};
      ctx.getParam = function (kk) {
        if (Object.prototype.hasOwnProperty.call(ctx._pcache, kk)) return ctx._pcache[kk];
        var v = rawGet.call(ctx, kk);
        ctx._pcache[kk] = v;
        return v;
      };
      ctx.setParam = function (kk, v) {
        var rr = rawSet.call(ctx, kk, v);
        ctx._pcache[kk] = String(v);
        if (/_dest$/.test(kk)) delete ctx._pcache[kk.slice(0, -5) + "_level"];
        return rr;
      };
      ctx._cacheTick = 0;
      ctx._pfInstalled = true;
    }
    if ((ctx._cacheTick = (ctx._cacheTick + 1) % 24) === 0) ctx._pcache = {};

    const s = readState(ctx);
    const bank = BANKS[s.bank];
    const cells = cellsFor(ctx, bank, s);
    draw(ctx, bank, cells, s);
  },

  onClose(ctx) { /* nothing to persist beyond ctx.setValue(bank) done on jog */ },
  onExit(ctx) { /* alias of onClose for hosts that emit it */ },

  _test: {
    BANKS, JUMP_SECTIONS, activeSection, cellsFor, headerFor,
    dirFromCC, clampBank, accumStep, wrapInc,
    fxCells, modCells, macroCells, globalCells, formatCell,
    enumIndex, getNum, fmtWrite,
    FX_NAMES, DEST_LABELS, MODE_LABELS, MODSYNC_LABELS, LFOWAVE_LABELS,
    TEMPOSRC_LABELS, TIMEDIV_LABELS, FX_REORDER_LABELS,
    defaultParam, KNOB_SENS
  }
};

/* Default param string for a key — ONLY used by the off-device previewer's
 * stub ctx (on device get_param always returns a real value). Mirrors
 * src/dsp/mod.h pm_mod_init defaults / palette.c param defaults closely
 * enough for a legible preview. */
function defaultParam(key) {
  if (/_select$/.test(key)) return "Off";
  if (/_mode$/.test(key)) return "LFO";
  if (/_lfo_wave$/.test(key)) return "Triangle";
  if (/_dest$/.test(key)) return "None";
  if (/_level$/.test(key)) return "0.5000";
  if (/_sync$/.test(key)) return "Free";
  if (key === "tempo_src") return "Move";
  if (key === "tempo_bpm") return "120";
  if (key === "time_div") return "Free";
  if (key === "fx_reorder") return "1-2-3-4";
  if (key === "current_preset") return "1 Init";
  if (key === "editor") return "0";
  if (key === "input_vol") return "1.0";
  if (key === "mix") return "1.0";
  if (key === "feedback") return "0";
  if (/^macro[1-4]$/.test(key)) return "0";
  if (/_(amount|macro|drift)$/.test(key)) return "0";
  if (/_lfo_rate$/.test(key)) return "0.3";
  if (/_rnd_rate$/.test(key)) return "0.3";
  if (/_env_a$/.test(key)) return "0.1";
  if (/_env_dr$/.test(key)) return "0.4";
  if (/_env_s$/.test(key)) return "0.5";
  if (/_(lfo_fade|rnd_lag|rnd_prob)$/.test(key)) return "0.5";
  return "0.3";
}

globalThis.palette_editor = palette_editor;
})();
