#!/bin/sh
# spectant installer: puts the `spectant` binary for this machine on disk and tells you how to reach it.
#
#   curl -fsSL https://github.com/<org>/spectant/releases/latest/download/install.sh | sh
#
# Environment:
#   SPECTANT_RELEASE_URL  where the release binaries live: an https:// base URL, a file:// URL or a local directory
#                         (default: the latest GitHub release, or the SPECTANT_VERSION release when that is set)
#   SPECTANT_VERSION      pin a version, e.g. 0.1.0; the installed binary must report it
#   INSTALL_DIR           where to put the binary (default: /usr/local/bin when writable, else ~/.local/bin)
#
# The script never uses sudo and never edits a shell rc file; when the install directory is not on PATH it prints
# the line to add. Exit codes: 0 installed, 1 download or verification failed, 2 unsupported platform.
set -eu

DEFAULT_RELEASE_URL="https://github.com/<org>/spectant/releases/latest/download"
PINNED_RELEASE_URL="https://github.com/<org>/spectant/releases/download"

say() { printf '%s\n' "$*"; }
fail() { printf 'spectant install: %s\n' "$1" >&2; exit "${2:-1}"; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    *) fail "unsupported operating system $(uname -s); spectant runs on macOS and Linux" 2 ;;
  esac
}

detect_arch() {
  arch=$(uname -m)
  # A shell running under Rosetta reports x86_64 on Apple silicon; the native arm64 binary is the right one.
  if [ "$1" = darwin ] && [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  case "$arch" in
    arm64 | aarch64) echo arm64 ;;
    x86_64 | amd64) echo x64 ;;
    *) fail "unsupported architecture $arch; spectant ships arm64 and x64 builds" 2 ;;
  esac
}

# Copies or downloads $1 (a URL or local path) to the file $2.
fetch() {
  case "$1" in
    file://*) cp "${1#file://}" "$2" ;;
    http://* | https://*)
      if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$1" -o "$2"
      elif command -v wget >/dev/null 2>&1; then
        wget -qO- "$1" >"$2"
      else
        fail "neither curl nor wget is installed"
      fi
      ;;
    *) cp "$1" "$2" ;;
  esac
}

pick_install_dir() {
  if [ -n "${INSTALL_DIR:-}" ]; then
    mkdir -p "$INSTALL_DIR" 2>/dev/null || fail "cannot create INSTALL_DIR $INSTALL_DIR"
    [ -w "$INSTALL_DIR" ] || fail "INSTALL_DIR $INSTALL_DIR is not writable (this script never uses sudo)"
    echo "$INSTALL_DIR"
  elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    echo /usr/local/bin
  else
    [ -n "${HOME:-}" ] || fail "HOME is not set; set INSTALL_DIR instead"
    mkdir -p "$HOME/.local/bin" || fail "cannot create $HOME/.local/bin"
    echo "$HOME/.local/bin"
  fi
}

# Prints how to put $1 on PATH for the user's shell. Never writes the rc file itself.
path_hint() {
  if [ -n "${HOME:-}" ] && [ "$1" = "$HOME/.local/bin" ]; then
    shown='$HOME/.local/bin'
  else
    shown=$1
  fi
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc='~/.zshrc' ;;
    bash) if [ "$(uname -s)" = Darwin ]; then rc='~/.bash_profile'; else rc='~/.bashrc'; fi ;;
    fish)
      say ""
      say "$1 is not on your PATH. Run this once in fish:"
      say ""
      say "  fish_add_path $shown"
      return
      ;;
    *) rc='~/.profile' ;;
  esac
  say ""
  say "$1 is not on your PATH. Add this line to $rc, then open a new terminal:"
  say ""
  say "  export PATH=\"$shown:\$PATH\""
}

main() {
  os=$(detect_os)
  arch=$(detect_arch "$os")
  asset="spectant-$os-$arch"
  version=${SPECTANT_VERSION:-}
  version=${version#v}

  if [ -n "${SPECTANT_RELEASE_URL:-}" ]; then
    base=$SPECTANT_RELEASE_URL
  elif [ -n "$version" ]; then
    base="$PINNED_RELEASE_URL/v$version"
  else
    base=$DEFAULT_RELEASE_URL
  fi
  base=${base%/}

  dir=$(pick_install_dir)
  target="$dir/spectant"
  # Staged next to the target, so the final move is a rename on one filesystem and a failed download or a broken
  # binary never replaces a working install.
  staged=$(mktemp "$dir/.spectant.XXXXXX") || fail "cannot write to $dir"
  trap 'rm -f "$staged"' EXIT
  trap 'rm -f "$staged"; exit 1' HUP INT TERM

  say "Installing spectant ($os-$arch) from $base"
  fetch "$base/$asset" "$staged" || fail "could not fetch $base/$asset"
  [ -s "$staged" ] || fail "$base/$asset is empty"
  chmod 755 "$staged"
  reported=$("$staged" --version 2>&1) || fail "the downloaded binary does not run: $reported"
  if [ -n "$version" ] && [ "$reported" != "spectant $version" ]; then
    fail "expected spectant $version, the binary reports '$reported'"
  fi
  mv -f "$staged" "$target"
  trap - EXIT HUP INT TERM

  reported=$("$target" --version 2>&1) || fail "$target does not run: $reported"
  say "Installed $reported to $target"

  case ":${PATH:-}:" in
    *":$dir:"*)
      found=$(command -v spectant 2>/dev/null || true)
      if [ -n "$found" ] && [ "$found" != "$target" ]; then
        say ""
        say "Note: $found comes first on your PATH and shadows $target."
      fi
      ;;
    *) path_hint "$dir" ;;
  esac

  say ""
  say "Next:"
  say "  spectant add <repo>   register a repository with specs"
  say "  spectant              open the dashboard"
}

main "$@"
