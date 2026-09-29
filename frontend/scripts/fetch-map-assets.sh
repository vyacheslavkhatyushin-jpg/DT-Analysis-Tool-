#!/usr/bin/env bash
# Downloads map fonts (glyph PBFs) and sprites into public/map-assets so the map works offline.
# The result is committed to the repository; rerun only to change fonts, ranges or sprites.
# Source: https://github.com/protomaps/basemaps-assets (fonts: Noto, SIL Open Font License).
set -euo pipefail

BASE="https://raw.githubusercontent.com/protomaps/basemaps-assets/main"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/map-assets"
FONTS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic")
# Basic Latin + Latin-1, Latin Extended, Cyrillic, general punctuation (dashes, quotes, №).
RANGES=("0-255" "256-511" "1024-1279" "8192-8447" "8448-8703")
SPRITES=("light.json" "light.png" "light@2x.json" "light@2x.png")

for font in "${FONTS[@]}"; do
  mkdir -p "$OUT/fonts/$font"
  for range in "${RANGES[@]}"; do
    curl -fsSL -o "$OUT/fonts/$font/$range.pbf" "$BASE/fonts/${font// /%20}/$range.pbf"
  done
done

mkdir -p "$OUT/sprites"
for sprite in "${SPRITES[@]}"; do
  curl -fsSL -o "$OUT/sprites/$sprite" "$BASE/sprites/v4/$sprite"
done

echo "Map assets saved to $OUT"
