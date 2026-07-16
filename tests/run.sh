#!/bin/bash
# Off-device harness for the palette mod/macro engine + JSON getters + state
# round-trip + effect-select skip behaviour. Links palette.c + warps_data.c and
# stubs the Clouds heavy interface (SPACE/BLOOM not exercised). No Docker needed.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/.."
CC="${CC:-cc}"
"$CC" -std=c11 -O1 -ffast-math -I"$ROOT/src/dsp" -I"$ROOT/vendor" \
    -o "$DIR/pm_test" "$DIR/pm_test.c" "$ROOT/src/dsp/palette.c" "$ROOT/src/dsp/warps_data.c" -lm
"$DIR/pm_test"
