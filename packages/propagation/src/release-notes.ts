/**
 * Helpers changelog / release notes (Keep a Changelog + Conventional Commits).
 */

import type { BumpKind } from "./semver-policy.js";
import {
  bumpKindFromCommit,
  parseConventionalCommit,
} from "./semver-policy.js";

export type ChangelogSection =
  | "Added"
  | "Changed"
  | "Fixed"
  | "Performance"
  | "Breaking"
  | "Internal";

export type ChangelogEntry = {
  section: ChangelogSection;
  text: string;
  scope: string | null;
  packageName?: string;
};

export function sectionForCommit(message: string): ChangelogSection | null {
  const kind = bumpKindFromCommit(message);
  const parsed = parseConventionalCommit(message);
  if (!parsed) return null;
  if (parsed.breaking || kind === "major") return "Breaking";
  switch (parsed.type) {
    case "feat":
      return "Added";
    case "fix":
      return "Fixed";
    case "perf":
      return "Performance";
    case "refactor":
    case "build":
      return "Changed";
    case "docs":
    case "test":
    case "chore":
    case "ci":
    case "style":
      return "Internal";
    default:
      return kind === "none" ? "Internal" : "Changed";
  }
}

export function entriesFromCommits(
  messages: string[],
  packageName?: string,
): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  for (const message of messages) {
    const section = sectionForCommit(message);
    const parsed = parseConventionalCommit(message);
    if (!section || !parsed) continue;
    out.push({
      section,
      text: parsed.subject,
      scope: parsed.scope,
      packageName,
    });
  }
  return out;
}

export function renderChangelogMarkdown(input: {
  packageName: string;
  version: string;
  date?: string;
  bumpKind: BumpKind;
  entries: ChangelogEntry[];
}): string {
  const date = input.date || new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `## ${input.packageName}@${input.version} (${date}) — ${input.bumpKind}`,
    "",
  ];
  const order: ChangelogSection[] = [
    "Breaking",
    "Added",
    "Changed",
    "Fixed",
    "Performance",
    "Internal",
  ];
  for (const section of order) {
    const items = input.entries.filter((e) => e.section === section);
    if (!items.length) continue;
    lines.push(`### ${section}`, "");
    for (const item of items) {
      const scope = item.scope ? `**${item.scope}**: ` : "";
      lines.push(`- ${scope}${item.text}`);
    }
    lines.push("");
  }
  if (input.entries.length === 0) {
    lines.push("_Aucun commit conventional détecté._", "");
  }
  return lines.join("\n");
}

export function prependChangelog(
  existing: string,
  block: string,
): string {
  const header = "# Changelog\n";
  const trimmed = existing.trim();
  if (!trimmed) {
    return `${header}\n${block}`;
  }
  if (trimmed.startsWith("# Changelog")) {
    const rest = trimmed.slice("# Changelog".length).replace(/^\n+/, "");
    return `${header}\n${block}\n${rest}`.trimEnd() + "\n";
  }
  return `${header}\n${block}\n${trimmed}\n`;
}
