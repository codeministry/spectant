// The plugin's command surface (spec 031 T4, ISC-39): the Spec plugin exposes the bare `/spec` and its ten
// subcommands, and nothing else.
//
// What Claude Code would load from the shipped plugin directory decides the surface. That directory is the source the
// root marketplace names (`plugin/spectant/`); `plugin/` itself also holds the lane notes, the CLI source and the tests,
// which never ship. Every `<shipped>/skills/<name>/SKILL.md` is a skill (and a `/<name>` command), every file under
// `<shipped>/commands/` a command, every file under `<shipped>/agents/` an agent, and
// `plugin.json` can point at further command, agent, MCP, LSP or output-style sources. So the tests pin:
//
// - exactly one skill directory, `<shipped>/skills/spec/`, holding `SKILL.md` whose frontmatter `name` is `spec`;
// - no `commands/`, no `agents/`, no `output-styles/`, no `.mcp.json`, no `.lsp.json` under `plugin/`, and no
//   `plugin.json` key that adds such a source. Hooks (`<shipped>/hooks/`) are allowed; they add no command;
// - the routing table in SKILL.md: the rows of the Markdown table under the heading `## Subcommands`, whose first cell
//   names the subcommand in backticks, are exactly the bare `/spec` and `init`, `idea`, `new`, `plan`, `tasks`,
//   `implement`, `review`, `done`;
// - SKILL.md names no `/spec-<name>` command, the surface the plugin replaces (the CLI path `bin/spec-check` is no
//   command and does not count).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../core/src/frontmatter.ts";
import { tableCells } from "../core/src/markdown.ts";

const ROOT = join(import.meta.dir, "..");
/** The shipped plugin directory: the source the root marketplace manifest names for the plugin `spectant`. */
const MARKETPLACE = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8")) as {
  plugins: Array<{ name: string; source: string }>;
};
const PLUGIN = join(ROOT, MARKETPLACE.plugins.find((p) => p.name === "spectant")?.source ?? "plugin/spectant");
const SKILLS = join(PLUGIN, "skills");
const SKILL_MD = join(SKILLS, "spec", "SKILL.md");
const MANIFEST = join(PLUGIN, ".claude-plugin", "plugin.json");

const BARE = "/spec";
const SUBCOMMANDS = ["init", "idea", "new", "plan", "tasks", "implement", "review", "done", "doc", "tldr"];

/** Directories and files under `plugin/` that would add a command, an agent or another surface beside the skill. */
const FORBIDDEN_ENTRIES = ["commands", "agents", "output-styles", ".mcp.json", ".lsp.json"];

/** `plugin.json` keys that point Claude Code at further command, agent, server or style sources. */
const FORBIDDEN_MANIFEST_KEYS = ["commands", "agents", "mcpServers", "lspServers", "outputStyles"];

function readSkill(): string {
  return readFileSync(SKILL_MD, "utf8");
}

/** The first-column values of the Markdown table under `## Subcommands`, backticks stripped, header and rule skipped;
 *  the cells are split by core's `tableCells`, so a row reads one way (ISC-5). */
function routedSubcommands(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Subcommands");
  if (start < 0) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(line)) break;
    section.push(line);
  }
  const rows = section.filter((line) => line.trimStart().startsWith("|"));
  return rows
    .slice(2)
    .map((row) => tableCells(row)[0] ?? "")
    .map((cell) => /^`([^`]+)`$/.exec(cell)?.[1] ?? cell);
}

describe("plugin layout: exposed commands (ISC-39)", () => {
  test("commands: exactly one skill directory, <shipped>/skills/spec/, holding SKILL.md", () => {
    expect(existsSync(SKILLS)).toBe(true);
    const skills = readdirSync(SKILLS).filter((entry) => statSync(join(SKILLS, entry)).isDirectory());
    expect(skills).toEqual(["spec"]);
    expect(existsSync(SKILL_MD)).toBe(true);
  });

  test("commands: no commands/, agents/, output styles, MCP or LSP servers beside the skill", () => {
    for (const entry of FORBIDDEN_ENTRIES) expect({ entry, exists: existsSync(join(PLUGIN, entry)) }).toEqual({ entry, exists: false });
    if (!existsSync(MANIFEST)) return;
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;
    expect(FORBIDDEN_MANIFEST_KEYS.filter((key) => key in manifest)).toEqual([]);
  });

  test("commands: the SKILL.md frontmatter names the skill spec", () => {
    // Read with core's frontmatter parser, never a second reader (ISC-5).
    const frontmatter = parseFrontmatter(readSkill());
    expect(frontmatter.present).toBe(true);
    expect(frontmatter.values.name).toBe("spec");
    expect(frontmatter.values.description ?? "").toMatch(/\S/);
  });

  test("commands: the routing table names exactly the bare /spec and the ten subcommands", () => {
    const routed = routedSubcommands(readSkill());
    expect(routed.length).toBe(new Set(routed).size);
    expect([...routed].sort()).toEqual([BARE, ...SUBCOMMANDS].sort());
  });

  test("commands: SKILL.md names no /spec-<name> command", () => {
    // A command name stands on its own; a path segment such as `bin/spec-check` is the CLI, not a command.
    expect(readSkill().match(/(?<![\w}./-])\/spec-[a-z]+/g) ?? []).toEqual([]);
  });
});
