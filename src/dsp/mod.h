/* mod.h — PALETTE modulation engine (pure C).
 *
 * A lean pure-C reimplementation of the Echidna FX Suite modulator/macro system
 * (ported from schwung-echidna-fx/src/mod.h + vendor/echidna/modulator.h, both
 * GPL/MIT-compatible; palette is MIT). 3 modulators (LFO / Envelope / Random,
 * with Free/Key/BPM/BPM+Key sync) + 4 macro knobs. Every source (3 mods + 4
 * macros) routes through a full DEST + LEVEL depth table — one bipolar cell per
 * destination, all simultaneously active — edited via a dest-picker cursor + a
 * level knob. Modulators are advanced once per audio block (not per sample):
 * one block late, inaudible at ~2.9 ms, and cheap.
 *
 * Value ranges: LFO/Random bipolar ~[-1,1]; Envelope 0..1; Macros 0..1.
 * Depth cells stored as display 0..1 with 0.5 = zero depth (bipolar).
 *
 * This header is #included by palette.c ONLY (single TU) — the two-pass apply
 * that writes offsets into palette_t lives in palette.c where it can see the
 * instance internals. */
#ifndef PALETTE_MOD_H
#define PALETTE_MOD_H

#include <stdint.h>
#include <math.h>
#include <string.h>

#define PM_NUM_MODS   3
#define PM_NUM_MACROS 4
#define PM_NUM_SRC    (PM_NUM_MODS + PM_NUM_MACROS)   /* 7 */

/* ── Destination table (order is load-bearing: canvas DEST_LABELS must match) ──
 *   0            None
 *   1..12        FXn Amount / FXn Macro / FXn Drift   (n=1..4, 3 per slot)
 *   13,14,15     Mix, Feedback, Input Vol
 *   16,17,18     Mod 1..3 Rate     (cross-mod)
 *   19,20,21     Mod 1..3 Level    (cross-mod)                                */
#define PM_NDEST            22
#define PM_DEST_SLOT_BASE   1
#define PM_DEST_PER_SLOT    3
#define PM_DEST_MIX         13
#define PM_DEST_FB          14
#define PM_DEST_IV          15
#define PM_DEST_RATE_BASE   16
#define PM_DEST_LEVEL_BASE  19

/* mode / sync / wave name tables (shared with get_param enum options + canvas) */
static const char *PM_MODE_NAMES[] = { "LFO", "Envelope", "Random" };
enum { PM_MODE_LFO = 0, PM_MODE_ENV = 1, PM_MODE_RND = 2 };
#define PM_MODE_COUNT 3
static const char *PM_SYNC_NAMES[] = { "Free", "Key", "BPM", "BPM+Key" };
enum { PM_SYNC_FREE = 0, PM_SYNC_KEY = 1, PM_SYNC_BPM = 2, PM_SYNC_BPMKEY = 3 };
#define PM_SYNC_COUNT 4
static const char *PM_WAVE_NAMES[] = { "Triangle", "Square", "Pulse 25",
                                       "Trapezoid", "Chaos", "Saw Down" };
#define PM_WAVE_COUNT 6

/* ── one modulator source ─────────────────────────────────────────────────── */
typedef struct {
    /* params (0..1 unless noted) */
    int   mode;        /* PM_MODE_*  */
    int   sync;        /* PM_SYNC_*  */
    int   wave;        /* 0..5 (LFO only) */
    float lfo_rate, lfo_fade;
    float rnd_rate, rnd_lag, rnd_prob;
    float env_a, env_dr, env_s;
    /* runtime — LFO/Random */
    float lfoPhase, rndPhase, rndCur, rndTgt, chaosAmp;
    float lfoFreq, rndFreq, rndLagCoef;
    int   fadeMode;    /* 0 none, 1 in, 2 out, 3 one-shot */
    float fadeSamples, fadePos, fadeCycles;
    /* runtime — Envelope */
    int   env_stage;   /* 0 idle, 1 atk, 2 dec, 3 sus, 4 rel */
    float env;
    float envAtkInc, envDecCoef, envRelCoef;
    int   gate_prev;
    /* cross-mod + output */
    float rateOffs;    /* from "Mod N Rate" dests (previous block) */
    float value;       /* this block's output, read by the apply pass */
    uint32_t rng;
} pm_mod_t;

