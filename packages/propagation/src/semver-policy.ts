/**
 * Policy semver @creezio/* — Conventional Commits → bump.
 *
 * Convention changelog : voir docs/PROPAGATION.md § Semver.
 */

export type BumpKind = "major" | "minor" | "patch" | "none";

export type ConventionalCommitType =
  | "feat"
  | "fix"
  | "perf"
  | "refactor"
  | "docs"
  | "test"
  | "chore"
  | "ci"
  | "build"
  | "style"
  | "revert";

export type ParsedConventionalCommit = {
  type: ConventionalCommitType | string;
  scope: string | null;
  breaking: boolean;
  subject: string;
  raw: string;
};

const COMMIT_RE =
  /^(?<type>[a-zA-Z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<subject>.+)$/;

export function parseConventionalCommit(
  message: string,
): ParsedConventionalCommit | null {
  const first = message.trim().split(/\r?\n/, 1)[0] || "";
  const m = first.match(COMMIT_RE);
  if (!m?.groups) return null;
  const type = m.groups.type!.toLowerCase();
  const subject = (m.groups.subject || "").trim();
  const breaking =
    Boolean(m.groups.bang) ||
    /BREAKING CHANGE/i.test(message) ||
    /!:/.test(first);
  return {
    type,
    scope: m.groups.scope || null,
    breaking,
    subject,
    raw: first,
  };
}

/**
 * Règles de bump (policy kit) :
 * - breaking / ! → major
 * - feat → minor
 * - fix / perf → patch
 * - docs / test / chore / ci / build / style / refactor (sans breaking) → none
 *   (ou patch si `--force-patch` côté CLI)
 */
export function bumpKindFromCommit(message: string): BumpKind {
  const parsed = parseConventionalCommit(message);
  if (!parsed) return "none";
  if (parsed.breaking) return "major";
  switch (parsed.type) {
    case "feat":
      return "minor";
    case "fix":
    case "perf":
      return "patch";
    default:
      return "none";
  }
}

export function bumpKindFromCommits(messages: string[]): BumpKind {
  let kind: BumpKind = "none";
  const rank: Record<BumpKind, number> = {
    none: 0,
    patch: 1,
    minor: 2,
    major: 3,
  };
  for (const msg of messages) {
    const k = bumpKindFromCommit(msg);
    if (rank[k] > rank[kind]) kind = k;
  }
  return kind;
}

export function parseSemver(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const m = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

export function formatSemver(parts: {
  major: number;
  minor: number;
  patch: number;
}): string {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

export function applyBump(version: string, kind: BumpKind): string {
  if (kind === "none") return version;
  const parts = parseSemver(version);
  if (!parts) {
    throw new Error(`Version semver invalide: ${version}`);
  }
  if (kind === "major") {
    return formatSemver({ major: parts.major + 1, minor: 0, patch: 0 });
  }
  if (kind === "minor") {
    return formatSemver({
      major: parts.major,
      minor: parts.minor + 1,
      patch: 0,
    });
  }
  return formatSemver({
    major: parts.major,
    minor: parts.minor,
    patch: parts.patch + 1,
  });
}

/** Compare a.b.c ; retourne -1 / 0 / 1. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error(`compareSemver: invalide ${a} vs ${b}`);
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

export const SEMVER_POLICY_SUMMARY = {
  convention: "Conventional Commits",
  changelogPath: "CHANGELOG.md",
  rules: [
    "BREAKING CHANGE / type! → major",
    "feat → minor",
    "fix | perf → patch",
    "docs | test | chore | ci | build | style | refactor → none (sauf --force-patch)",
    "Bump d'un package → rebuild des dépendants workspace ; PR marque si surface touchée",
  ],
} as const;
