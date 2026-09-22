#!/usr/bin/env bash
#
# Regenerates mk-geo.json, the OpenStreetMap snapshot the Magic Kingdom shade map
# reads. The page uses this committed file so it never depends on Overpass at
# request time: public Overpass instances rate limit shared cloud IPs, which took
# the map down once already.
#
# Park geometry changes rarely, so run this by hand when the data looks stale —
# it is deliberately not part of any build.
#
#   ./scripts/refresh-mk-geo.sh                      # via the deployed endpoint
#   ./scripts/refresh-mk-geo.sh https://<preview>/api/mk-geo
#
# The endpoint queries Overpass and normalizes the result, so its output is
# already in the exact shape the page expects.

set -euo pipefail

SOURCE="${1:-https://bstef.pages.dev/api/mk-geo}"
OUTPUT="mk-geo.json"
TEMP="${OUTPUT}.tmp"

cleanup() { rm -f "$TEMP"; }
trap cleanup EXIT

echo "Fetching $SOURCE"
if ! curl -fsS --max-time 120 "$SOURCE" -o "$TEMP"; then
  echo "Fetch failed. Overpass is likely rate limiting or down; try again shortly." >&2
  exit 1
fi

# Refuse to overwrite a good snapshot with an error body or an empty result.
node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.error) {
  console.error("Endpoint returned an error: " + data.error);
  process.exit(1);
}
const buildings = (data.buildings || []).length;
const attractions = (data.attractions || []).length;
if (buildings === 0) {
  console.error("Refusing to write a snapshot with no buildings.");
  process.exit(1);
}
const withHeight = (data.buildings || []).filter((b) => b.height).length;
console.log(`${buildings} buildings (${withHeight} with mapped heights), ${attractions} attractions`);
' "$TEMP"

mv "$TEMP" "$OUTPUT"
echo "Wrote $OUTPUT — commit it to publish the refreshed snapshot."