/* ── the whole engine (embedded in palette_t) ─────────────────────────────── */
typedef struct {
    pm_mod_t mod[PM_NUM_MODS];
    float    macro[PM_NUM_MACROS];             /* 0..1 */
    float    depth[PM_NUM_SRC][PM_NDEST];      /* display 0..1, 0.5 = zero */
    int      destSel[PM_NUM_SRC];              /* UI cursor: which cell level edits */
    int      held_notes;                       /* envelope gate / key-sync refcount */
    int      editor_bank;                       /* persisted canvas bank index */
} pm_engine_t;

/* ── PRNG (xorshift32) ────────────────────────────────────────────────────── */
static inline uint32_t pm_rng_next(pm_mod_t *m) {
    uint32_t x = m->rng; x ^= x << 13; x ^= x >> 17; x ^= x << 5; m->rng = x; return x;
}
static inline float pm_unit(pm_mod_t *m)  { return (pm_rng_next(m) >> 8) * (1.0f / 16777216.0f); }
static inline float pm_bip(pm_mod_t *m)   { return pm_unit(m) * 2.0f - 1.0f; }

static inline float pm_clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

/* FREE-mode LFO/random rate law, log-interpolated LUT from the Typhon system-ID
 * (echidna vendor/echidna/modulator.h): ~0.03..50 Hz, musical curve. */
static inline float pm_lfo_free_hz(float u) {
    static const float kU[13]   = {0.000f,0.126f,0.252f,0.329f,0.504f,0.630f,
                                   0.756f,0.819f,0.882f,0.929f,0.961f,0.992f,1.000f};
    static const float kLnHz[13]= {-3.4100f,-2.0350f,-0.6590f,0.1823f,0.6990f,
                                   1.1050f,1.5913f,1.8976f,2.2844f,2.6906f,3.0797f,3.6843f,3.9120f};
    int i = 0;
    if (u < 0.0f) u = 0.0f; else if (u > 1.0f) u = 1.0f;
    while (i < 12 && u > kU[i + 1]) i++;
    { float t = (u - kU[i]) / (kU[i + 1] - kU[i]);
      return expf(kLnHz[i] + t * (kLnHz[i + 1] - kLnHz[i])); }
}
/* rate01 -> Hz over a log range (BPM-sync beat multiplier). */
static inline float pm_rate_log(float r01, float lo, float hi) {
    return lo * powf(hi / lo, pm_clamp01(r01));
}

static inline void pm_mod_init(pm_mod_t *m, int idx, float fs) {
    (void)fs;
    memset(m, 0, sizeof(*m));
    m->mode = PM_MODE_LFO; m->sync = PM_SYNC_FREE; m->wave = 0;
    m->lfo_rate = 0.3f; m->lfo_fade = 0.5f;
    m->rnd_rate = 0.3f; m->rnd_lag = 0.2f; m->rnd_prob = 1.0f;
    m->env_a = 0.1f; m->env_dr = 0.4f; m->env_s = 0.5f;
    m->chaosAmp = 1.0f;
    m->rng = 0x1234567u + (uint32_t)idx * 0x9E3779B9u;
    m->rndTgt = pm_bip(m); m->rndCur = m->rndTgt;
}

/* Recompute per-block derived rates/coeffs from params + bpm + (previous) rate
 * cross-mod. Cheap enough to call once per block per mod. */
static inline void pm_mod_recompute(pm_mod_t *m, float bpm, float fs) {
    float rc = m->lfo_rate + m->rateOffs; rc = pm_clamp01(rc);
    float rr = m->rnd_rate + m->rateOffs; rr = pm_clamp01(rr);
    if (m->sync == PM_SYNC_BPM || m->sync == PM_SYNC_BPMKEY) {
        float beatHz = bpm / 60.0f;
        m->lfoFreq = beatHz * pm_rate_log(rc, 0.25f, 4.0f);
        m->rndFreq = beatHz * pm_rate_log(rr, 0.25f, 4.0f);
    } else {
        m->lfoFreq = pm_lfo_free_hz(rc);
        m->rndFreq = pm_lfo_free_hz(rr);
    }
    if (m->lfoFreq < 1e-6f) m->lfoFreq = 1e-6f;
    if (m->rndFreq < 1e-6f) m->rndFreq = 1e-6f;

    /* random lag slew: lag01=0 -> instant, =1 -> ~0.17 s time constant */
    { float lagSec = 0.167f * powf(m->rnd_lag, 1.6f);
      m->rndLagCoef = (lagSec < 1e-6f) ? 1.0f : (1.0f - expf(-1.0f / (lagSec * fs))); }

    /* LFO fade (bipolar, centered at 0.5): >0.5 fade-in, <0.5 fade-out, ~0 one-shot */
    { const float kDz = 0.04f, kInSec = 5.0f, kOutSec = 3.5f, kOneShot = 0.03f;
      if (m->lfo_fade > 0.5f + kDz) {
          m->fadeMode = 1;
          m->fadeSamples = ((m->lfo_fade - (0.5f + kDz)) / (0.5f - kDz)) * kInSec * fs;
      } else if (m->lfo_fade < 0.5f - kDz) {
          if (m->lfo_fade <= kOneShot) { m->fadeMode = 3; m->fadeSamples = 0.0f; }
          else { float amt = ((0.5f - kDz) - m->lfo_fade) / (0.5f - kDz);
                 m->fadeMode = 2; m->fadeSamples = (1.0f - amt) * kOutSec * fs; }
      } else { m->fadeMode = 0; m->fadeSamples = 0.0f; }
    }

    /* envelope time laws: attack 1ms..2s, decay/release 5ms..4s (log) */
    { float aSec = 0.001f * powf(2000.0f, pm_clamp01(m->env_a));
      float dSec = 0.005f * powf(800.0f,  pm_clamp01(m->env_dr));
      m->envAtkInc  = 1.0f / (aSec * fs);
      m->envDecCoef = 1.0f - expf(-1.0f / (dSec * fs));
      m->envRelCoef = m->envDecCoef; }
}

