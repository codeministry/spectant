#!/usr/bin/env bun
/**
 * check-leak — ISC-3 / XC-10: nothing individual in a committed file.
 *
 * Usage: bun run check:leak             (scans the repository this script lives in)
 *        bun scripts/check-leak.ts DIR  (scans the git repository at DIR instead; used by the tests)
 *
 * Scans every TRACKED text file (`git ls-files -z`; binaries are skipped by extension and by a NUL byte in the
 * first 8 KiB, a tracked symlink is scanned as its target text) for the generic leak classes:
 *
 *   home-path     an absolute home directory: /Users/NAME, /home/NAME, C:\Users\NAME. Placeholders such as
 *                 `<name>`, `$USER`, `runner` or `tester` are not a person and are not reported.
 *   machine-path  the house installation: the Claude home dot-folder and the LifeOS USER tree. Both name one machine.
 *   email         an address, except noreply/no-reply, `git@` remotes and the reserved example domains (RFC 2606).
 *   ipv4          an address outside loopback, link-local, RFC 1918, the documentation nets, 0.0.0.0 and 255.x masks.
 *   phone         an E.164 number, packed or grouped with single spaces or dashes (8 to 15 digits).
 *   iban          an IBAN whose mod-97 checksum holds, so upper-case hex runs are not reported.
 *   secret        API-key shapes (OpenAI, GitHub, Slack, AWS access key), a private key block, and 32+ hex digits
 *                 right after a token/secret/key name.
 *
 * Then the OPTIONAL private word list: `SPECTANT_LEAK_WORDS` names a file outside the repository, one word or phrase
 * per line (`#` comments and blank lines ignored), matched case-insensitively as whole words. The concrete names of
 * people, customers, machines and private repositories live only there (constitution § What a spec may contain).
 *
 * Exemption (constitution § Adaptations, XC-10): a licence attribution may carry the copyright holder's name as the
 * licence requires, so `LICENSE-*.txt` and `THIRD_PARTY_NOTICES.md` are exempt from the private word list, and every
 * `LICENSE*` / `NOTICE*` file from the email class. Every other class still applies to them.
 *
 * Suppression: a line that ends in an allow marker with a reason — an HTML comment `leak:allow REASON` in markdown,
 * or `// leak:allow REASON` / `# leak:allow REASON` in code — is skipped for the generic classes and listed with its
 * reason in the summary. A marker without a reason suppresses nothing. A marker never hides a private word: that
 * list exists precisely for the words no tracked file may carry.
 *
 * Output: one `path:line: class: <first three characters>…` per hit on stderr (a match is never printed whole, so
 * the report does not repeat the leak), then a summary; exit 1 on any hit, 0 when clean, 2 on a usage error (bad
 * arguments, DIR not a git repository, `SPECTANT_LEAK_WORDS` set but unreadable).
 */
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export type LeakClass = "home-path" | "machine-path" | "email" | "ipv4" | "phone" | "iban" | "secret" | "private-word";
export type LineHit = { cls: LeakClass; match: string };
export type Hit = LineHit & { path: string; line: number; note?: string };
export type Allowed = { path: string; line: number; reason: string };

const BINARY_EXT =
  /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|xz|7z|br|zst|wasm|mp3|mp4|webm|ogg|wav|mov|lockb|db|sqlite|jar|class|exe|dll|so|dylib|bin)$/i;
const SNIFF_BYTES = 8192;

// ---------------------------------------------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------------------------------------------

/** Names under a home root that stand for "someone", not for a person. */
const PLACEHOLDER_USERS = new Set([
  "user", "username", "name", "yourname", "your-name", "you", "me", "runner", "tester", "test", "example",
  "shared", "public", "default", "guest", "nobody", "root",
]);
const HOME_UNIX = /(?<![\w.:-])\/(?:Users|home)\/([A-Za-z0-9._-]+)(?=[/\\\s"'`),;:\]]|$)/g;
const HOME_WINDOWS = /\b[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)([A-Za-z0-9._-]+)/g;

function isPlaceholderUser(name: string): boolean {
  return PLACEHOLDER_USERS.has(name.replace(/\.+$/, "").toLowerCase());
}

const MACHINE_PATH = /(?:~|\$HOME|\$\{HOME\})\/\.claude\/|\bLIFEOS\/USER\b/gi;
// The house engineering standards live at one documented, tilde-relative location that every public constitution of
// this house cites as a binding source (spectant and leadgen alike). Naming it reveals a convention, not a machine;
// every other Claude-home or LIFEOS/USER path stays a machine-path hit. Decided 2026-09-29 (spec 001, round 15).
const HOUSE_STANDARDS_PREFIX = /(?:~|\$HOME|\$\{HOME\})\/\.claude\/LIFEOS\/USER\/ENGINEERING\//gi;

function stripHouseStandards(line: string): string {
  return line.replace(HOUSE_STANDARDS_PREFIX, "<house-standards>/");
}

const EMAIL = /(?<![\w.%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,}))(?![\w-])/g;
const EMAIL_LOCAL_OK = /^(?:no-?reply|git)$/i;
const EMAIL_DOMAIN_OK = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;
/** `logo@2x.png` is a file name, not an address. */
const FILE_TLD = /^(?:png|jpe?g|gif|svg|webp|avif|ico|js|mjs|cjs|ts|tsx|jsx|css|scss|json|md|html?|txt|ya?ml)$/i;

const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d|\.\d)/g;

