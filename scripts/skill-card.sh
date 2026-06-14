#!/usr/bin/env bash
# scripts/skill-card.sh — bundle and push a skill card to OCI
set -euo pipefail

cmd="${1:?expected: bundle | push}"
skill_dir="${2:-.}"
cd "$skill_dir"

name=$(jq -r .name skill.json)
version=$(jq -r .version skill.json)
component=$(jq -r .component skill.json)

mkdir -p bundle
cp "$component" "bundle/$component"
cp skill.json bundle/skill.json

args=("$component:application/wasm" "skill.json:application/json")
while IFS=$'\t' read -r file mime; do
  mkdir -p "bundle/$(dirname "$file")"
  cp "$file" "bundle/$file"
  args+=("$file:$mime")
done < <(jq -r '.resources[] | [.file, .mimeType] | @tsv' skill.json)

if [[ "$cmd" == "bundle" ]]; then
  echo "Bundled $name@$version to $skill_dir/bundle"
  exit 0
fi

if [[ "$cmd" == "push" ]]; then
  registry="${OCI_REGISTRY:-ghcr.io/dillan}"
  cd bundle
  exec oras push "$registry/$name:$version" "${args[@]}"
fi

echo "unknown command: $cmd" >&2
exit 1