static inline float pm_lfo_shape(int wave, float ph, float chaosAmp) {
    switch (wave) {
        case 0: { float t = ph < 0.5f ? (ph * 4.0f - 1.0f) : (3.0f - ph * 4.0f); return t; } /* Triangle */
        case 1: return ph < 0.5f ? 1.0f : -1.0f;                                             /* Square */
        case 2: return ph < 0.25f ? 1.0f : -1.0f;                                            /* Pulse 25 */
        case 3: { float t = (ph < 0.5f ? (ph * 4.0f - 1.0f) : (3.0f - ph * 4.0f)) * 2.8f;    /* Trapezoid */
                  return t < -1.0f ? -1.0f : (t > 1.0f ? 1.0f : t); }
        case 4: return (ph * 2.0f - 1.0f) * chaosAmp;                                         /* Chaos saw */
        case 5: return 1.0f - 2.0f * ph;                                                      /* Saw down */
    }
    return 0.0f;
}

static inline float pm_fade_gain(pm_mod_t *m, float frames) {
    switch (m->fadeMode) {
        case 0: return 1.0f;
        case 1: if (m->fadeSamples < 1.0f || m->fadePos >= m->fadeSamples) return 1.0f;
                { float g = m->fadePos / m->fadeSamples; m->fadePos += frames; return g; }
        case 2: if (m->fadeSamples < 1.0f || m->fadePos >= m->fadeSamples) return 0.0f;
                { float g = 1.0f - m->fadePos / m->fadeSamples; m->fadePos += frames; return g; }
        case 3: return (m->fadeCycles >= 1.0f) ? 0.0f : 1.0f;   /* one-shot: first cycle only */
    }
    return 1.0f;
}

/* Advance a modulator by `frames` samples and store its output in m->value.
 * `gate` = envelope gate for this block (held_notes>0). Call after recompute. */
static inline void pm_mod_tick_block(pm_mod_t *m, int frames, float fs, int gate) {
    float ff = (float)frames;
    if (m->mode == PM_MODE_LFO) {
        m->value = pm_lfo_shape(m->wave, m->lfoPhase, m->chaosAmp) * pm_fade_gain(m, ff);
        m->lfoPhase += (m->lfoFreq / fs) * ff;
        while (m->lfoPhase >= 1.0f) {
            m->lfoPhase -= 1.0f;
            m->chaosAmp = pm_unit(m);
            m->fadeCycles += 1.0f;
        }
    } else if (m->mode == PM_MODE_RND) {
        m->rndPhase += (m->rndFreq / fs) * ff;
        while (m->rndPhase >= 1.0f) {
            m->rndPhase -= 1.0f;
            if (pm_unit(m) < m->rnd_prob) m->rndTgt = pm_bip(m);
        }
        /* block-rate one-pole slew toward target (coef scaled by frames) */
        { float c = m->rndLagCoef * ff; if (c > 1.0f) c = 1.0f;
          m->rndCur += c * (m->rndTgt - m->rndCur); }
        m->value = m->rndCur;
    } else { /* PM_MODE_ENV — note-gated A / D-R / S */
        if (gate && !m->gate_prev) { m->env_stage = 1; m->fadePos = 0.0f; }
        else if (!gate && m->gate_prev) { m->env_stage = 4; }
        m->gate_prev = gate;
        switch (m->env_stage) {
            case 1: m->env += m->envAtkInc * ff;
                    if (m->env >= 1.0f) { m->env = 1.0f; m->env_stage = 2; } break;
            case 2: { float c = m->envDecCoef * ff; if (c > 1.0f) c = 1.0f;
                      m->env += c * (m->env_s - m->env);
                      if (fabsf(m->env - m->env_s) < 0.001f) { m->env = m->env_s; m->env_stage = 3; } } break;
            case 3: m->env = m->env_s; break;
            case 4: { float c = m->envRelCoef * ff; if (c > 1.0f) c = 1.0f;
                      m->env += c * (0.0f - m->env);
                      if (m->env < 0.0005f) { m->env = 0.0f; m->env_stage = 0; } } break;
            default: m->env = 0.0f; break;
        }
        m->value = m->env;
    }
    if (m->value != m->value) m->value = 0.0f;   /* NaN guard (powf/expf edge) */
}

