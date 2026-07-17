/* PALETTE canvas config for schwung-canvaskit (../../schwung-canvaskit).
 * This is the SOURCE for src/canvas.js — regenerate after editing:
 *   node ../schwung-canvaskit/build.mjs src/canvas.config.js src/canvas.js
 * Concatenated between the kit prelude (cell constructors in scope) and the
 * kit engine (which reads CONFIG) inside one IIFE.
 *
 * Wire contract (src/dsp/mod.h + src/dsp/palette.c set_param/get_param):
 * floats are 0..1 strings ("0.6300"; input_vol 0..2), enums exchange DISPLAY
 * values — the option LABEL on read, the option INDEX on write (the DSP's
 * pm_enum_from_str/pm_dest_from_str/fxN_select resolve digit-first). The kit
 * cells work in a native-int domain (0..100), so every cell carries a
 * parse/format codec pair. */

KIT_PARAM_MAX = 100;

/* ---- enum label tables (must match the engine's get_param output EXACTLY —
 * see src/dsp/mod.h PM_MODE_NAMES/PM_SYNC_NAMES/PM_WAVE_NAMES/pm_dest_label,
 * and palette.c FX_NAMES / DIVS[] / tempo_src / fx_reorder PERM[]). ---- */

/* FX select list — 25 entries, index 0 = "Off" (palette.c FX_NAMES[PFX_COUNT]). */
const FX_NAMES = ["Off", "Drive", "Sweeten", "Fuzz", "Howl", "Fold", "Swell",
                  "Doubler", "Vibrato", "Phaser", "Tremolo", "Pitch", "Shift",
                  "Cascade", "Reels", "Collage", "Reverse", "Space", "Bloom",
                  "Filter", "Squash", "Cassette", "Broken", "Interference", "Halo"];

/* Destination labels 0..21 (mod.h PM_NDEST=22 / pm_dest_label). */
const DEST_LABELS = ["None", "FX1 Amount", "FX1 Macro", "FX1 Drift",
                     "FX2 Amount", "FX2 Macro", "FX2 Drift",
                     "FX3 Amount", "FX3 Macro", "FX3 Drift",
                     "FX4 Amount", "FX4 Macro", "FX4 Drift",
                     "Mix", "Feedback", "Input Vol",
                     "Mod 1 Rate", "Mod 2 Rate", "Mod 3 Rate",
                     "Mod 1 Level", "Mod 2 Level", "Mod 3 Level"];
const DEST_SQ = ["OFF", "F1A", "F1M", "F1D", "F2A", "F2M", "F2D",
                 "F3A", "F3M", "F3D", "F4A", "F4M", "F4D",
                 "MIX", "FB", "IN", "M1R", "M2R", "M3R", "M1L", "M2L", "M3L"];

const MODE_LABELS     = ["LFO", "Envelope", "Random"];             /* m{n}_mode */
const MODE_SQ         = ["LFO", "ENV", "RND"];
const MODSYNC_LABELS  = ["Free", "Key", "BPM", "BPM+Key"];         /* m{n}_sync */
const MODSYNC_SQ      = ["FRE", "KEY", "BPM", "B+K"];
const LFOWAVE_LABELS  = ["Triangle", "Square", "Pulse 25", "Trapezoid", "Chaos", "Saw Down"]; /* m{n}_lfo_wave */
const LFOWAVE_SQ      = ["TRI", "SQR", "P25", "TRP", "CHA", "SAW"];
const TEMPOSRC_LABELS = ["Move", "Int"];                           /* tempo_src */
const TIMEDIV_LABELS  = ["Free", "1/1", "1/2", "1/2T", "1/2D", "1/4", "1/4T", "1/4D",
                         "1/8", "1/8T", "1/8D", "1/16", "1/16T", "1/16D", "1/32"]; /* time_div */
const TIMEDIV_SQ      = ["FRE", "1/1", "1/2", "2T", "2D", "1/4", "4T", "4D",
                         "1/8", "8T", "8D", "16", "16T", "16D", "32"];

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