const PHONE = /(?<![\w+])\+[1-9](?:[ -]?\d){7,14}(?![\d])/g;

const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;

const SECRETS: RegExp[] = [
  /(?<![A-Za-z0-9])sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g, // single-core: allow — PEM armour, not a frontmatter delimiter
  /(?:token|secret|key)[\w-]*["'`]?\s*(?:[:=]|=>)?\s*["'`]?[0-9a-f]{32,}\b/gi,
];

function isAllowedIpv4(o: number[]): boolean {
  const [a = 0, b = 0, c = 0, d = 0] = o;
  if (o.some((x) => x > 255)) return true; // not an address at all (a version string or a counter)
  if (a === 0) return b === 0 && c === 0 && d === 0;
  if (a === 127 || a === 10 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  return a === 203 && b === 0 && c === 113;
}

function ibanChecksumHolds(raw: string): boolean {
  const iban = raw.replace(/ /g, "");
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

/** Licence attributions that XC-10 lets carry the copyright holder's name. */
function isLicenceAttribution(path: string): boolean {
  const name = basename(path);
  return /^LICENSE-[^/]+\.txt$/.test(name) || name === "THIRD_PARTY_NOTICES.md";
}

/** Files whose addresses are licence contact or attribution lines. */
function isLicenceOrNotice(path: string): boolean {
  const name = basename(path);
  return /^(?:LICENSE|NOTICE)/i.test(name) || name === "THIRD_PARTY_NOTICES.md";
}

function genericHits(line: string, path: string): LineHit[] {
  const hits: LineHit[] = [];

  for (const re of [HOME_UNIX, HOME_WINDOWS]) {
    for (const m of line.matchAll(re)) if (!isPlaceholderUser(m[1] ?? "")) hits.push({ cls: "home-path", match: m[0] });
  }
  for (const m of stripHouseStandards(line).matchAll(MACHINE_PATH)) hits.push({ cls: "machine-path", match: m[0] });

  if (!isLicenceOrNotice(path)) {
    for (const m of line.matchAll(EMAIL)) {
      const [whole, local = "", domain = "", tld = ""] = m;
      if (EMAIL_LOCAL_OK.test(local) || EMAIL_DOMAIN_OK.test(domain) || FILE_TLD.test(tld)) continue;
      hits.push({ cls: "email", match: whole });
    }
  }

  for (const m of line.matchAll(IPV4)) {
    if (!isAllowedIpv4(m.slice(1, 5).map(Number))) hits.push({ cls: "ipv4", match: m[0] });
  }
  for (const m of line.matchAll(PHONE)) hits.push({ cls: "phone", match: m[0] });
  for (const m of line.matchAll(IBAN)) {
    if (ibanChecksumHolds(m[0])) hits.push({ cls: "iban", match: m[0] });
  }
  for (const re of SECRETS) for (const m of line.matchAll(re)) hits.push({ cls: "secret", match: m[0] });

  return hits;
}

function wordHits(line: string, path: string, words: RegExp | null): LineHit[] {
  if (!words || isLicenceAttribution(path)) return [];
  return [...line.matchAll(words)].map((m) => ({ cls: "private-word" as const, match: m[0] }));
}

/** Every hit on one line, ignoring allow markers. */
export function scanLine(line: string, path: string, words: RegExp | null): LineHit[] {
  return [...genericHits(line, path), ...wordHits(line, path, words)];
}

// ---------------------------------------------------------------------------------------------------------------
// Allow marker, word list, redaction
// ---------------------------------------------------------------------------------------------------------------

/** The markdown form may sit in a table's last cell, so a closing `|` after it is tolerated. */
const ALLOW_MARK = /(?:<!--\s*leak:allow\b(.*?)-->|\/\/\s*leak:allow\b(.*)|#\s*leak:allow\b(.*))\s*\|?\s*$/;

/** The allow marker at the end of a line, with its (possibly empty) reason; null when there is none. */
export function allowMarker(line: string): { reason: string } | null {
  const m = ALLOW_MARK.exec(line);
  if (!m) return null;
  const raw = m[1] ?? m[2] ?? m[3] ?? "";
  return { reason: raw.trim().replace(/^(?:—|–|--?|:)\s*/, "").trim() };
}

export function parseWordList(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

/** One case-insensitive whole-word matcher for the list, longest first; null for an empty list. */
export function compileWords(words: string[]): RegExp | null {
  if (words.length === 0) return null;
  const alternatives = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

/** A match is reported by its first three characters only, so the report never repeats the leak. */
export function redact(match: string): string {
  return `${Array.from(match).slice(0, 3).join("")}…`;
}

// ---------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------

export function scanText(path: string, text: string, words: RegExp | null): { hits: Hit[]; allowed: Allowed[] } {
  const hits: Hit[] = [];
  const allowed: Allowed[] = [];

  text.split("\n").forEach((raw, index) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const lineNo = index + 1;
    const generic = genericHits(line, path);
    const privateWords = wordHits(line, path, words);
    for (const h of privateWords) hits.push({ ...h, path, line: lineNo });
    if (generic.length === 0) return;

    const marker = allowMarker(line);
    if (marker && marker.reason !== "") {
      allowed.push({ path, line: lineNo, reason: marker.reason });
      return;
    }
    const note = marker ? "allow marker has no reason" : undefined;
    for (const h of generic) hits.push({ ...h, path, line: lineNo, ...(note ? { note } : {}) });
  });

  // Report in line order, private words beside the generic hits of the same line.
  hits.sort((a, b) => a.line - b.line);
  return { hits, allowed };
}

/** The file's text, or null for a binary or unreadable file. A symlink is its target text, as git stores it. */
function readText(file: string): string | null {
  try {
    if (lstatSync(file).isSymbolicLink()) return readlinkSync(file);
    const buf = readFileSync(file);
    if (buf.subarray(0, SNIFF_BYTES).includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

function trackedFiles(root: string): string[] | null {
  const r = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) return null;
  return r.stdout
    .toString()
    .split("\0")
    .filter((p) => p !== "");
}

const USAGE = `Usage: bun run check:leak
       bun scripts/check-leak.ts [DIR]

Scans the tracked files of the git repository at DIR (default: this repository) for leak classes
(home-path, machine-path, email, ipv4, phone, iban, secret) and, when SPECTANT_LEAK_WORDS names a
word-list file, for its private words. Exit 0 clean, 1 on any hit, 2 on a usage error.`;

function usageError(message: string): number {
  console.error(`check-leak: ${message}`);
  console.error(USAGE);
  return 2;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function main(argv: string[], env: Record<string, string | undefined>): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const flag = argv.find((a) => a.startsWith("-"));
  if (flag) return usageError(`unknown option ${flag}`);
  if (argv.length > 1) return usageError("at most one DIR");

  const root = resolve(argv[0] ?? join(import.meta.dir, ".."));
  const files = trackedFiles(root);
  if (!files) return usageError(`not a git repository: ${root}`);

  let words: RegExp | null = null;
  let wordLine = "private word list: none (SPECTANT_LEAK_WORDS unset)";
  const wordsFile = env.SPECTANT_LEAK_WORDS;
  if (wordsFile !== undefined && wordsFile !== "") {
    let list: string[];
    try {
      list = parseWordList(readFileSync(wordsFile, "utf8"));
    } catch {
      return usageError("SPECTANT_LEAK_WORDS is set but the file cannot be read");
    }
    words = compileWords(list);
    wordLine = `private word list: ${plural(list.length, "word")} (SPECTANT_LEAK_WORDS)`;
  }

  const hits: Hit[] = [];
  const allowed: Allowed[] = [];
  let scanned = 0;
  let binary = 0;
  for (const path of files) {
    if (BINARY_EXT.test(path)) {
      binary += 1;
      continue;
    }
    const text = readText(join(root, path));
    if (text === null) {
      binary += 1;
      continue;
    }
    scanned += 1;
    const result = scanText(path, text, words);
    hits.push(...result.hits);
    allowed.push(...result.allowed);
  }

  console.log(wordLine);
  const byReason = new Map<string, number[]>();
  for (const a of allowed) {
    const key = `${a.path}\0${a.reason}`;
    byReason.set(key, [...(byReason.get(key) ?? []), a.line]);
  }
  for (const [key, lines] of byReason) {
    const [path = "", reason = ""] = key.split("\0");
    console.log(`allowed: ${path}:${lines.join(",")}: ${reason}`);
  }

  const summary = `leak: ${plural(hits.length, "hit")}, ${plural(scanned, "file")} scanned (${binary} binary skipped, ${plural(allowed.length, "line")} allowed)`;
  if (hits.length === 0) {
    console.log(summary);
    return 0;
  }
  for (const h of hits) {
    console.error(`${h.path}:${h.line}: ${h.cls}: ${redact(h.match)}${h.note ? ` (${h.note})` : ""}`);
  }
  console.error(summary);
  console.error("leak: remove the match, or end the line in a leak:allow marker with a reason when it must stay (ISC-3, XC-10).");
  return 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2), process.env));
