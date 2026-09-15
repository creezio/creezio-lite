#!/usr/bin/env node
/**
 * Gate FLOTTE — préflight UFW des ports hôte consommés depuis les conteneurs
 * (18800 backend flotte, 18810 host-agent).
 *
 * Incident 10–30/08/2026 : règle 18810 restée scoped docker0 (172.17.0.0/16)
 * → host-agent droppé 20 jours en silence. Le préflight (server-docker
 * agent up | admin up | enroll) détecte UFW actif + règle absente et la pose
 * (droits root/sudo -n) ou échoue explicitement avec la commande exacte —
 * jamais silencieux. SoT : packages/factory/src/server-docker-ufw.ts.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  UFW_DOCKER_SOURCE,
  ufwAllowCommand,
  ufwStatusIsActive,
  ufwStatusHasFleetRule,
  ufwFleetRulePreflight,
  assertUfwFleetRule,
} = await import(
  new URL(
    `file://${path.join(ROOT, "packages/factory/dist/server-docker-ufw.js")}`,
  ).href
);

const STATUS_ACTIVE_WITH_RULES = `Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere                   # SSH
18810/tcp                  ALLOW       172.17.0.0/16              # docker0 seul (legacy — NE suffit PAS)
172.17.0.1 18800/tcp       ALLOW       172.16.0.0/12              # creezio fleet bridge
172.17.0.1 18810/tcp       ALLOW       172.16.0.0/12              # host agent
22/tcp (v6)                ALLOW       Anywhere (v6)              # SSH
`;

const STATUS_ACTIVE_DOCKER0_ONLY = `Status: active

To                         Action      From
--                         ------      ----
18810/tcp                  ALLOW       172.17.0.0/16              # docker0 seul (incident 10–30/08)
`;

test("parsing ufw status : actif / règle 172.16.0.0/12 détectée", () => {
  assert.equal(ufwStatusIsActive(STATUS_ACTIVE_WITH_RULES), true);
  assert.equal(ufwStatusIsActive("Status: inactive\n"), false);
  assert.equal(ufwStatusHasFleetRule(STATUS_ACTIVE_WITH_RULES, 18810), true);
  assert.equal(ufwStatusHasFleetRule(STATUS_ACTIVE_WITH_RULES, 18800), true);
  // La règle docker0 seule (172.17.0.0/16) ne compte PAS — c'est l'incident.
  assert.equal(ufwStatusHasFleetRule(STATUS_ACTIVE_DOCKER0_ONLY, 18810), false);
  // Un port voisin ne matche pas par sous-chaîne.
  assert.equal(ufwStatusHasFleetRule(STATUS_ACTIVE_WITH_RULES, 1881), false);
  assert.equal(
    ufwAllowCommand(18810),
    "ufw allow proto tcp from 172.16.0.0/12 to 172.17.0.1 port 18810",
  );
});

test("préflight : ufw absent → no-ufw ; inactif → inactive ; règle → present", () => {
  const enoent = () => ({ ok: false, stdout: "", error: "ENOENT" });
  assert.deepEqual(ufwFleetRulePreflight({ port: 18810, exec: enoent }), {
    status: "no-ufw",
  });

  const inactive = (argv) =>
    argv.includes("status")
      ? { ok: true, stdout: "Status: inactive\n" }
      : { ok: false, stdout: "", error: "unexpected" };
  assert.deepEqual(ufwFleetRulePreflight({ port: 18810, exec: inactive }), {
    status: "inactive",
  });

  const present = (argv) =>
    argv.includes("status")
      ? { ok: true, stdout: STATUS_ACTIVE_WITH_RULES }
      : { ok: false, stdout: "", error: "unexpected" };
  assert.deepEqual(ufwFleetRulePreflight({ port: 18810, exec: present }), {
    status: "present",
  });
});

test("préflight : règle absente → posée (avec re-vérification) via les droits qui lisent", () => {
  // Simule un run non-root : `ufw status` direct refusé, sudo -n OK ;
  // après le `allow`, le status re-lu contient la règle.
  const calls = [];
  let allowed = false;
  const exec = (argv) => {
    calls.push(argv.join(" "));
    const viaSudo = argv[0] === "sudo";
    if (!viaSudo) return { ok: false, stdout: "", error: "EACCES" };
    if (argv.includes("status")) {
      return {
        ok: true,
        stdout: allowed ? STATUS_ACTIVE_WITH_RULES : STATUS_ACTIVE_DOCKER0_ONLY,
      };
    }
    if (argv.includes("allow")) {
      allowed = true;
      assert.deepEqual(argv.slice(-8), [
        "proto",
        "tcp",
        "from",
        UFW_DOCKER_SOURCE,
        "to",
        "172.17.0.1",
        "port",
        "18810",
      ]);
      return { ok: true, stdout: "Rule added\n" };
    }
    return { ok: false, stdout: "", error: "unexpected" };
  };
  assert.deepEqual(ufwFleetRulePreflight({ port: 18810, exec }), {
    status: "added",
  });
  assert.ok(calls.some((c) => c.startsWith("sudo -n")));
});

test("préflight fail-closed : actif + règle absente + pose impossible → erreur actionnable", () => {
  const exec = (argv) => {
    if (argv.includes("status")) {
      return { ok: true, stdout: STATUS_ACTIVE_DOCKER0_ONLY };
    }
    return { ok: false, stdout: "", error: "EACCES" }; // allow refusé
  };
  const r = ufwFleetRulePreflight({ port: 18810, exec });
  assert.equal(r.status, "missing");
  assert.throws(
    () => assertUfwFleetRule({ port: 18810, label: "host-agent", exec, log: () => {} }),
    (err) => {
      assert.match(
        err.message,
        /sudo ufw allow proto tcp from 172\.16\.0\.0\/12 to 172\.17\.0\.1 port 18810/,
        "le message doit contenir la commande exacte",
      );
      assert.match(err.message, /UFW BLOCK/);
      return true;
    },
  );
});

test("préflight : lecture impossible → unknown (warn, jamais silencieux)", () => {
  const exec = () => ({ ok: false, stdout: "", error: "EACCES" });
  const r = ufwFleetRulePreflight({ port: 18800, exec });
  assert.equal(r.status, "unknown");
  const lines = [];
  const res = assertUfwFleetRule({
    port: 18800,
    label: "backend flotte",
    exec,
    log: (l) => lines.push(l),
  });
  assert.equal(res.status, "unknown");
  assert.ok(
    lines.some((l) => l.includes("ufw allow proto tcp from 172.16.0.0/12")),
    "le warn doit contenir la commande exacte",
  );
});

test("CLI : agent up / admin up / enroll appellent le préflight (ancrage source)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  const count = (src.match(/assertUfwFleetRule\(\{/g) || []).length;
  assert.ok(
    count >= 3,
    `assertUfwFleetRule attendu dans agent up + admin up + enroll (trouvé ${count})`,
  );
});