/* ---- wire codecs over the kit constructors ---- */

/* Float 0..1 wire ("0.6300") <-> 0..100 int domain. */
function fcodec(cell) {
  cell.parse = (raw) => Math.round(parseFloat(raw) * 100);
  cell.format = (v) => String(+(v / 100).toFixed(4));
  return cell;
}
function funi(key, label) { return fcodec(uni(key, label)); }
/* Bipolar float (levels, center 0.5): display as a signed percent (+-100). */
function fbip(key, label) {
  const c = fcodec(bip(key, label));
  c.text = (ctx) => {
    const sgn = (getRaw(ctx, c) - 50) * 2;
    return (sgn > 0 ? "+" : "") + sgn;
  };
  return c;
}
/* input_vol: float 0..2 wire, unity 1 -> 0..200 int, "1.00" readout. */
function fvol(key, label) {
  const c = uni(key, label);
  c.max = 200; c.dflt = 100;
  c.parse = (raw) => Math.round(parseFloat(raw) * 100);
  c.format = (v) => String(+(v / 100).toFixed(2));
  c.text = (ctx) => (getRaw(ctx, c) / 100).toFixed(2);
  return c;
}
/* Label-wire enum: get_param returns the option LABEL; writes stay the
 * index (the DSP resolves digit-first). Cached self-writes parse as digits. */
function lenum(key, label, options, sq) {
  const c = enumc(key, label, options, sq);
  c.parse = (raw) => {
    const i = options.indexOf(String(raw));
    if (i >= 0) return i;
    const n = parseInt(raw, 10);
    return isNaN(n) ? 0 : n;
  };
  return c;
}
function destc(key, label) { return lenum(key, label, DEST_LABELS, DEST_SQ); }
/* Macros bank route cursor: a LOCAL UI cell (no engine param) picking which
 * macro's dest/level knobs 5-6 edit. Lives in ctx.state.macroSel. */
function routec(label) {
  return { key: null, label, kind: "count", min: 1, max: 4, step: 1, sens: KIT_SENS,
    get: (ctx) => (ctx.state.macroSel || 1),
    set: (ctx, v) => { ctx.state.macroSel = v; } };
}
/* current_preset: get_param returns "N Name"; write the leading int +-1
 * (the DSP clamps 1..25 and loads the preset -> full cache flush below). */
function presetc(key, label) {
  const c = count(key, label, 1, 25);
  c.get = (ctx) => { const n = parseInt(ctx.getParam(key), 10); return isNaN(n) ? 1 : n; };
  c.set = (ctx, v) => ctx.setParam(key, String(v));
  c.text = (ctx) => String(ctx.getParam(key) || "1 Init");
  c.sqText = (ctx) => String(c.get(ctx));
  return c;
}

/* ---- bank builders ---- */

function fxBank(n) {
  const pfx = "fx" + n + "_";
  return {
    label: "FX " + n,
    knobs: [lenum(pfx + "select", "Sel", FX_NAMES),
            funi(pfx + "amount", "Amt"), funi(pfx + "macro", "Mcro"), funi(pfx + "drift", "Drft")],
    header: (ctx) => "FX " + n + ": " + (ctx.getParam(pfx + "select") || "Off")
  };
}

/* Mode-dependent shape cells (knobs 3-5), re-resolved each render. */
function modShape(mode, pfx) {
  if (mode === 1) return [funi(pfx + "env_a", "Atk"), funi(pfx + "env_dr", "D-R"), funi(pfx + "env_s", "Sus")];
  if (mode === 2) return [funi(pfx + "rnd_rate", "Rate"), funi(pfx + "rnd_lag", "Lag"), funi(pfx + "rnd_prob", "Prob")];
  return [funi(pfx + "lfo_rate", "Rate"), lenum(pfx + "lfo_wave", "Wave", LFOWAVE_LABELS, LFOWAVE_SQ), funi(pfx + "lfo_fade", "Fade")];
}
function modIndex(ctx, key) {
  const raw = ctx.getParam(key);
  const i = MODE_LABELS.indexOf(String(raw));
  if (i >= 0) return i;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}
