#!/usr/bin/env bun
/**
 * test:install:linux — runs `install.sh` on a clean Ubuntu machine as a non-root user (T14, ISC-10; plan 001
 * § Affected Files, § Risks).
 *
 * Usage: bun tests/install/run.ts                         (default install dir, `~/.local/bin` for a non-root user)
 *        bun tests/install/run.ts -- INSTALL_DIR=<path>   (passes INSTALL_DIR to the installer; T15, ISC-12)
 *
 * Steps:
 *  1. makes sure `dist/spectant-linux-<arch>` exists, building it with `scripts/build.ts` when it does not;
 *  2. probes `linux/amd64` emulation and falls back to `linux/arm64` with a loud notice when it is missing;
 *  3. builds `tests/install/Dockerfile` (Ubuntu, curl, a user `tester`, no bun, no node) for that platform;
 *  4. runs the container with the release binaries and `install.sh` bind-mounted read-only under `/release`, and
 *     inside it: pipes the script into `sh` the way the one-liner does, with `SPECTANT_RELEASE_URL=file:///release`,
 *     checks where the binary landed (and that no copy landed anywhere else), that the PATH hint names that
 *     directory, applies the printed PATH line in a clean environment and runs `spectant --version`, checks that no
 *     shell rc file changed, then starts `spectant --port 0` and asks for `/`, one `main-*.js` and the deep link
 *     `/w/x`. Without INSTALL_DIR it also proves the fallback: a write into `/usr/local/bin` is refused, so the
 *     binary must be in `~/.local/bin`. With INSTALL_DIR it checks the directory did not exist before, so the
 *     installer created it (the image gives `tester` a writable `/opt/x` for the probe path `/opt/x/bin`);
 *  5. prints a table of the checks and exits 1 with the container output on any failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const BUILD_TIMEOUT_MS = 5 * 60_000;
const RUN_TIMEOUT_MS = 2 * 60_000;
const PROBE_TIMEOUT_MS = 2 * 60_000;
const BASE_IMAGE = "ubuntu:24.04";

type Platform = { docker: "linux/amd64" | "linux/arm64"; target: "linux-x64" | "linux-arm64" };
type Result = { code: number; out: string; timedOut: boolean };
type Check = { name: string; ok: boolean; detail: string };

class RunError extends Error {
  constructor(
    message: string,
    readonly output = "",
  ) {
    super(message);
  }
}

/** Runs a command from the repository root, capturing stdout and stderr together; kills it after `timeoutMs`. */
async function exec(cmd: string[], timeoutMs: number, onTimeout?: () => void): Promise<Result> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    onTimeout?.();
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, out: stdout + stderr, timedOut };
}

/** Runs a command with inherited output (the build prints its own progress); throws on a non-zero exit. */
async function execLoud(cmd: string[], what: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit", stdin: "ignore" });
  const code = await proc.exited;
  if (code !== 0) throw new RunError(`${what} failed (exit ${code}): ${cmd.join(" ")}`);
}

function parseArgs(argv: string[]): { installDir: string | undefined } {
  let installDir: string | undefined;
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg.startsWith("INSTALL_DIR=")) {
      installDir = arg.slice("INSTALL_DIR=".length);
      if (!installDir.startsWith("/")) throw new RunError(`INSTALL_DIR must be an absolute path, got ${JSON.stringify(installDir)}`);
    } else {
      throw new RunError(`unknown argument ${arg}; usage: bun tests/install/run.ts [-- INSTALL_DIR=<path>]`);
    }
  }
  return { installDir };
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new RunError("package.json has no version string");
  return pkg.version;
}

