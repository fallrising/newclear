#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "usage: scripts/publish-study.sh --staging-checkout ABSOLUTE --bundle ABSOLUTE --expected-base SHA1 --expected-contract SHA256 --expected-bundle SHA256 [--dry-run|--publish]" >&2
  exit 64
}

staging_checkout=
bundle=
expected_base=
expected_contract=
expected_bundle=
mode=--dry-run
mode_seen=false
while (( $# )); do
  case "$1" in
    --staging-checkout|--bundle|--expected-base|--expected-contract|--expected-bundle)
      (( $# >= 2 )) || usage
      option=$1
      value=$2
      shift 2
      case "$option" in
        --staging-checkout) staging_checkout=$value ;;
        --bundle) bundle=$value ;;
        --expected-base) expected_base=$value ;;
        --expected-contract) expected_contract=$value ;;
        --expected-bundle) expected_bundle=$value ;;
      esac
      ;;
    --dry-run|--publish)
      [[ "$mode_seen" == false ]] || usage
      mode=$1
      mode_seen=true
      shift
      ;;
    *) usage ;;
  esac
done

[[ -n "$staging_checkout" && -n "$bundle" && -n "$expected_base" \
  && -n "$expected_contract" && -n "$expected_bundle" ]] || usage
[[ "$expected_base" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$expected_contract" =~ ^[0-9a-f]{64}$ ]] || usage
[[ "$expected_bundle" =~ ^[0-9a-f]{64}$ ]] || usage

operator_home=${HOME:-}
for candidate in "$staging_checkout" "$bundle"; do
  [[ "$candidate" == /* && "$candidate" != *$'\n'* ]] || usage
  [[ -d "$candidate" && ! -L "$candidate" ]] || {
    echo "publication path must be an existing ordinary directory" >&2
    exit 66
  }
  canonical=$(cd "$candidate" && pwd -P)
  [[ "$canonical" == "$candidate" ]] || {
    echo "publication path may not contain links or aliases" >&2
    exit 66
  }
  case "$candidate" in
    /|/home|/root|/tmp|/var|/usr|/opt|"$operator_home")
      echo "refusing a broad or home publication path" >&2
      exit 64
      ;;
  esac
done

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
publisher_pythonpath="$project_root/src"
arguments=(
  publish-github
  --staging-checkout "$staging_checkout"
  --bundle "$bundle"
  --expected-base "$expected_base"
  --expected-contract "$expected_contract"
  --expected-bundle "$expected_bundle"
  --config "$project_root/config/study-github-publication.json"
)

preview=$(PYTHONPATH="$publisher_pythonpath" /usr/bin/python3 -m ice_maker.study_cli "${arguments[@]}") || {
  echo "study publication preflight failed" >&2
  exit 2
}
printf '%s\n' "$preview"
if [[ "$mode" == --dry-run ]]; then
  exit 0
fi

echo "explicit publication requested; repository, base, branch, and exact paths are the dry-run record above" >&2
PYTHONPATH="$publisher_pythonpath" /usr/bin/python3 -m ice_maker.study_cli \
  "${arguments[@]}" --publish