function modBank(n) {
  const pfx = "m" + n + "_";
  const cellsAt = (mode) => [
    lenum(pfx + "mode", "Mode", MODE_LABELS, MODE_SQ),
    lenum(pfx + "sync", "Sync", MODSYNC_LABELS, MODSYNC_SQ),
    ...modShape(mode, pfx),
    destc(pfx + "dest", "Dest"),
    fbip(pfx + "level", "Lvl")
  ];
  return {
    label: "Mod " + n,
    knobs: cellsAt(0),                              // static fallback = LFO shape
    dynamicCells: (ctx) => cellsAt(modIndex(ctx, pfx + "mode")),
    dynamicKeys: [pfx + "env_a", pfx + "env_dr", pfx + "env_s",
                  pfx + "rnd_rate", pfx + "rnd_lag", pfx + "rnd_prob"],
    header: (ctx) => "Mod " + n + ": " + MODE_LABELS[modIndex(ctx, pfx + "mode")]
  };
}

/* Macros: 4 macro values, the route cursor, then DEST+LEVEL for the cursored
 * macro. macro{n}_dest/level ARE independently addressable per macro in the
 * DSP; the cursor is purely this UI's way of picking which one knobs 6-7 edit. */
const macroBank = {
  label: "Macros",
  knobs: [funi("macro1", "M1"), funi("macro2", "M2"), funi("macro3", "M3"), funi("macro4", "M4"),
          routec("Rte"), destc("macro1_dest", "Dest"), fbip("macro1_level", "Lvl")],
  dynamicCells: (ctx, s) => {
    const sel = Math.max(1, Math.min(4, (s && s.macroSel) || 1));
    return [funi("macro1", "M1"), funi("macro2", "M2"), funi("macro3", "M3"), funi("macro4", "M4"),
            routec("Rte"), destc("macro" + sel + "_dest", "Dest"), fbip("macro" + sel + "_level", "Lvl")];
  },
  dynamicKeys: ["macro2_dest", "macro2_level", "macro3_dest", "macro3_level",
                "macro4_dest", "macro4_level"],
  header: (ctx, s) => "Macros > M" + Math.max(1, Math.min(4, (s && s.macroSel) || 1))
};

const reorderCell = lenum("fx_reorder", "Ordr", FX_REORDER_LABELS);
reorderCell.sqText = (ctx) => String(FX_REORDER_LABELS[getRaw(ctx, reorderCell)] || "1-2-3-4").replace(/-/g, "");

const globalBank = {
  label: "Global",
  knobs: [fvol("input_vol", "InVl"), funi("mix", "Mix"), funi("feedback", "Fdbk"),
          reorderCell,
          lenum("tempo_src", "TSrc", TEMPOSRC_LABELS),
          count("tempo_bpm", "Tmpo", 10, 500),
          lenum("time_div", "TDiv", TIMEDIV_LABELS, TIMEDIV_SQ),
          presetc("current_preset", "Prst")]
};

