#!/bin/bash
set -u

json=0
if [[ "${1:-}" == "--json" ]]; then json=1; shift; fi
if (( $# )); then echo "usage: $0 [--json]" >&2; exit 2; fi

CPU_MIN=4
MEM_MIN=$((8 * 1024 * 1024 * 1024))
DISK_MIN=$((20 * 1024 * 1024 * 1024))

run0() { "${1}" "${@:2}" 2>/dev/null; }
read_obs() {
  local value="${!1:-}" file="${!2:-}"
  if [[ -n "$value" ]]; then printf '%s' "$value"; return 0; fi
  [[ -n "$file" && -r "$file" ]] || return 1
  IFS= read -r value < "$file" || true
  printf '%s' "$value"
}
read_memory_obs() {
  local value="${DOCTOR_AVAILABLE_MEMORY_BYTES:-}" file="${DOCTOR_MEMORY_FILE:-}" line kb
  if [[ -n "$value" ]]; then printf '%s' "$value"; return 0; fi
  [[ -n "$file" && -r "$file" ]] || return 1
  line="$(sed -n '1p' "$file" 2>/dev/null || true)"
  if [[ "$line" =~ ^[0-9]+$ ]]; then printf '%s' "$line"; return 0; fi
  line="$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\)[[:space:]]*kB.*/\1/p' "$file" | sed -n '1p')"
  [[ "$line" =~ ^[0-9]+$ ]] || return 1
  kb="$line"
  printf '%s' "$((kb * 1024))"
}
read_memory_obs_from_proc() {
  local line kb
  line="$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\)[[:space:]]*kB.*/\1/p' /proc/meminfo 2>/dev/null | sed -n '1p')"
  [[ "$line" =~ ^[0-9]+$ ]] || return 1
  kb="$line"
  printf '%s' "$((kb * 1024))"
}
uint() { [[ "$1" =~ ^[0-9]+$ ]]; }
json_bool() { (( $1 )) && printf true || printf false; }
json_num() { uint "${1:-}" && printf '%s' "$1" || printf null; }
resolve_cmd() {
  if [[ "$1" == */* ]]; then [[ -x "$1" ]] && printf '%s' "$1"; else command -v "$1" 2>/dev/null || true; fi
}
tool_status() {
  local var="$1" default="$2" cmd
  cmd="${!var:-$default}"
  cmd="$(resolve_cmd "$cmd")"
  [[ -n "$cmd" ]] && run0 "$cmd" --version >/dev/null
}

uname_cmd="${DOCTOR_UNAME_CMD:-uname}"
uname_cmd="$(resolve_cmd "$uname_cmd")"
os_name="$(run0 "$uname_cmd" -s || true)"
arch_name="$(run0 "$uname_cmd" -m || true)"
[[ "$os_name" == Linux ]] || os_name=unknown
[[ "$arch_name" == x86_64 ]] || arch_name=unknown
cpu="$(read_obs DOCTOR_CPU_COUNT DOCTOR_CPU_FILE || true)"
[[ -n "$cpu" ]] || cpu="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
mem="$(read_memory_obs || true)"
if [[ -z "$mem" && -r /proc/meminfo ]]; then
  mem="$(read_memory_obs_from_proc || true)"
fi
disk="$(read_obs DOCTOR_FREE_DISK_BYTES DOCTOR_DISK_FILE || true)"
if [[ -z "$disk" ]]; then
  disk="$(df -P -B1 "${DOCTOR_DATA_PATH:-.}" 2>/dev/null | awk 'NR==2 {print $4; exit}' || true)"
fi

python_cmd="${DOCTOR_PYTHON_CMD:-python3}"
python_cmd="$(resolve_cmd "$python_cmd")"
python_ok=0; python_version="unavailable"
if [[ -x "$python_cmd" ]]; then
  pv="$(run0 "$python_cmd" -c 'import sys; print("%d.%d" % sys.version_info[:2])' || true)"
  if [[ "$pv" =~ ^[0-9]+\.[0-9]+$ ]]; then python_version="$pv"; python_ok=1; fi
fi
version_ok=0
if (( python_ok )) && [[ ${pv%%.*} -gt 3 || ( ${pv%%.*} -eq 3 && ${pv##*.} -ge 11 ) ]]; then version_ok=1; fi

docker_cmd="${DOCTOR_DOCKER_CMD:-docker}"
docker_cmd="$(resolve_cmd "$docker_cmd")"
docker_ok=0; cgroups_ok=0; seccomp_ok=0; apparmor_ok=0; cgroup_version=""
if [[ -n "$docker_cmd" ]]; then
  if docker_info="$("$docker_cmd" info 2>/dev/null)"; then
    docker_ok=1
    if grep -Eiq '^[[:space:]]*Cgroup Version:[[:space:]]*[12]([[:space:]]*)?$' <<<"$docker_info"; then
      cgroup_version="$(sed -n 's/^[[:space:]]*Cgroup Version:[[:space:]]*\([12]\).*/\1/p' <<<"$docker_info" | sed -n '1p')"
    fi
    grep -Eiq 'cgroup(namespace)?|cgroup v[12]|cgroup (driver|limit)' <<<"$docker_info" && [[ -n "$cgroup_version" ]] && cgroups_ok=1
    grep -Eiq 'name=seccomp([,[:space:]]|$)|seccomp' <<<"$docker_info" && seccomp_ok=1
    grep -Eiq 'name=apparmor([,[:space:]]|$)|apparmor' <<<"$docker_info" && apparmor_ok=1
  fi
fi
security_ok=0; (( cgroups_ok && seccomp_ok && apparmor_ok )) && security_ok=1

pdfinfo_ok=0; pdftotext_ok=0; pdftoppm_ok=0; tesseract_ok=0
tool_status DOCTOR_PDFINFO_CMD pdfinfo && pdfinfo_ok=1
tool_status DOCTOR_PDFTOTEXT_CMD pdftotext && pdftotext_ok=1
tool_status DOCTOR_PDFTOPPM_CMD pdftoppm && pdftoppm_ok=1
tool_status DOCTOR_TESSERACT_CMD tesseract && tesseract_ok=1
required_languages="${DOCTOR_OCR_LANGUAGES:-eng,chi_tra}"
required_langs=(); configured_langs=(); observed_langs=(); langs_ok=0; language_config_ok=1
IFS=',' read -ra configured_langs <<< "$required_languages"
(( ${#configured_langs[@]} > 0 )) || language_config_ok=0
for lang in "${configured_langs[@]}"; do
  if [[ "$lang" =~ ^[[:alnum:]_+.-]+$ ]]; then required_langs+=("$lang"); else language_config_ok=0; fi
done
(( ${#required_langs[@]} == ${#configured_langs[@]} )) || language_config_ok=0
if (( tesseract_ok )); then
  tess_cmd="${DOCTOR_TESSERACT_CMD:-tesseract}"
  tess_cmd="$(resolve_cmd "$tess_cmd")"
  while IFS= read -r lang; do [[ "$lang" =~ ^[[:alnum:]_+.-]+$ ]] && observed_langs+=("$lang"); done < <(run0 "$tess_cmd" --list-langs || true)
  langs_ok=1
  (( language_config_ok )) || langs_ok=0
  for required in "${required_langs[@]}"; do
    found=0; for observed in "${observed_langs[@]}"; do [[ "$required" == "$observed" ]] && found=1; done
    (( found )) || langs_ok=0
  done
fi
pkg_ok=0
if (( version_ok )); then run0 "$python_cmd" -c 'import PIL, fastapi, uvicorn, multipart' >/dev/null && pkg_ok=1; fi
gpu=0; gpu_cmd="${DOCTOR_GPU_CMD:-nvidia-smi}"
gpu_cmd="$(resolve_cmd "$gpu_cmd")"
[[ -n "$gpu_cmd" ]] && run0 "$gpu_cmd" >/dev/null && gpu=1

capacity=0
if [[ "$os_name" == Linux && "$arch_name" == x86_64 ]] && uint "$cpu" && uint "$mem" && uint "$disk" \
  && (( cpu >= CPU_MIN && mem >= MEM_MIN && disk >= DISK_MIN )); then capacity=1; fi
host=0; (( capacity && docker_ok && security_ok )) && host=1
runtime=0
(( host && version_ok && pdfinfo_ok && pdftotext_ok && pdftoppm_ok && tesseract_ok && langs_ok && pkg_ok )) && runtime=1
classification=unsupported; exit_code=2
if (( host )); then classification=host-capable; exit_code=1; fi
if (( runtime )); then classification=runtime-ready; exit_code=0; fi

json_array() { local first=1 value; printf '['; for value in "$@"; do (( first )) || printf ','; printf '"%s"' "$value"; first=0; done; printf ']'; }
if (( json )); then
  printf '{"schema_version":1,"classification":"%s","host":{"os":"%s","architecture":"%s","cpus":%s,"available_memory_bytes":%s,"free_disk_bytes":%s},"python":{"version":"%s","meets_minimum":%s},"docker":{"reachable":%s,"cgroup_version":%s,"security_features":{"cgroups":%s,"seccomp":%s,"apparmor":%s}},"tools":{"pdfinfo":%s,"pdftotext":%s,"pdftoppm":%s,"tesseract":%s},"ocr":{"required_languages":%s,"observed_languages":%s,"languages_available":%s},"gpu":{"available":%s},"runtime_dependencies":{"available":%s}}\n' \
    "$classification" "$os_name" "$arch_name" "$(json_num "$cpu")" "$(json_num "$mem")" "$(json_num "$disk")" "$python_version" "$(json_bool "$version_ok")" "$(json_bool "$docker_ok")" "$( [[ "$cgroup_version" =~ ^[12]$ ]] && printf '"%s"' "$cgroup_version" || printf null )" "$(json_bool "$cgroups_ok")" "$(json_bool "$seccomp_ok")" "$(json_bool "$apparmor_ok")" "$(json_bool "$pdfinfo_ok")" "$(json_bool "$pdftotext_ok")" "$(json_bool "$pdftoppm_ok")" "$(json_bool "$tesseract_ok")" "$(json_array "${required_langs[@]}")" "$(json_array "${observed_langs[@]}")" "$(json_bool "$langs_ok")" "$(json_bool "$gpu")" "$(json_bool "$pkg_ok")"
else
  printf 'document-ingestion doctor\nclassification: %s\n' "$classification"
  printf 'host: %s %s, %s CPUs, %s available RAM, %s free disk\n' "$os_name" "$arch_name" "${cpu:-unknown}" "${mem:-unknown} bytes" "${disk:-unknown} bytes"
  printf 'docker: reachable=%s cgroups=%s seccomp=%s apparmor=%s; python=%s; parser/OCR=%s/%s/%s/%s; OCR languages=%s; GPU=%s; Python runtime dependencies=%s\n' "$docker_ok" "$cgroups_ok" "$seccomp_ok" "$apparmor_ok" "$python_version" "$pdfinfo_ok" "$pdftotext_ok" "$pdftoppm_ok" "$tesseract_ok" "$langs_ok" "$gpu" "$pkg_ok"
fi
exit "$exit_code"
