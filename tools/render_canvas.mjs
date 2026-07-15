// Off-device renderer/preview for src/canvas.js (the palette_editor canvas overlay).
// Builds a real 128x64 1-bit framebuffer ctx, evals canvas.js, renders each bank
// (plus scenario frames + the SHIFT section-nav overlay) to a stacked PNG, and
// emits ASCII-art frames to stdout so the layout can be eyeballed with no device.
// Node-only; no deps (uses zlib).
//   node tools/render_canvas.mjs [outfile.png]   # PNG + required frames as ASCII
//   node tools/render_canvas.mjs --ascii <name>  # print one scenario as ASCII
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "canvas.js"), "utf8");
(0, eval)(src);
const be = globalThis.palette_editor, T = be._test;

const W = 128, H = 64;
function makeCtx(init = {}) {
  const store = Object.assign({}, init);
  const fb = new Uint8Array(W * H); // 0/1 per pixel
  const px = (x, y, v) => { x |= 0; y |= 0; if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = v ? 1 : 0; };
  return {
    fb, width: W, height: H,
    state: { init: true, bank: 0, lastKnob: -1, macroSel: 1, accum: [0, 0, 0, 0, 0, 0, 0, 0], shift: false, jogTouch: false },
    getParam(k) { return Object.prototype.hasOwnProperty.call(store, k) ? String(store[k]) : T.defaultParam(k); },
    setParam(k, v) { store[k] = v; },
    getValue: () => "0", setValue: () => {},
    setPixel: (x, y, v) => px(x, y, v),
    fillRect: (x, y, w, h, v) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, v); },
    drawRect: (x, y, w, h, v) => { for (let i = 0; i < w; i++) { px(x + i, y, v); px(x + i, y + h - 1, v); } for (let j = 0; j < h; j++) { px(x, y + j, v); px(x + w - 1, y + j, v); } },
    print() {}, measureText: (s) => String(s).length * 6 // overridden by draw() with the pixel font
  };
}

// Render a bank into a fresh framebuffer with the given param overrides + state.
function renderFrame({ bank = 0, params = {}, lastKnob = -1, macroSel = 1, shift = false, jogTouch = false } = {}) {
  const ctx = makeCtx(params);
  be.draw(ctx);          // one-time install (font + getParam cache), first frame
  ctx.fb.fill(0);
  Object.assign(ctx.state, { bank, lastKnob, macroSel, shift, jogTouch });
  ctx._pcache = {};      // drop the cache so overrides applied after install are seen
  be.draw(ctx);
  return ctx.fb;
}

// ---- ASCII preview -----------------------------------------------------------
function asciiFrame(fb) {
  const lines = [];
  lines.push("+" + "-".repeat(W) + "+");
  for (let y = 0; y < H; y++) {
    let row = "|";
    for (let x = 0; x < W; x++) row += fb[y * W + x] ? "#" : " ";
    lines.push(row + "|");
  }
  lines.push("+" + "-".repeat(W) + "+");
  return lines.join("\n");
}

// ---- scenarios (the verification set) ---------------------------------------
const scenarios = [];
for (let b = 0; b < T.BANKS.length; b++) scenarios.push({ name: T.BANKS[b].label, opts: { bank: b } });
scenarios.push({ name: "FX1 = Fold", opts: { bank: 0, params: { fx1_select: "Fold", fx1_amount: "0.7" }, lastKnob: 0 } });
scenarios.push({ name: "Mod1 LFO -> FX2 Amount", opts: { bank: 4, params: { m1_mode: "LFO", m1_lfo_wave: "Saw Down", m1_dest: "FX2 Amount", m1_level: "0.85" }, lastKnob: 5 } });
scenarios.push({ name: "Mod2 Envelope", opts: { bank: 5, params: { m2_mode: "Envelope", m2_dest: "Mix" }, lastKnob: 2 } });
scenarios.push({ name: "Mod3 Random", opts: { bank: 6, params: { m3_mode: "Random", m3_dest: "FX3 Drift" } } });
scenarios.push({ name: "Macros (route M2 -> Mix)", opts: { bank: 7, macroSel: 2, params: { macro2: "0.6", macro2_dest: "Mix", macro2_level: "0.75" }, lastKnob: 6 } });
scenarios.push({ name: "Global (reorder+div)", opts: { bank: 8, params: { fx_reorder: "2-1-4-3", time_div: "1/8", current_preset: "7 Init", tempo_bpm: "128" }, lastKnob: 3 } });
scenarios.push({ name: "SHIFT section nav", opts: { bank: 4, shift: true } });

const frames = scenarios.map((sc) => ({ name: sc.name, fb: renderFrame(sc.opts) }));

// ---- ASCII mode: print requested scenario(s) --------------------------------
const asciiArg = process.argv.indexOf("--ascii");
if (asciiArg >= 0) {
  const want = process.argv[asciiArg + 1];
  const picks = want ? frames.filter((f) => f.name.toLowerCase().includes(want.toLowerCase())) : frames;
  for (const f of picks) { console.log("=== " + f.name + " ==="); console.log(asciiFrame(f.fb)); console.log(""); }
  process.exit(0);
}

// Always print ASCII for the key verification scenarios to stdout.
const REQUIRED = ["FX 1", "Mod1 LFO -> FX2 Amount", "Mod2 Envelope", "Macros (route M2 -> Mix)", "Global (reorder+div)", "SHIFT section nav"];
for (const name of REQUIRED) {
  const f = frames.find((x) => x.name === name);
  if (f) { console.log("=== " + f.name + " ==="); console.log(asciiFrame(f.fb)); console.log(""); }
}

// ---- compose all frames into one tall PNG (scaled, gaps) --------------------
const SCALE = 3, GAP = 6;
const rows = frames.length;
const cellW = W * SCALE, cellH = H * SCALE;
const imgW = cellW + 2 * GAP;
const imgH = rows * (cellH + GAP) + GAP;
const img = Buffer.alloc(imgW * imgH * 4);
for (let i = 0; i < imgW * imgH; i++) { img[i * 4] = 30; img[i * 4 + 1] = 30; img[i * 4 + 2] = 34; img[i * 4 + 3] = 255; }
frames.forEach((f, idx) => {
  const oy = GAP + idx * (cellH + GAP), ox = GAP;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const on = f.fb[y * W + x];
    const r = on ? 235 : 10, g = on ? 235 : 12, b = on ? 240 : 16;
    for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
      const o = ((oy + y * SCALE + sy) * imgW + (ox + x * SCALE + sx)) * 4;
      img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255;
    }
  }
});

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(imgW, 0); ihdr.writeUInt32BE(imgH, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(imgH * (1 + imgW * 4));
for (let y = 0; y < imgH; y++) { raw[y * (1 + imgW * 4)] = 0; img.copy(raw, y * (1 + imgW * 4) + 1, y * imgW * 4, (y + 1) * imgW * 4); }
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
]);
const outArg = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const out = outArg || join(here, "..", "canvas_preview.png");
writeFileSync(out, png);
console.log("wrote", out, `(${imgW}x${imgH}, ${frames.length} frames)`);
frames.forEach((f, i) => console.log(`  frame ${i}: ${f.name}`));
