import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const template = join(root, "template");
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const templatePackage = JSON.parse(await readFile(join(template, "package.json"), "utf8"));

function requiredMajor(range) {
  const match = String(range).match(/>=\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
const requiredNodeMajor = requiredMajor(rootPackage.engines?.node) ?? 0;
if (nodeMajor < requiredNodeMajor) {
  console.error(
    `Node.js ${requiredNodeMajor}+ est requis par le kit (version actuelle : ${process.versions.node}).`,
  );
  console.error("Installez Node.js 24 ou une version plus récente, puis relancez la commande.");
  process.exit(78);
}

const packageManager = String(templatePackage.packageManager ?? "");
const managerMatch = packageManager.match(/^pnpm@(\d+)\.(\d+)\.(\d+)$/);
if (managerMatch) {
  const expectedVersion = packageManager.slice("pnpm@".length);
  const command = process.platform === "win32"
    ? (executable, args) => spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", executable, ...args], { encoding: "utf8" })
    : (executable, args) => spawnSync(executable, args, { encoding: "utf8" });
  const direct = command("pnpm", ["--version"]);
  const fallback = direct.status === 0
    ? direct
    : command("corepack", ["pnpm", "--version"]);
  const installedVersion = fallback.status === 0 ? fallback.stdout.trim() : "";
  const installedMatch = installedVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!installedMatch || installedVersion !== expectedVersion) {
    console.error(`pnpm ${expectedVersion} est requis par le template.`);
    console.error(
      installedMatch
        ? `Version actuelle : pnpm ${installedVersion}. Activez la version attendue avec Corepack.`
        : "pnpm est absent ou introuvable dans le PATH. Activez-le avec Corepack.",
    );
    console.error(`  corepack pnpm@${expectedVersion} --version`);
    process.exit(78);
  }
}

const missing = [];
for (const dependency of [
  ...Object.keys(templatePackage.dependencies ?? {}),
  ...Object.keys(templatePackage.devDependencies ?? {}),
]) {
  try {
    await access(join(template, "node_modules", dependency));
  } catch {
    missing.push(dependency);
  }
}

if (missing.length > 0) {
  console.error("Les dépendances du template ne sont pas installées dans template/node_modules.");
  console.error(`Paquets manquants : ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", ..." : ""}`);
  console.error("");
  console.error("Depuis la racine du dépôt, exécutez :");
  console.error("  corepack pnpm --dir template install --frozen-lockfile");
  console.error("Puis relancez :");
  console.error("  npm test");
  process.exit(78);
}

try {
  await access(join(template, "node_modules"));
} catch {
  console.error("Le dossier template/node_modules est absent.");
  console.error("Depuis la racine du dépôt, exécutez : corepack pnpm --dir template install --frozen-lockfile");
  process.exit(78);
}

console.log(`Environnement valide : Node.js ${process.versions.node}, template installé.`);