const CONFIG = {
  name: "Palette",

  banks: [fxBank(1), fxBank(2), fxBank(3), fxBank(4),
          modBank(1), modBank(2), modBank(3),
          macroBank, globalBank],

  /* Picker rows 1:1 with banks (palette is flat — 9 peers, no sub-grouping). */
  sections: [
    { name: "FX 1", bank: 0 }, { name: "FX 2", bank: 1 },
    { name: "FX 3", bank: 2 }, { name: "FX 4", bank: 3 },
    { name: "MOD 1", bank: 4 }, { name: "MOD 2", bank: 5 }, { name: "MOD 3", bank: 6 },
    { name: "MACROS", bank: 7 }, { name: "GLOBAL", bank: 8 }
  ],

  icons: ["fx1", "fx2", "fx3", "fx4", "sine", "sine", "sine", "routes", "global"],
  customIcons: {
    fx1: { w: 17, draw(ctx, x, y, fg) { ctx.print(x, y + 1, "FX1", fg); } },
    fx2: { w: 17, draw(ctx, x, y, fg) { ctx.print(x, y + 1, "FX2", fg); } },
    fx3: { w: 17, draw(ctx, x, y, fg) { ctx.print(x, y + 1, "FX3", fg); } },
    fx4: { w: 17, draw(ctx, x, y, fg) { ctx.print(x, y + 1, "FX4", fg); } }
  },

  /* WIRE-format defaults (mirroring src/dsp/mod.h pm_mod_init / palette.c
   * param defaults) — only consumed off-device (previewer/tests). */
  defaults: {
    fx1_select: "Off", fx1_amount: "0", fx1_macro: "0", fx1_drift: "0",
    fx2_select: "Off", fx2_amount: "0", fx2_macro: "0", fx2_drift: "0",
    fx3_select: "Off", fx3_amount: "0", fx3_macro: "0", fx3_drift: "0",
    fx4_select: "Off", fx4_amount: "0", fx4_macro: "0", fx4_drift: "0",
    m1_mode: "LFO", m1_sync: "Free", m1_lfo_rate: "0.3", m1_lfo_wave: "Triangle", m1_lfo_fade: "0.5",
    m1_env_a: "0.1", m1_env_dr: "0.4", m1_env_s: "0.5",
    m1_rnd_rate: "0.3", m1_rnd_lag: "0.5", m1_rnd_prob: "0.5",
    m1_dest: "None", m1_level: "0.5",
    m2_mode: "LFO", m2_sync: "Free", m2_lfo_rate: "0.3", m2_lfo_wave: "Triangle", m2_lfo_fade: "0.5",
    m2_env_a: "0.1", m2_env_dr: "0.4", m2_env_s: "0.5",
    m2_rnd_rate: "0.3", m2_rnd_lag: "0.5", m2_rnd_prob: "0.5",
    m2_dest: "None", m2_level: "0.5",
    m3_mode: "LFO", m3_sync: "Free", m3_lfo_rate: "0.3", m3_lfo_wave: "Triangle", m3_lfo_fade: "0.5",
    m3_env_a: "0.1", m3_env_dr: "0.4", m3_env_s: "0.5",
    m3_rnd_rate: "0.3", m3_rnd_lag: "0.5", m3_rnd_prob: "0.5",
    m3_dest: "None", m3_level: "0.5",
    macro1: "0", macro2: "0", macro3: "0", macro4: "0",
    macro1_dest: "None", macro1_level: "0.5", macro2_dest: "None", macro2_level: "0.5",
    macro3_dest: "None", macro3_level: "0.5", macro4_dest: "None", macro4_level: "0.5",
    input_vol: "1.0", mix: "1.0", feedback: "0",
    fx_reorder: "1-2-3-4", tempo_src: "Move", tempo_bpm: "120", time_div: "Free",
    current_preset: "1 Init"
  },

  /* Post-write cache rules — palette's two engine-rewrites-the-value cases:
   * fx*_select runs the effect-uniqueness SKIP walk (the index we WROTE may
   * not be where it LANDS — caching the requested value desyncs the display
   * and the next step's "current" read -> erratic selection), and *_dest
   * moves the depth-table cell that *_level reads/writes. Preset loads
   * change everything -> full flush. */
  writeInvalidates: (key) => {
    if (key === "current_preset") return true;
    if (/_select$/.test(key)) return [key];
    if (/_dest$/.test(key)) return [key.slice(0, -5) + "_level"];
    return null;
  },

  testExports: { FX_NAMES, DEST_LABELS, MODE_LABELS, MODSYNC_LABELS, LFOWAVE_LABELS,
                 TEMPOSRC_LABELS, TIMEDIV_LABELS, FX_REORDER_LABELS, modIndex }
};
