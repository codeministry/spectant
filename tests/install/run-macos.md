# Install check on macOS arm64 (ISC-11, T16)

A manual probe: the principal runs it and confirms in their own words. It proves that the install one-liner puts
`spectant` on PATH for a user who has never had it, and that `spectant --version` exits 0.

## Fresh HOME (the probe's minimum)

From the repository root, after `bun scripts/build.ts --host-only`:

```sh
H=$(mktemp -d)
env -i HOME="$H" USER=fresh PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  SPECTANT_RELEASE_URL="$PWD/dist" INSTALL_DIR="$H/.local/bin" sh < install.sh; echo "exit $?"
env -i HOME="$H" PATH="$H/.local/bin:/usr/bin:/bin" sh -c 'command -v spectant; spectant --version'; echo "exit $?"
```

Expected: the installer exits 0, names `darwin-arm64`, prints the PATH line for `$HOME/.local/bin`, and the second
command prints the binary's path and `spectant <version>` with exit 0. `SPECTANT_RELEASE_URL` points at the local
build until a GitHub release exists; `INSTALL_DIR` keeps the run out of a writable `/usr/local/bin`.

## Throwaway user (stronger, optional)

A new standard account (System Settings → Users & Groups), logged in once, running the published one-liner from the
README. Delete the account afterwards.

## Evidence

The transcript goes to `specs/001-app-skeleton/.evidence/` (gitignored), with the home directory and local paths
replaced by placeholders. No person, machine or path appears in anything tracked.
