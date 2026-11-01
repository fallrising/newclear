#!/bin/sh
# Preparation template: explicit reviewed environment is still a host-admission gate.
set -eu
umask 077
fail() { echo "signalhub launch refused: $1" >&2; exit 1; }
[ "$#" -eq 0 ] || fail 'arguments unsupported'
uid=$(/usr/bin/id -u)
[ "$uid" -ne 0 ] || fail 'non-root execution required'
service_uid=${SIGNALHUB_SERVICE_UID-}
case "$service_uid" in ''|*[!0-9]*|0|0*) fail 'explicit non-root service UID required' ;; esac
[ "$uid" = "$service_uid" ] || fail 'service UID mismatch'
port=${PORT-}
case "$port" in ''|*[!0-9]*|0*) fail 'invalid PORT' ;; esac
[ "${#port}" -le 5 ] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || fail 'invalid PORT'
absolute() {
  case "$1" in /*) ;; *) fail 'absolute path required' ;; esac
  case "$1" in /|*/../*|*/..|*/./*|*/.|*//*|*/) fail 'normalized path required' ;; esac
  ancestor=$1
  while [ "$ancestor" != / ]; do
    [ ! -L "$ancestor" ] || fail 'symlink path unsupported'
    ancestor=${ancestor%/*}
    [ -n "$ancestor" ] || ancestor=/
  done
}
binary=${SIGNALHUB_BINARY-}
config=${SIGNALHUB_CONFIG-}
db=${SIGNALHUB_DB-}
owner=${SIGNALHUB_OWNER_TOKEN_REF-}
readonly=${SIGNALHUB_READONLY_TOKEN_REF-}
absolute "$binary"; absolute "$config"; absolute "$db"
[ -f "$binary" ] && [ -x "$binary" ] || fail 'binary missing or not executable'
[ -f "$config" ] && [ -r "$config" ] || fail 'config missing or unreadable'
case "$owner" in file:/*) owner_path=${owner#file:} ;; *) fail 'owner file reference required' ;; esac
absolute "$owner_path"
[ -f "$owner_path" ] && [ -r "$owner_path" ] || fail 'owner file missing or unreadable'
parent=${db%/*}
[ -d "$parent" ] && [ -w "$parent" ] || fail 'DB parent missing or unwritable'
[ ! -L "$db" ] || fail 'DB symlink unsupported'
if [ -e "$db" ]; then [ -f "$db" ] && [ -w "$db" ] || fail 'DB not writable regular file'; fi
set -- "$binary" -config "$config" -db "$db" -owner-token-ref "$owner" -listen "127.0.0.1:$port"
if [ -n "$readonly" ]; then
  case "$readonly" in file:/*) readonly_path=${readonly#file:} ;; *) fail 'readonly file reference required' ;; esac
  absolute "$readonly_path"
  [ "$readonly" != "$owner" ] || fail 'distinct credential references required'
  [ -f "$readonly_path" ] && [ -r "$readonly_path" ] || fail 'readonly file missing or unreadable'
  set -- "$@" -readonly-token-ref "$readonly"
fi
exec "$@"