/** Picks the container platform: x64 under emulation when it works, arm64 otherwise (with a loud notice). */
async function pickPlatform(): Promise<Platform> {
  const docker = await exec(["docker", "version", "--format", "{{.Server.Version}}"], 30_000);
  if (docker.code !== 0) throw new RunError("docker is not available (`docker version` failed)", docker.out);
  const probe = await exec(
    ["docker", "run", "--rm", "--platform", "linux/amd64", BASE_IMAGE, "uname", "-m"],
    PROBE_TIMEOUT_MS,
  );
  if (probe.code === 0 && probe.out.trim().split("\n").at(-1) === "x86_64") {
    return { docker: "linux/amd64", target: "linux-x64" };
  }
  console.error(
    [
      "",
      "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
      "!! NOTICE: linux/amd64 emulation is unavailable here; falling back to linux/arm64.",
      "!! The x64 binary and install path were NOT exercised. ISC-10 names x64; rerun on a host",
      "!! with amd64 emulation (Docker Desktop, or binfmt/QEMU) or a native x64 machine.",
      "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
      "",
    ].join("\n"),
  );
  return { docker: "linux/arm64", target: "linux-arm64" };
}

async function ensureBinary(target: Platform["target"]): Promise<string> {
  const binary = `dist/spectant-${target}`;
  if (existsSync(join(ROOT, binary))) {
    console.log(`reusing ${binary} (run \`bun run build\` first to test a fresh build)`);
    return binary;
  }
  // build.ts runs the web build itself unless told to reuse an existing one.
  const skipWeb = existsSync(join(ROOT, "web", "dist", "browser", "index.html")) ? ["--skip-web"] : [];
  console.log(`${binary} is missing; building it`);
  await execLoud([process.execPath, "scripts/build.ts", ...skipWeb, "--targets", target], "build");
  if (!existsSync(join(ROOT, binary))) throw new RunError(`the build reported success but wrote no ${binary}`);
  return binary;
}

/**
 * The checks inside the container, as the non-root user `tester`. POSIX sh on purpose: the image has no bun. Every
 * check prints one `CHECK|<name>|ok|fail|<detail>` line; the exit code is 1 when any check failed.
 */
