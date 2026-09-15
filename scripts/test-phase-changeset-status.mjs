/**
 * Gate : le check changeset a du sens sur la PR de version (pas de
 * changeset orphelin) ET sur les PR normales (`changeset status --since`).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("changeset-status-check : PR de version sans leftover = vert", async () => {
  const { runChangesetStatusCheck, isVersionPrRef, pendingChangesetFiles } =
    await import("./changeset-status-check.mjs");
  assert.equal(isVersionPrRef("changeset-release/main"), true);
  assert.equal(isVersionPrRef("fix/foo"), false);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-cs-"));
  try {
    const dir = path.join(tmp, ".changeset");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "# changesets\n");
    assert.deepEqual(pendingChangesetFiles(dir), []);
    const ok = runChangesetStatusCheck({
      headRef: "changeset-release/main",
      changesetDir: dir,
      cwd: tmp,
    });
    assert.equal(ok.ok, true, ok.message);
    fs.writeFileSync(path.join(dir, "orphan.md"), "---\n'@creezio/factory': patch\n---\n");
    const leftover = runChangesetStatusCheck({
      headRef: "changeset-release/main",
      changesetDir: dir,
      cwd: tmp,
    });
    assert.equal(leftover.ok, false);
    assert.match(leftover.message, /orphan\.md/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("workflow changeset-status appelle le check dual", () => {
  const yml = fs.readFileSync(
    path.join(ROOT, ".github/workflows/changeset-status.yml"),
    "utf8",
  );
  assert.match(yml, /changeset-status-check\.mjs/);
  assert.match(yml, /GITHUB_HEAD_REF/);
  assert.doesNotMatch(
    yml,
    /run: npx changeset status --since/,
    "le workflow ne doit plus appeler changeset status seul (rouge sur la PR de version)",
  );
});
