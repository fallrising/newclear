#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
legacy_token="$(printf '%s%s' 'dd' 'mq')"
status=0

cd "$root"

if content_matches="$(git grep --untracked -I -n -i "$legacy_token" -- .)"; then
  count="$(wc -l <<<"$content_matches" | tr -d ' ')"
  echo "Found $count legacy namespace references in tracked content:" >&2
  sed -n '1,40p' <<<"$content_matches" >&2
  if (( count > 40 )); then
    echo "... and $((count - 40)) more" >&2
  fi
  status=1
fi

path_matches="$(
  while IFS= read -r path; do
    if [[ -e "$path" ]] && grep -qi "$legacy_token" <<<"$path"; then
      echo "$path"
    fi
  done < <(git ls-files --cached --others --exclude-standard)
)"
if [[ -n "$path_matches" ]]; then
  count="$(wc -l <<<"$path_matches" | tr -d ' ')"
  echo "Found $count tracked paths using the legacy namespace:" >&2
  sed -n '1,40p' <<<"$path_matches" >&2
  if (( count > 40 )); then
    echo "... and $((count - 40)) more" >&2
  fi
  status=1
fi

if (( status != 0 )); then
  exit "$status"
fi

echo "validated OJBK namespace"