const IN_CONTAINER = String.raw`
set -u
failed=0
check() {
  printf 'CHECK|%s|%s|%s\n' "$1" "$2" "$3"
  if [ "$2" != ok ]; then failed=1; fi
}
verdict() { if [ "$1" = 0 ]; then echo ok; else echo fail; fi; }

clean_path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
override=${"${INSTALL_DIR:-}"}
expect_dir=${"${INSTALL_DIR:-$HOME/.local/bin}"}
# The installer shortens the default fallback to a literal $HOME/.local/bin in the PATH line; an override is shown as is.
if [ -n "$override" ]; then shown_dir=$override; else shown_dir='$HOME/.local/bin'; fi
rc_state() {
  for f in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.zshrc" \
           "$HOME/.zprofile" "$HOME/.config/fish/config.fish"; do
    if [ -e "$f" ]; then sha256sum "$f"; else echo "absent $f"; fi
  done | sha256sum
}

if [ "$(id -u)" != 0 ]; then check "runs as non-root" ok "$(id -un)"; else check "runs as non-root" fail "uid 0"; fi
# The precondition of the ~/.local/bin fallback, proven by an actual write attempt and not only by the -w test the
# installer itself uses.
if [ -w /usr/local/bin ]; then
  check "/usr/local/bin not writable" fail "-w says writable"
elif touch /usr/local/bin/.spectant-write-probe 2>/dev/null; then
  rm -f /usr/local/bin/.spectant-write-probe
  check "/usr/local/bin not writable" fail "a write succeeded"
else
  check "/usr/local/bin not writable" ok "root-owned, write refused"
fi
if [ -n "$override" ]; then
  if [ -e "$override" ]; then
    check "INSTALL_DIR absent before" fail "$override already exists"
  else
    check "INSTALL_DIR absent before" ok "$override does not exist yet"
  fi
fi
if command -v spectant >/dev/null 2>&1 || command -v bun >/dev/null 2>&1 || command -v node >/dev/null 2>&1; then
  check "clean machine" fail "spectant, bun or node already on PATH"
else
  check "clean machine" ok "no spectant, bun, node"
fi
rc_before=$(rc_state)

curl -fsSL file:///release/install.sh | sh >/tmp/install.out 2>&1
code=$?
echo "----- install.sh output -----"
cat /tmp/install.out
echo "-----------------------------"
check "install.sh exit 0" "$(verdict "$code")" "exit $code"

if [ -x "$expect_dir/spectant" ]; then check "binary in install dir" ok "$expect_dir/spectant"; else check "binary in install dir" fail "no executable $expect_dir/spectant"; fi
if [ -f "$expect_dir/spectant" ] && [ ! -L "$expect_dir/spectant" ] \
   && grep -Fqx "Installed spectant $EXPECTED_VERSION to $expect_dir/spectant" /tmp/install.out; then
  check "installed exactly at target" ok "regular file, 'Installed ... to $expect_dir/spectant'"
else
  check "installed exactly at target" fail "not a regular file, or no 'Installed spectant $EXPECTED_VERSION to $expect_dir/spectant' line"
fi
elsewhere=
for other in /usr/local/bin/spectant "$HOME/.local/bin/spectant"; do
  if [ "$other" != "$expect_dir/spectant" ] && [ -e "$other" ]; then elsewhere="$elsewhere $other"; fi
done
if [ -z "$elsewhere" ]; then
  check "no copy elsewhere" ok "nothing in /usr/local/bin or ~/.local/bin besides the target"
else
  check "no copy elsewhere" fail "also found:$elsewhere"
fi
if [ -z "$override" ]; then
  if [ -x "$HOME/.local/bin/spectant" ] && [ ! -e /usr/local/bin/spectant ]; then
    check "fallback to ~/.local/bin" ok "/usr/local/bin refused the write, binary in ~/.local/bin"
  else
    check "fallback to ~/.local/bin" fail "binary not in ~/.local/bin, or a copy in /usr/local/bin"
  fi
fi
direct=$("$expect_dir/spectant" --version 2>&1)
code=$?
if [ "$code" = 0 ] && [ "$direct" = "spectant $EXPECTED_VERSION" ]; then
  check "--version from install dir" ok "$expect_dir/spectant: $direct"
else
  check "--version from install dir" fail "exit $code, output '$direct'"
fi
if [ "$(rc_state)" = "$rc_before" ]; then check "no rc file edited" ok "profile, bashrc, zshrc, fish unchanged"; else check "no rc file edited" fail "an rc file changed"; fi

line=$(grep -E '^[[:space:]]*export PATH=' /tmp/install.out | head -n 1 | sed 's/^[[:space:]]*//')
if [ -n "$line" ]; then check "PATH line printed" ok "$line"; else check "PATH line printed" fail "no 'export PATH=' line in the output"; fi
# The install dir is not on the container's PATH, so the hint must name exactly that directory.
if grep -Fq "$expect_dir is not on your PATH" /tmp/install.out && [ "$line" = "export PATH=\"$shown_dir:\$PATH\"" ]; then
  check "PATH hint names install dir" ok "$shown_dir"
else
  check "PATH hint names install dir" fail "expected '$expect_dir is not on your PATH' and 'export PATH=\"$shown_dir:\$PATH\"', got '$line'"
fi

# A clean, login-like environment with only the printed line applied: nothing inherited from this shell.
out=$(env -i HOME="$HOME" USER="$(id -un)" PATH="$clean_path" sh -c "$line"'
  printf "%s\n" "$(command -v spectant)"
  spectant --version' 2>&1)
code=$?
resolved=$(printf '%s\n' "$out" | head -n 1)
reported=$(printf '%s\n' "$out" | tail -n 1)
if [ "$resolved" = "$expect_dir/spectant" ]; then check "on PATH via printed line" ok "$resolved"; else check "on PATH via printed line" fail "command -v gave '$resolved'"; fi
if [ "$code" = 0 ] && [ "$reported" = "spectant $EXPECTED_VERSION" ]; then
  check "spectant --version" ok "$reported"
else
  check "spectant --version" fail "exit $code, output '$reported'"
fi

# Binary smoke: serve on a free loopback port, fetch the index, one hashed bundle and a deep link.
log=/tmp/serve.log
"$expect_dir/spectant" --port 0 >"$log" 2>&1 &
pid=$!
port=
i=0
while [ "$i" -lt 150 ]; do
  port=$(sed -n 's|.*listening on http://127\.0\.0\.1:\([0-9][0-9]*\).*|\1|p' "$log" | head -n 1)
  if [ -n "$port" ] || ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 0.2
  i=$((i + 1))
done
if [ -n "$port" ]; then
  check "serve --port 0" ok "127.0.0.1:$port"
  base="http://127.0.0.1:$port"
  js=$(curl -s "$base/" | grep -o 'main-[A-Za-z0-9_-]*\.js' | head -n 1)
  if [ -n "$js" ]; then check "index names a main-*.js" ok "$js"; else check "index names a main-*.js" fail "no main-*.js in /"; fi
  for p in / "/$js" /w/x; do
    status=$(curl -sI -o /dev/null -w '%{http_code}' "$base$p")
    if [ "$status" = 200 ]; then check "HEAD $p" ok "$status"; else check "HEAD $p" fail "$status"; fi
  done
else
  check "serve --port 0" fail "no 'listening on' line: $(tr '\n' ' ' <"$log")"
fi
kill "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
exit "$failed"
`;