static inline void pm_mod_note_on(pm_mod_t *m) {
    if (m->sync == PM_SYNC_KEY || m->sync == PM_SYNC_BPMKEY) {
        m->lfoPhase = 0.0f; m->rndPhase = 0.0f;
        m->rndTgt = pm_bip(m); m->rndCur = m->rndTgt;
        m->chaosAmp = pm_unit(m);
    }
    m->fadePos = 0.0f; m->fadeCycles = 0.0f;   /* restart LFO fade on note-on */
}

static inline void pm_engine_init(pm_engine_t *e, float fs) {
    int k, d;
    for (k = 0; k < PM_NUM_MODS; k++) pm_mod_init(&e->mod[k], k, fs);
    for (k = 0; k < PM_NUM_MACROS; k++) e->macro[k] = 0.0f;
    for (k = 0; k < PM_NUM_SRC; k++) {
        e->destSel[k] = 0;
        for (d = 0; d < PM_NDEST; d++) e->depth[k][d] = 0.5f;
    }
    e->held_notes = 0;
    e->editor_bank = 0;
}

/* Human-readable destination label for enum options / menus. */
static inline void pm_dest_label(int d, char *buf, int len) {
    if (d <= 0 || d >= PM_NDEST) { snprintf(buf, (size_t)len, "None"); return; }
    if (d <= 12) {
        int s = (d - 1) / PM_DEST_PER_SLOT + 1;
        int par = (d - 1) % PM_DEST_PER_SLOT;
        const char *pn = par == 0 ? "Amount" : (par == 1 ? "Macro" : "Drift");
        snprintf(buf, (size_t)len, "FX%d %s", s, pn);
    } else if (d == PM_DEST_MIX) snprintf(buf, (size_t)len, "Mix");
    else if (d == PM_DEST_FB)    snprintf(buf, (size_t)len, "Feedback");
    else if (d == PM_DEST_IV)    snprintf(buf, (size_t)len, "Input Vol");
    else if (d < PM_DEST_LEVEL_BASE) snprintf(buf, (size_t)len, "Mod %d Rate",  d - PM_DEST_RATE_BASE + 1);
    else                             snprintf(buf, (size_t)len, "Mod %d Level", d - PM_DEST_LEVEL_BASE + 1);
}

/* JSON array of all dest labels (for chain_params enum options), quoted+comma'd. */
static inline int pm_dest_labels_json(char *buf, int len) {
    int off = 0, d; char lbl[32];
    for (d = 0; d < PM_NDEST; d++) {
        pm_dest_label(d, lbl, sizeof(lbl));
        off += snprintf(buf + off, (size_t)(len - off), "%s\"%s\"", d ? "," : "", lbl);
    }
    return off;
}

/* Resolve a dest given a set_param value: numeric index OR a label match. */
static inline int pm_dest_from_str(const char *v) {
    if (!v || !*v) return 0;
    if (v[0] >= '0' && v[0] <= '9') { int n = atoi(v); return (n >= 0 && n < PM_NDEST) ? n : 0; }
    { int d; char lbl[32];
      for (d = 0; d < PM_NDEST; d++) { pm_dest_label(d, lbl, sizeof(lbl)); if (!strcmp(lbl, v)) return d; } }
    return 0;
}

/* Resolve an enum value (index or label) against a name table. */
static inline int pm_enum_from_str(const char *v, const char *const *names, int n) {
    int i;
    if (!v || !*v) return 0;
    if (v[0] >= '0' && v[0] <= '9') { int k = atoi(v); return (k >= 0 && k < n) ? k : 0; }
    for (i = 0; i < n; i++) if (!strcmp(names[i], v)) return i;
    return 0;
}

#endif /* PALETTE_MOD_H */
