/**
 * Évaluateur de conditions style Notion (AND/OR imbriqués).
 */

export type CompareOp =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "in"
  | "changed"
  | "changed_to"
  | "changed_from";

export type ConditionRule = {
  field: string;
  cmp: CompareOp;
  value?: unknown;
};

export type ConditionGroup = {
  op: "and" | "or";
  rules: Array<ConditionRule | ConditionGroup>;
};

export type ConditionContext = {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

function isGroup(node: ConditionRule | ConditionGroup): node is ConditionGroup {
  return (
    typeof node === "object" &&
    node !== null &&
    "op" in node &&
    Array.isArray((node as ConditionGroup).rules)
  );
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return String(a) === String(b);
}

function evalRule(rule: ConditionRule, ctx: ConditionContext): boolean {
  const before = ctx.before ?? null;
  const after = ctx.after ?? null;
  const row = after ?? before ?? {};
  const current = row[rule.field];
  const prev = before ? before[rule.field] : undefined;
  const next = after ? after[rule.field] : undefined;

  switch (rule.cmp) {
    case "equals":
      return valuesEqual(current, rule.value);
    case "not_equals":
      return !valuesEqual(current, rule.value);
    case "contains":
      return String(current ?? "")
        .toLowerCase()
        .includes(String(rule.value ?? "").toLowerCase());
    case "not_contains":
      return !String(current ?? "")
        .toLowerCase()
        .includes(String(rule.value ?? "").toLowerCase());
    case "gt": {
      const a = asNumber(current);
      const b = asNumber(rule.value);
      return a != null && b != null && a > b;
    }
    case "gte": {
      const a = asNumber(current);
      const b = asNumber(rule.value);
      return a != null && b != null && a >= b;
    }
    case "lt": {
      const a = asNumber(current);
      const b = asNumber(rule.value);
      return a != null && b != null && a < b;
    }
    case "lte": {
      const a = asNumber(current);
      const b = asNumber(rule.value);
      return a != null && b != null && a <= b;
    }
    case "is_empty":
      return isEmpty(current);
    case "is_not_empty":
      return !isEmpty(current);
    case "in": {
      const list = Array.isArray(rule.value) ? rule.value : [rule.value];
      return list.some((item) => valuesEqual(current, item));
    }
    case "changed":
      return before != null && after != null && !valuesEqual(prev, next);
    case "changed_to":
      return (
        before != null &&
        after != null &&
        !valuesEqual(prev, next) &&
        valuesEqual(next, rule.value)
      );
    case "changed_from":
      return (
        before != null &&
        after != null &&
        !valuesEqual(prev, next) &&
        valuesEqual(prev, rule.value)
      );
    default:
      return false;
  }
}

export function evaluateConditions(
  group: ConditionGroup | null | undefined,
  ctx: ConditionContext,
): boolean {
  if (!group || !Array.isArray(group.rules) || group.rules.length === 0) {
    return true;
  }
  const results = group.rules.map((node) =>
    isGroup(node) ? evaluateConditions(node, ctx) : evalRule(node, ctx),
  );
  return group.op === "or" ? results.some(Boolean) : results.every(Boolean);
}

export function parseConditions(raw: unknown): ConditionGroup {
  if (!raw || typeof raw !== "object") {
    return { op: "and", rules: [] };
  }
  const obj = raw as ConditionGroup;
  if (obj.op !== "and" && obj.op !== "or") {
    return { op: "and", rules: [] };
  }
  return {
    op: obj.op,
    rules: Array.isArray(obj.rules) ? obj.rules : [],
  };
}
