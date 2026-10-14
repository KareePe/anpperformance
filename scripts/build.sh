#!/usr/bin/env bash
# Builds dist/ — only the files the live site needs — for Cloudflare Pages.
# Cloudflare Pages: Build command `bash scripts/build.sh`, Build output directory `dist`.
# (functions/ stays at the project root; Pages picks it up from there.)
#
# Left out on purpose: api/ (PHP is not executed on Pages — it would be served as plain text),
# design/working folders, and hero videos the page does not reference (e.g. the 4K originals).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=dist
MAX_BYTES=$((25 * 1024 * 1024)) # Pages limit per file: 25 MiB

rm -rf "$OUT"
mkdir -p "$OUT"

for f in index.html 404.html robots.txt sitemap.xml llms.txt site.webmanifest _headers; do
  [ -f "$f" ] && cp "$f" "$OUT/"
done
cp -R assets "$OUT/assets"

# keep only the videos index.html actually uses
find "$OUT/assets/vdo" -name '*.mp4' | while read -r v; do
  rel=${v#"$OUT/"}
  grep -qF "$rel" index.html || rm "$v"
done

# fail early instead of letting the Pages upload fail
too_big=$(find "$OUT" -type f -size +"$MAX_BYTES"c)
if [ -n "$too_big" ]; then
  echo "ERROR: files over 25 MiB (Cloudflare Pages limit):" >&2
  echo "$too_big" >&2
  exit 1
fi

echo "dist/ ready: $(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1)"
