#!/usr/bin/env bash
# Regenerate every app icon and splash screen from resources/brand/*.svg.
# Requires ImageMagick 7 (`magick`). Run from the repository root:
#   bash scripts/generate-icons.sh
set -euo pipefail

FOREST="#164b3c"
PAPER_DARK="#171c19"
MARK=resources/brand/mark.svg
BARS=resources/brand/bars.svg
RES=android/app/src/main/res

render() { # svg size out [background]
  magick -background "${4:-none}" -density 1200 "$1" -resize "${2}x${2}" "$3"
}

# ── Web / PWA ─────────────────────────────────────────────
cp "$MARK" public/favicon.svg
render "$MARK" 192 public/pwa-192x192.png
render "$MARK" 512 public/pwa-512x512.png
render "$BARS" 512 public/pwa-maskable-512x512.png "$FOREST"
# iOS ignores transparency and rounds corners itself: full-bleed tile.
render "$BARS" 180 public/apple-touch-icon-180x180.png "$FOREST"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for s in 16 32 48; do render "$MARK" "$s" "$tmp/fav-$s.png"; done
magick "$tmp/fav-16.png" "$tmp/fav-32.png" "$tmp/fav-48.png" public/favicon.ico

# ── Android launcher (legacy + adaptive) ──────────────────
# Portable across Bash 3.2 (stock macOS): no associative arrays.
for entry in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${entry%%:*}; s=${entry#*:}
  render "$MARK" "$s" "$RES/mipmap-$d/ic_launcher.png"
  render "$BARS" "$s" "$tmp/round.png" "$FOREST"
  magick "$tmp/round.png" \( -size "${s}x${s}" xc:none -fill white -draw "circle $((s/2)),$((s/2)) $((s/2)),0" \) \
    -compose CopyOpacity -composite "$RES/mipmap-$d/ic_launcher_round.png"
  render "$BARS" $((s * 9 / 4)) "$RES/mipmap-$d/ic_launcher_foreground.png"
done
# Write to a temp file and move it back: `sed -i` differs between GNU and BSD.
bg_xml="$RES/values/ic_launcher_background.xml"
sed "s|<color name=\"ic_launcher_background\">[^<]*</color>|<color name=\"ic_launcher_background\">${FOREST}</color>|" \
  "$bg_xml" > "$tmp/ic_launcher_background.xml"
mv "$tmp/ic_launcher_background.xml" "$bg_xml"

# ── Android splash screens ────────────────────────────────
for f in "$RES"/drawable*/splash.png; do
  dims=$(magick identify -format "%w %h" "$f")
  w=${dims% *}; h=${dims#* }
  min=$(( w < h ? w : h ))
  tile=$(( min * 2 / 5 ))
  render "$MARK" "$tile" "$tmp/tile.png"
  magick -size "${w}x${h}" "xc:${PAPER_DARK}" "$tmp/tile.png" -gravity center -composite "$f"
done

echo "Icons regenerated."