function parseChecks(out: string): Check[] {
  return out
    .split("\n")
    .filter((line) => line.startsWith("CHECK|"))
    .map((line) => {
      const [, name = "", verdict = "", ...detail] = line.split("|");
      return { name, ok: verdict === "ok", detail: detail.join("|") };
    });
}

function printTable(checks: Check[]): void {
  const width = Math.max(...checks.map((check) => check.name.length), 5);
  console.log(`\n  ${"check".padEnd(width)}  result  detail`);
  for (const check of checks) {
    console.log(`  ${check.name.padEnd(width)}  ${(check.ok ? "ok" : "FAIL").padEnd(6)}  ${check.detail}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const { installDir } = parseArgs(argv);
  const version = readVersion();
  const platform = await pickPlatform();
  const binary = await ensureBinary(platform.target);
  const image = `spectant-install-test:${platform.target}`;

  console.log(`building ${image} (${platform.docker})`);
  const build = await exec(
    ["docker", "build", "--platform", platform.docker, "-t", image, "tests/install"],
    BUILD_TIMEOUT_MS,
  );
  if (build.code !== 0 || build.timedOut) {
    throw new RunError(`docker build ${build.timedOut ? "timed out after 5 min" : `failed (exit ${build.code})`}`, build.out);
  }

  // Only the files a release directory holds, each read-only; nothing of the checkout beyond them enters the box.
  const release = [binary, "install.sh"].map((file) => {
    if (!existsSync(join(ROOT, file))) throw new RunError(`${file} is missing`);
    return ["-v", `${join(ROOT, file)}:/release/${file.split("/").at(-1) ?? file}:ro`];
  });
  const name = `spectant-install-${String(process.pid)}`;
  const env = [
    "-e", "SPECTANT_RELEASE_URL=file:///release",
    "-e", `EXPECTED_VERSION=${version}`,
    ...(installDir === undefined ? [] : ["-e", `INSTALL_DIR=${installDir}`]),
  ];
  console.log(
    `running install.sh as a non-root user (${platform.docker}, ${installDir === undefined ? "default install dir" : `INSTALL_DIR=${installDir}`})`,
  );
  const run = await exec(
    ["docker", "run", "--rm", "--name", name, "--platform", platform.docker, ...release.flat(), ...env, image, "sh", "-c", IN_CONTAINER],
    RUN_TIMEOUT_MS,
    () => void Bun.spawnSync(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" }),
  );

  const checks = parseChecks(run.out);
  const failed = run.timedOut || run.code !== 0 || checks.length === 0 || checks.some((check) => !check.ok);
  if (checks.length > 0) printTable(checks);
  if (failed) {
    const why = run.timedOut ? "timed out after 2 min" : `exit ${run.code}`;
    console.error(`\ntest:install:linux: FAILED (${why}); container output:\n${run.out}`);
    return 1;
  }
  const exercised = platform.target === "linux-x64" ? "linux/amd64 (x64)" : "linux/arm64 ONLY — x64 not exercised";
  console.log(`\ntest:install:linux: ${checks.length} checks passed on ${exercised}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    console.error(`test:install:linux: ${error.message}${error.output ? `\n${error.output}` : ""}`);
    process.exit(1);
  }
}
