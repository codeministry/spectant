# Spectant

**The local spec companion for developers.** Spectant is a single binary for macOS and Linux that reads the Markdown
specs in the repositories you register and shows them side by side on one dashboard in your browser, or in a
terminal's web panel. It shows where every spec stands, what comes next and what needs attention, updates in place
when a file changes, and works from the keyboard. It never writes into your repositories and nothing leaves your
machine.

> **Status:** pre-release, spec 001 in progress. Nothing below is released yet.

## Install

```sh
curl -fsSL https://github.com/<org>/spectant/releases/latest/download/install.sh | sh
```

The script picks the binary for your OS and architecture. Set `INSTALL_DIR` to choose where it goes; it never edits
your shell configuration.

## Usage

```sh
spectant add <repo>      # register a repository
spectant list            # show registered repositories
spectant remove <repo>   # unregister one
spectant                 # start the dashboard and open it in the browser
```

`spectant` listens on `127.0.0.1:7717` (or the next free port) and prints the URL. Pass `--no-browser` to skip
opening a browser, `--port N` to choose the port.

## How it works

- Spectant reads the Markdown specs (`specs/`) of each registered repository. The files are the only source of truth.
- It keeps only a workspace registry and your settings in SQLite, in `$XDG_DATA_HOME/spectant` or `~/.spectant/`.
  Deleting that directory loses nothing a repository says.
- The server listens on loopback only; the web UI, fonts and icons are embedded in the binary.
- A Claude Code plugin that shares the same spec parser ships later.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run verify
```

Contributor and agent working notes live in `CLAUDE.md`; the rules specs are held to live in `specs/constitution.md`.

## License

Apache-2.0. See `LICENSE`; third-party notices are in `THIRD_PARTY_NOTICES.md`.

## Acknowledgements

The ISA spec format descends from [danielmiessler/LifeOS](https://github.com/danielmiessler/LifeOS) (MIT).
