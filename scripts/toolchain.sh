#!/usr/bin/env bash
# Containerised toolchain. Node is not installed on the host: every tool runs
# in a pinned image with the repo bind-mounted at /src.
#
#   ./scripts/toolchain.sh npm ci
#   ./scripts/toolchain.sh npm test
#   ./scripts/toolchain.sh npx tsc --noEmit
#   ./scripts/toolchain.sh shell
#
# node_modules and the npm cache live in named volumes, so installs neither
# cross the host bind mount nor leave Linux binaries in the checkout.
set -euo pipefail

NODE_IMAGE="${NODE_IMAGE:-node:22-bookworm}"
# Native binaries (esbuild, rollup) are per image: key the modules volume on it.
MODULES_VOL="${MODULES_VOL:-awesome-react-auth-nm-${NODE_IMAGE//[^a-zA-Z0-9.]/-}}"
CACHE_VOL="${CACHE_VOL:-awesome-react-auth-npm-cache}"

# Resolve the repo root from this script's location. Quoting matters: the parent
# workspace directory contains a literal ${lang} that must never be expanded.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
[ -f "${REPO_ROOT}/package.json" ] || { echo "no package.json in ${REPO_ROOT}" >&2; exit 2; }

run_in_node_image() {
  docker run --rm \
    -v "${REPO_ROOT}":/src \
    -v "${MODULES_VOL}":/src/node_modules \
    -v "${CACHE_VOL}":/root/.npm \
    -w /src \
    -e CI \
    "$@"
}

case "${1:-}" in
  npm|npx|node|bash)
    run_in_node_image "${NODE_IMAGE}" "$@"
    ;;
  shell)
    run_in_node_image -it "${NODE_IMAGE}" bash
    ;;
  *)
    echo "usage: $0 {npm|npx|node|bash <args...>|shell}" >&2
    exit 2
    ;;
esac
