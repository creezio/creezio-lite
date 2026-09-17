import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, cp, readdir, symlink, lstat, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createApp, doctor, adopt, inspectOrchestration, orchestrationSources, orchestrationGenerated, renderDiscovery, skillFrontmatter, orchestrationDir, orchestrationManifest, orchestrationRule, orchestrationDiscovery } from '../bin/lite.mjs';

// P3 — distribution et découverte du standard, composé (P4) avec les vraies ressources P1 (PLANNING.md, schémas, exemples) et P2 (plan-missions.mjs).
// Les fichiers `fixtures` ci-dessous simulent une ressource FUTURE ajoutée au dossier canonique : noms clairement fictifs, aucun format implémenté,
// aucune collision avec une ressource réelle (la propriété testée est « ajouter un fichier suffit », pas le contenu).
const root = fileURLToPath(new URL('../', import.meta.url));
const FIXTURE_NOTE = 'FIXTURE P3 (test de distribution) — ressource future simulée, sans valeur contractuelle.';
const fixtures = {
  'FIXTURE-FUTURE.md': `# ${FIXTURE_NOTE}\n`,
  'fixture-future.schema.json': JSON.stringify({ $comment: FIXTURE_NOTE }, null, 2) + '\n',
  'examples/fixture-future.json': JSON.stringify({ $comment: FIXTURE_NOTE }, null, 2) + '\n',
  'scripts/fixture-future.mjs': `// ${FIXTURE_NOTE}\nconsole.log(JSON.stringify({ fixture: 'P3', argv: process.argv.slice(2) }));\n`,
};
const fixturePaths = Object.keys(fixtures).map(f => `${orchestrationDir}/${f}`).sort();
// Les cinq ressources du contrat de planification (P1) et l’outil (P2), réellement distribués depuis le dossier canonique.
const planningResources = ['PLANNING.md', 'planning-plan.schema.json', 'planning-state.schema.json', 'examples/planning-plan.json', 'examples/planning-state.json'].map(f => `${orchestrationDir}/${f}`);
const planTool = `${orchestrationDir}/scripts/plan-missions.mjs`;
const PRIVATE = /bc-[0-9a-f]{8}-[0-9a-f]{4}|run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}|\/home\/|\/Users\/|[A-Z]:\\|key_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const childEnv = { PATH: process.env.PATH };
const discoveryDir = dirname(orchestrationDiscovery);
async function withTemp(prefix, run) { const temp = await mkdtemp(join(tmpdir(), prefix)); try { return await run(temp); } finally { await rm(temp, { recursive: true, force: true }); } }
async function snapshot(dir, skip = []) {
  const out = {};
  try { for (const f of await readdir(dir, { recursive: true })) { const path = join(dir, f), key = f.replaceAll(sep, '/'); if (skip.includes(key)) continue; const info = await lstat(path); out[key] = info.isDirectory() ? 'dir' : info.isSymbolicLink() ? 'link' : sha(await readFile(path)); } }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  return out;
}
// Résolution telle que documentée par Codex (`.agents/skills`, du CWD à la racine) et Cursor (`.agents/skills` et `.cursor/skills`) :
// tout dossier contenant SKILL.md, frontmatter name/description, nom égal au dossier.
async function discoverSkills(project, base) {
  const found = [];
  async function walk(dir) {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) { const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.name === 'SKILL.md') found.push({ dir: relative(project, dirname(path)).replaceAll(sep, '/'), folder: basename(dirname(path)), ...skillFrontmatter(await readFile(path, 'utf8')) }); }
  }
  await walk(join(project, base)); return found;
}
const backticked = text => [...text.matchAll(/`([^`\n]+)`/g)].map(m => m[1]);
// Copie du kit dans un dossier temporaire : seule façon d'ajouter une ressource à la source canonique sans toucher au dépôt.
async function kitCopy(destination) {
  const omit = new Set(['node_modules', 'dist', '.next', '.wrangler', '.sites-runtime', 'coverage', '.git']);
  const filter = path => !omit.has(basename(path));
  await mkdir(destination, { recursive: true });
  for (const dir of ['bin', 'runtime', '.cursor']) await cp(join(root, dir), join(destination, dir), { recursive: true, filter });
  await cp(join(root, 'template'), join(destination, 'template'), { recursive: true, filter: path => filter(path) && relative(join(root, 'template'), path) !== 'runtime' });
  await cp(join(root, 'package.json'), join(destination, 'package.json'));
  return destination;
}
const runCli = (kit, args, cwd) => spawnSync(process.execPath, [join(kit, 'bin/lite.mjs'), ...args], { encoding: 'utf8', cwd, env: childEnv });
const toCrlf = text => text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
async function writeKitSkill(kit, text) { await writeFile(join(kit, orchestrationDir, 'SKILL.md'), text); }

test('the discovery file is derived from the canonical skill, lists every distributed resource and stays out of the copied sources', async () => {
  const sources = await orchestrationSources(), generated = await orchestrationGenerated(sources);
  assert.ok(Object.keys(sources).every(p => p.startsWith('.cursor/')), 'les sources copiées restent sous .cursor');
  assert.deepEqual(Object.keys(generated), [orchestrationDiscovery]);
  assert.ok(!(orchestrationDiscovery in sources) && orchestrationDiscovery.startsWith('.agents/skills/'));
  const canonical = skillFrontmatter(await readFile(sources[`${orchestrationDir}/SKILL.md`], 'utf8'));
  const discovery = generated[orchestrationDiscovery].toString(), front = skillFrontmatter(discovery);
  assert.deepEqual(front, canonical, 'même nom et même description : mêmes conditions de sélection par Codex et Cursor');
  assert.equal(front.name, basename(discoveryDir), 'le nom doit égaler le dossier (exigence Cursor)');
  const listed = backticked(discovery);
  for (const path of Object.keys(sources)) assert.ok(listed.includes(path), `ressource non référencée : ${path}`);
  assert.ok(listed.includes(`node ${orchestrationDir}/scripts/cursor-agents.mjs`), 'commande d’exécution du script distribué');
  assert.ok(listed.includes(orchestrationManifest) && discovery.includes('adopt --app'), 'copie gérée, procédure de mise à jour indiquée');
  assert.doesNotMatch(discovery, PRIVATE);
  assert.ok((await orchestrationGenerated())[orchestrationDiscovery].equals(generated[orchestrationDiscovery]), 'rendu déterministe');
  // Les ressources réelles P1/P2 sont classées dans la bonne section : références (contrat, schémas, exemples) et scripts (plan-missions).
  const [references, scripts] = discovery.split('## Scripts distribués');
  for (const path of planningResources) assert.ok(references.includes(`\`${path}\``), `référence : ${path}`);
  assert.ok(scripts.includes(`\`node ${planTool}\``) && scripts.includes(`\`node ${orchestrationDir}/scripts/cursor-agents.mjs\``));
  assert.ok(!scripts.includes(`\`${orchestrationDir}/PLANNING.md\``) && !references.includes(planTool));
  // Pure fonction : une ressource future (référence ou script) apparaît dans la bonne section sans autre code.
  const future = renderDiscovery(canonical, [...Object.keys(sources), ...fixturePaths]);
  const [futureReferences, futureScripts] = future.split('## Scripts distribués');
  assert.ok(futureReferences.includes(`\`${orchestrationDir}/FIXTURE-FUTURE.md\``) && futureReferences.includes(`\`${orchestrationDir}/examples/fixture-future.json\``));
  assert.ok(futureScripts.includes(`\`node ${orchestrationDir}/scripts/fixture-future.mjs\``) && !futureReferences.includes('fixture-future.mjs'));
  assert.throws(() => skillFrontmatter('---\nname: x\n---\nbody'), /description/);
  assert.throws(() => skillFrontmatter('pas de frontmatter'), /frontmatter/);
});

test('a generated application resolves the skill through the documented Codex and Cursor entry points and runs the distributed script without the kit', async () => {
  await withTemp('lite-dist-create-', async (temp) => {
    const app = join(temp, 'app');
    await createApp({ out: app, spec: join(root, 'examples/services.json') });
    const codex = await discoverSkills(app, '.agents/skills'), cursor = await discoverSkills(app, '.cursor/skills');
    assert.equal(codex.length, 1); assert.equal(cursor.length, 1);
    assert.deepEqual([codex[0].dir, codex[0].folder, codex[0].name], [discoveryDir, 'lite-orchestration', 'lite-orchestration']);
    assert.deepEqual([cursor[0].dir, cursor[0].folder, cursor[0].name], [orchestrationDir, 'lite-orchestration', 'lite-orchestration']);
    assert.equal(codex[0].description, cursor[0].description);
    const discovery = await readFile(join(app, orchestrationDiscovery), 'utf8');
    const referenced = backticked(discovery).filter(p => p.startsWith('.cursor/'));
    for (const path of [...planningResources, planTool]) assert.ok(referenced.includes(path), `découverte : ${path}`);
    for (const path of referenced) { const info = await lstat(join(app, path)); assert.ok(info.isFile() && !info.isSymbolicLink(), `${path} doit être un vrai fichier de l’application`); }
    const manifest = JSON.parse(await readFile(join(app, orchestrationManifest), 'utf8'));
    assert.deepEqual(manifest.generated, { [orchestrationDiscovery]: sha(await readFile(join(app, orchestrationDiscovery))) });
    assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(await orchestrationSources()).sort());
    assert.ok(!(orchestrationDiscovery in manifest.files), 'le fichier généré n’est pas une copie de source');
    const agents = await readFile(join(app, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes(`${orchestrationDir}/SKILL.md`) && agents.includes(orchestrationDiscovery), 'AGENTS.md renvoie vers la compétence canonique et le point de découverte');
    assert.match(await readFile(join(app, orchestrationRule), 'utf8'), /alwaysApply: true/);
    assert.equal((await doctor(app)).orchestration.status, 'current');
    const lock = JSON.parse(await readFile(join(app, 'lite.lock.json'), 'utf8'));
    assert.ok(!Object.keys(lock.runtimeFiles).some(f => f.includes('.agents') || f.includes('.cursor')), 'le verrou runtime ne couvre pas le standard');
    // Hors kit : seuls les fichiers de l'application, le script distribué s'exécute depuis la racine du projet.
    const standalone = join(temp, 'standalone');
    for (const dir of ['.cursor', '.agents']) await cp(join(app, dir), join(standalone, dir), { recursive: true });
    const help = spawnSync(process.execPath, [`${orchestrationDir}/scripts/cursor-agents.mjs`, '--help'], { encoding: 'utf8', cwd: standalone, env: childEnv });
    assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /preflight/);
    const inspection = await inspectOrchestration(standalone);
    assert.equal(inspection.status, 'current'); assert.deepEqual(inspection.generated, { [orchestrationDiscovery]: 'current' });
  });
});

test('adopt adds the discovery file to an application installed by an earlier kit, preserves local skills, refuses conflicts without partial writes', async () => {
  await withTemp('lite-dist-adopt-', async (temp) => {
    const app = join(temp, 'existing');
    await createApp({ out: app, spec: join(root, 'examples/catalogue.json') });
    const manifestPath = join(app, orchestrationManifest);
    // Application installée par un kit sans fichier généré : manifeste sans `generated`, dossier .agents absent.
    await rm(join(app, '.agents'), { recursive: true, force: true });
    const older = JSON.parse(await readFile(manifestPath, 'utf8')); delete older.generated; await writeFile(manifestPath, JSON.stringify(older, null, 2) + '\n');
    const localAgents = '# AGENTS de l’application\nRègles métier propres.\n'; await writeFile(join(app, 'AGENTS.md'), localAgents);
    const localSkill = '---\nname: metier-local\ndescription: compétence métier de l’application, hors kit\n---\nLocal.\n';
    for (const base of ['.agents/skills', '.cursor/skills']) { await mkdir(join(app, base, 'metier-local'), { recursive: true }); await writeFile(join(app, base, 'metier-local/SKILL.md'), localSkill); }

    const inspection = await adopt(app);
    assert.equal(inspection.applied, false); assert.equal(inspection.status, 'outdated'); assert.equal(inspection.changed, true);
    assert.ok(Object.values(inspection.files).every(s => s === 'current'), 'aucune copie de source à réécrire');
    assert.deepEqual(inspection.generated, { [orchestrationDiscovery]: 'missing' }); assert.deepEqual(inspection.pending, []); assert.deepEqual(inspection.pendingGenerated, [orchestrationDiscovery]);
    assert.equal((await doctor(app)).orchestration.status, 'outdated');
    const cursorBefore = await snapshot(join(app, '.cursor'), [orchestrationManifest.slice('.cursor/'.length)]);
    const applied = await adopt(app, true);
    assert.equal(applied.applied, true); assert.deepEqual(applied.written, []); assert.deepEqual(applied.writtenGenerated, [orchestrationDiscovery]);
    assert.deepEqual(await snapshot(join(app, '.cursor'), [orchestrationManifest.slice('.cursor/'.length)]), cursorBefore, 'les copies à jour ne sont pas réécrites');
    assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')).generated, { [orchestrationDiscovery]: sha(await readFile(join(app, orchestrationDiscovery))) });
    assert.ok((await readFile(join(app, orchestrationDiscovery))).equals((await orchestrationGenerated())[orchestrationDiscovery]));
    const again = await adopt(app, true);
    assert.equal(again.applied, false); assert.equal(again.changed, false); assert.equal(again.status, 'current');
    assert.equal((await doctor(app)).orchestration.status, 'current');
    // Compétences locales et fichiers non gérés préservés ; seuls ceux du dossier géré sont listés.
    await writeFile(join(app, discoveryDir, 'notes-locales.md'), 'préservé\n');
    const withNotes = await adopt(app, true);
    assert.equal(withNotes.applied, false); assert.deepEqual(withNotes.unmanaged, [`${discoveryDir}/notes-locales.md`]);
    for (const base of ['.agents/skills', '.cursor/skills']) assert.equal(await readFile(join(app, base, 'metier-local/SKILL.md'), 'utf8'), localSkill);
    assert.equal(await readFile(join(app, 'AGENTS.md'), 'utf8'), localAgents);
    assert.deepEqual((await discoverSkills(app, '.agents/skills')).map(s => s.name).sort(), ['lite-orchestration', 'metier-local']);
    // Conflit sur le fichier généré + copie de source périmée : refus global, aucune écriture partielle.
    const skillPath = join(app, orchestrationDir, 'SKILL.md'), original = await readFile(skillPath, 'utf8'), stale = original + '\nancienne version\n';
    await writeFile(skillPath, stale);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.files[`${orchestrationDir}/SKILL.md`] = sha(stale); await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const generatedBytes = await readFile(join(app, orchestrationDiscovery));
    await writeFile(join(app, orchestrationDiscovery), generatedBytes + 'Note locale non autorisée.\n');
    const conflict = await adopt(app);
    assert.equal(conflict.status, 'conflict'); assert.deepEqual(conflict.conflicts, [orchestrationDiscovery]); assert.equal(conflict.files[`${orchestrationDir}/SKILL.md`], 'outdated'); assert.deepEqual(conflict.generated, { [orchestrationDiscovery]: 'conflict' });
    assert.deepEqual((await doctor(app)).orchestration.conflicts, [orchestrationDiscovery]);
    const before = await snapshot(join(app, '.cursor')), beforeAgents = await snapshot(join(app, '.agents'));
    await assert.rejects(adopt(app, true), /Conflit local sur \.agents\/skills\/lite-orchestration\/SKILL\.md.*Aucune modification effectuée/);
    assert.deepEqual(await snapshot(join(app, '.cursor')), before, 'la copie périmée n’est pas réécrite tant qu’un conflit existe');
    assert.deepEqual(await snapshot(join(app, '.agents')), beforeAgents);
    const cli = spawnSync(process.execPath, [join(root, 'bin/lite.mjs'), 'adopt', '--app', app], { encoding: 'utf8', env: childEnv });
    assert.equal(cli.status, 2); const report = JSON.parse(cli.stdout); assert.deepEqual(report.conflicts, [orchestrationDiscovery]); assert.equal(report.generated[orchestrationDiscovery], 'conflict');
    await writeFile(join(app, orchestrationDiscovery), generatedBytes);
    const repaired = await adopt(app, true);
    assert.deepEqual(repaired.written, [`${orchestrationDir}/SKILL.md`]); assert.deepEqual(repaired.writtenGenerated, []);
    assert.equal(await readFile(skillPath, 'utf8'), original);
    assert.equal(await readFile(join(app, discoveryDir, 'notes-locales.md'), 'utf8'), 'préservé\n');
    assert.equal((await adopt(app, true)).changed, false);
    // Manifeste avec `generated` invalide : erreur claire, rien n'est modifié.
    await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(await readFile(manifestPath, 'utf8')), generated: 'x' }) + '\n');
    const untouched = await snapshot(app);
    await assert.rejects(adopt(app, true), /Manifeste d’orchestration inconnu/);
    assert.deepEqual(await snapshot(app), untouched);
  });
});

test('adopt refuses a symlinked discovery path or parent before any write, including when other copies are pending', async () => {
  await withTemp('lite-dist-symlink-', async (temp) => {
    const app = join(temp, 'app'), outside = join(temp, 'outside');
    await createApp({ out: app, spec: join(root, 'examples/catalogue.json') });
    await rm(join(app, '.agents'), { recursive: true, force: true }); await rm(join(app, '.cursor'), { recursive: true, force: true });
    const refused = async (pattern) => {
      const outsideBefore = await snapshot(outside), appBefore = await snapshot(app);
      await assert.rejects(adopt(app), pattern); await assert.rejects(adopt(app, true), pattern);
      assert.deepEqual(await snapshot(outside), outsideBefore, 'cibles externes intactes'); assert.deepEqual(await snapshot(app), appBefore, 'application intacte, y compris .cursor en attente');
      assert.equal((await doctor(app)).orchestration.status, 'invalid');
    };
    // 1. .agents → dossier externe alors que toutes les copies .cursor sont manquantes : rien n'est écrit, ni dehors ni dans .cursor.
    await mkdir(join(outside, 'agents'), { recursive: true });
    await symlink(join(outside, 'agents'), join(app, '.agents'), 'dir');
    await refused(/Lien symbolique ou jonction refusé : \.agents.*Aucune modification effectuée/);
    assert.deepEqual(await readdir(join(outside, 'agents')), []);
    await rm(join(app, '.agents'));
    // 2. .agents/skills/lite-orchestration → dossier externe, parents réels.
    await mkdir(join(app, '.agents/skills'), { recursive: true }); await mkdir(join(outside, 'skill'), { recursive: true });
    await symlink(join(outside, 'skill'), join(app, discoveryDir), 'dir');
    await refused(/Lien symbolique .*lite-orchestration.*Aucune modification effectuée/);
    assert.deepEqual(await readdir(join(outside, 'skill')), []);
    await rm(join(app, discoveryDir));
    // 3. Fichier généré symlinké vers une cible externe, manifeste le déclarant périmé.
    const normal = await adopt(app, true); assert.equal(normal.applied, true); assert.deepEqual(normal.writtenGenerated, [orchestrationDiscovery]); assert.equal(normal.written.length, Object.keys(await orchestrationSources()).length);
    const target = join(outside, 'target.md'), stale = 'ancienne découverte externe\n'; await writeFile(target, stale);
    await rm(join(app, orchestrationDiscovery)); await symlink(target, join(app, orchestrationDiscovery), 'file');
    const manifestPath = join(app, orchestrationManifest), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.generated[orchestrationDiscovery] = sha(stale); manifest.kitVersion = '0.11.9'; await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    await refused(/Lien symbolique .*\.agents.*SKILL\.md.*Aucune modification effectuée/);
    assert.equal(await readFile(target, 'utf8'), stale, 'cible externe non écrasée'); assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).kitVersion, '0.11.9', 'manifeste non réécrit');
    await rm(join(app, orchestrationDiscovery)); await writeFile(join(app, orchestrationDiscovery), stale);
    const repaired = await adopt(app, true); assert.deepEqual(repaired.written, []); assert.deepEqual(repaired.writtenGenerated, [orchestrationDiscovery]);
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).kitVersion, '0.13.1');
    assert.equal((await adopt(app, true)).changed, false);
  });
});

// Ajout d'une ressource au standard = un fichier de plus dans le dossier canonique : create et adopt la distribuent sans modification de code.
test('a resource added to the canonical folder (P1 fixture) is distributed by create and adopt and stays usable from the generated project', async () => {
  await withTemp('lite-dist-fixture-', async (temp) => {
    const kit = await kitCopy(join(temp, 'kit'));
    for (const [file, content] of Object.entries(fixtures)) { await mkdir(dirname(join(kit, orchestrationDir, file)), { recursive: true }); await writeFile(join(kit, orchestrationDir, file), content); }
    const created = runCli(kit, ['create', '--spec', join(root, 'examples/services.json'), '--out', join(temp, 'app-fixture')]);
    assert.equal(created.status, 0, created.stderr);
    const app = join(temp, 'app-fixture'), manifest = JSON.parse(await readFile(join(app, orchestrationManifest), 'utf8'));
    for (const [file, content] of Object.entries(fixtures)) {
      const path = `${orchestrationDir}/${file}`;
      assert.equal(await readFile(join(app, path), 'utf8'), content, `copie exacte : ${path}`);
      assert.equal(manifest.files[path], sha(content), `empreinte du manifeste : ${path}`);
    }
    const discovery = await readFile(join(app, orchestrationDiscovery), 'utf8'), listed = backticked(discovery);
    for (const path of fixturePaths) assert.ok(listed.includes(path), `découverte : ${path}`);
    assert.ok(listed.includes(`node ${orchestrationDir}/scripts/fixture-future.mjs`) && listed.includes(`node ${planTool}`), 'le script fixture s’ajoute aux scripts réels, sans les remplacer');
    assert.equal(manifest.generated[orchestrationDiscovery], sha(discovery));
    assert.equal((await discoverSkills(app, '.agents/skills')).length, 1);
    const run = spawnSync(process.execPath, [`${orchestrationDir}/scripts/fixture-future.mjs`, 'validate', '--plan', 'plan.json'], { encoding: 'utf8', cwd: app, env: childEnv });
    assert.equal(run.status, 0, run.stderr); assert.deepEqual(JSON.parse(run.stdout), { fixture: 'P3', argv: ['validate', '--plan', 'plan.json'] });
    for (const path of [...planningResources, planTool]) assert.ok((await readFile(join(app, path))).equals(await readFile(join(root, path))), `ressource réelle intacte à côté de la fixture : ${path}`);

    // Application générée par le kit actuel : adopt depuis le kit enrichi ajoute exactement les nouvelles ressources et régénère la découverte.
    const existing = join(temp, 'app-existing');
    await createApp({ out: existing, spec: join(root, 'examples/catalogue.json') });
    const localRule = '---\ndescription: règle métier locale\nalwaysApply: true\n---\nRègle métier.\n'; await writeFile(join(existing, '.cursor/rules/metier.mdc'), localRule);
    const localAgents = await readFile(join(existing, 'AGENTS.md'), 'utf8');
    const inspect = runCli(kit, ['adopt', '--app', existing]); assert.equal(inspect.status, 0, inspect.stderr);
    const report = JSON.parse(inspect.stdout);
    assert.equal(report.status, 'outdated'); assert.equal(report.applied, false); assert.deepEqual(report.conflicts, []);
    assert.deepEqual([...report.pending].sort(), fixturePaths); for (const path of fixturePaths) assert.equal(report.files[path], 'missing');
    assert.deepEqual(report.generated, { [orchestrationDiscovery]: 'outdated' }, 'la liste des ressources a changé : découverte régénérée, jamais un conflit');
    assert.ok(Object.entries(report.files).filter(([p]) => !fixturePaths.includes(p)).every(([, s]) => s === 'current'));
    const apply = runCli(kit, ['adopt', '--app', existing, '--apply']); assert.equal(apply.status, 0, apply.stderr);
    const applied = JSON.parse(apply.stdout);
    assert.equal(applied.applied, true); assert.deepEqual([...applied.written].sort(), fixturePaths); assert.deepEqual(applied.writtenGenerated, [orchestrationDiscovery]);
    for (const [file, content] of Object.entries(fixtures)) assert.equal(await readFile(join(existing, orchestrationDir, file), 'utf8'), content);
    assert.equal(await readFile(join(existing, orchestrationDiscovery), 'utf8'), discovery);
    const second = JSON.parse(runCli(kit, ['adopt', '--app', existing, '--apply']).stdout);
    assert.equal(second.applied, false); assert.equal(second.changed, false); assert.equal(second.status, 'current');
    assert.equal(await readFile(join(existing, '.cursor/rules/metier.mdc'), 'utf8'), localRule); assert.equal(await readFile(join(existing, 'AGENTS.md'), 'utf8'), localAgents);

    // Sens inverse : le kit actuel voit les ressources fixture comme non gérées, les préserve, et régénère seulement la découverte.
    const reverse = await adopt(app);
    assert.equal(reverse.status, 'outdated'); assert.deepEqual([...reverse.unmanaged].sort(), fixturePaths); assert.deepEqual(reverse.conflicts, []); assert.deepEqual(reverse.pendingGenerated, [orchestrationDiscovery]);
    const reversed = await adopt(app, true);
    assert.deepEqual(reversed.written, []); assert.deepEqual(reversed.writtenGenerated, [orchestrationDiscovery]);
    for (const [file, content] of Object.entries(fixtures)) assert.equal(await readFile(join(app, orchestrationDir, file), 'utf8'), content, 'ressource préservée');
    assert.equal((await adopt(app, true)).changed, false);
  });
});

// P4 — recette composée : une application générée porte les cinq ressources P1 et l’outil P2 à l’octet ; le VRAI plan-missions distribué s’exécute
// hors kit, depuis l’application, sur ses propres exemples et reproduit l’oracle §5 de sa copie de PLANNING.md ; les ressources de planification sont
// gérées comme les autres (adoption idempotente, conflit local refusé sans écriture, règles et AGENTS.md de l’application intacts).
// Preuve de découverte statique et d’exécution du script : ce n’est pas une invocation réelle par un client Codex ou Cursor.
test('the real distributed plan-missions runs from a generated application on its own examples and reproduces the PLANNING oracle; planning resources are managed copies', async () => {
  await withTemp('lite-dist-composed-', async (temp) => {
    const app = join(temp, 'app');
    await createApp({ out: app, spec: join(root, 'examples/services.json') });
    const manifest = JSON.parse(await readFile(join(app, orchestrationManifest), 'utf8'));
    for (const path of [...planningResources, planTool]) {
      const copy = await readFile(join(app, path));
      assert.ok(copy.equals(await readFile(join(root, path))), `copie exacte : ${path}`);
      assert.equal(manifest.files[path], sha(copy), `empreinte du manifeste : ${path}`);
    }
    // Hors kit : seules les copies de l’application, sans bin/ ni runtime ; le script tourne depuis la racine du projet, en lecture seule, sans réseau.
    const standalone = join(temp, 'standalone');
    for (const dir of ['.cursor', '.agents']) await cp(join(app, dir), join(standalone, dir), { recursive: true });
    const planFile = `${orchestrationDir}/examples/planning-plan.json`, stateFile = `${orchestrationDir}/examples/planning-state.json`;
    const tool = (...args) => spawnSync(process.execPath, [planTool, ...args], { encoding: 'utf8', cwd: standalone, env: childEnv });
    const before = await snapshot(standalone);
    const validated = tool('validate', '--plan', planFile, '--state', stateFile);
    assert.equal(validated.status, 0, validated.stderr); assert.equal(validated.stderr, '');
    const validation = JSON.parse(validated.stdout);
    assert.equal(validation.command, 'validate'); assert.equal(validation.valid, true); assert.deepEqual(validation.errors, []); assert.deepEqual(validation.warnings, []);
    assert.deepEqual(validation.summary, { missions: 15, byKind: { dev: 14, review: 1 }, byStatus: { active: 1, closed: 1, delivered: 2, historical: 1, integrated: 1, pending: 9 } });
    const ready = tool('ready', '--plan', planFile, '--state', stateFile);
    assert.equal(ready.status, 0, ready.stderr); assert.equal(ready.stdout.trim().split('\n').length, 1);
    const report = JSON.parse(ready.stdout);
    const oracle = JSON.parse((await readFile(join(standalone, orchestrationDir, 'PLANNING.md'), 'utf8')).match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.deepEqual(report, oracle, 'le rapport du script distribué est exactement l’oracle §5 du contrat distribué');
    assert.equal(report.reliable, true); assert.equal(report.proposals.length, 6); assert.deepEqual(report.proposals.map(p => `${p.mission}:${p.step}`), ['J01:integrate', 'Z00:publish', 'A01:resume', 'C01:start', 'D01:start', 'G01:start']);
    const { maxActiveRuns, active, proposed, free, providerQuotaVerified, reviewBacklog } = report.capacity;
    assert.deepEqual({ maxActiveRuns, active, proposed, free, providerQuotaVerified, reviewBacklog }, { maxActiveRuns: 5, active: 1, proposed: 4, free: 0, providerQuotaVerified: false, reviewBacklog: { count: 2, max: 3 } });
    assert.equal(tool('ready', '--plan', planFile, '--state', stateFile).stdout, ready.stdout, 'déterministe');
    const examplesState = JSON.parse(await readFile(join(standalone, stateFile), 'utf8'));
    await writeFile(join(temp, 'null-capacity.json'), JSON.stringify({ ...examplesState, capacity: { ...examplesState.capacity, maxActiveRuns: null } }));
    const unreliable = tool('ready', '--plan', planFile, '--state', join(temp, 'null-capacity.json'));
    assert.equal(unreliable.status, 3); assert.equal(JSON.parse(unreliable.stdout).reliable, false); assert.deepEqual(JSON.parse(unreliable.stdout).proposals, []);
    await writeFile(join(temp, 'foreign.json'), JSON.stringify({ ...examplesState, missions: { ...examplesState.missions, ZZZ: { status: 'pending' } } }));
    const invalid = tool('validate', '--plan', planFile, '--state', join(temp, 'foreign.json'));
    assert.equal(invalid.status, 2); assert.deepEqual(JSON.parse(invalid.stdout).errors.map(e => e.code), ['state_mission_unknown']);
    assert.deepEqual(await snapshot(standalone), before, 'aucune écriture par l’outil');
    assert.doesNotMatch(await readFile(join(standalone, orchestrationDir, 'PLANNING.md'), 'utf8'), PRIVATE);
    assert.doesNotMatch(ready.stdout, PRIVATE);

    // Ressources de planification gérées comme les autres : adoption idempotente, conflit local refusé sans écriture, règles de l’application intactes.
    const localRule = '---\ndescription: règle métier locale\nalwaysApply: true\n---\nRègle métier.\n'; await writeFile(join(app, '.cursor/rules/metier.mdc'), localRule);
    const localAgents = await readFile(join(app, 'AGENTS.md'), 'utf8');
    const again = await adopt(app, true);
    assert.equal(again.applied, false); assert.equal(again.changed, false); assert.equal(again.status, 'current');
    const planningCopy = join(app, orchestrationDir, 'PLANNING.md'), original = await readFile(planningCopy, 'utf8');
    await writeFile(planningCopy, original + '\nNote locale non autorisée.\n');
    const conflict = await adopt(app);
    assert.equal(conflict.status, 'conflict'); assert.deepEqual(conflict.conflicts, [`${orchestrationDir}/PLANNING.md`]);
    const cursorBefore = await snapshot(join(app, '.cursor'));
    await assert.rejects(adopt(app, true), /Conflit local sur \.cursor\/skills\/lite-orchestration\/PLANNING\.md.*Aucune modification effectuée/);
    assert.deepEqual(await snapshot(join(app, '.cursor')), cursorBefore);
    assert.deepEqual((await doctor(app)).orchestration.conflicts, [`${orchestrationDir}/PLANNING.md`]);
    await writeFile(planningCopy, original);
    assert.equal((await adopt(app, true)).changed, false);
    assert.equal(await readFile(join(app, '.cursor/rules/metier.mdc'), 'utf8'), localRule); assert.equal(await readFile(join(app, 'AGENTS.md'), 'utf8'), localAgents);
    assert.equal((await doctor(app)).orchestration.status, 'current');
  });
});

// W01 — checkout Windows (`core.autocrlf=true`) : le CLI doit parser le frontmatter CRLF comme le LF, sans fork applicatif ni relâchement des champs.
test('CLI create and adopt accept LF and CRLF skill sources with the same discovery semantics and refuse malformed frontmatter without partial writes', async () => {
  const canonical = skillFrontmatter(await readFile(join(root, orchestrationDir, 'SKILL.md'), 'utf8'));
  assert.deepEqual(skillFrontmatter(toCrlf(await readFile(join(root, orchestrationDir, 'SKILL.md'), 'utf8'))), canonical);
  assert.throws(() => skillFrontmatter('---\r\nname: lite-orchestration\r\n---\r\ncorps\n'), /frontmatter/);
  assert.throws(() => skillFrontmatter('---\nname: lite-orchestration\ndescription:\n---\n'), /frontmatter/);
  assert.throws(() => skillFrontmatter('---\rname: x\rdescription: y\r---\r'), /frontmatter/);
  assert.throws(() => skillFrontmatter('---\r\nname: lite-orchestration\r\ndescription: ok\r\n---'), /frontmatter/);

  await withTemp('lite-dist-eol-', async (temp) => {
    const spec = join(root, 'examples/services.json');
    const expectCreated = async (kit, out, skillBytes) => {
      const created = runCli(kit, ['create', '--spec', spec, '--out', out]);
      assert.equal(created.status, 0, created.stderr);
      const report = JSON.parse(created.stdout);
      assert.equal(report.kitVersion, JSON.parse(await readFile(join(kit, 'package.json'), 'utf8')).version);
      const discovery = await readFile(join(out, orchestrationDiscovery), 'utf8');
      assert.deepEqual(skillFrontmatter(discovery), canonical);
      assert.match(discovery, /^---\nname: lite-orchestration\ndescription: .+\n---\n/);
      assert.equal(discovery.includes('\r'), false, 'la découverte générée reste LF');
      const copied = await readFile(join(out, orchestrationDir, 'SKILL.md'));
      assert.ok(copied.equals(skillBytes), 'copie applicative = octets du checkout kit, sans normalisation');
      const found = await discoverSkills(out, '.agents/skills');
      assert.equal(found.length, 1);
      assert.deepEqual({ folder: found[0].folder, name: found[0].name, description: found[0].description }, { folder: 'lite-orchestration', ...canonical });
      assert.equal((await doctor(out)).orchestration.status, 'current');
    };

    const lfKit = await kitCopy(join(temp, 'kit-lf'));
    const lfSkill = await readFile(join(lfKit, orchestrationDir, 'SKILL.md'));
    assert.equal(lfSkill.includes(0x0d), false);
    await expectCreated(lfKit, join(temp, 'app-lf'), lfSkill);

    const crlfKit = await kitCopy(join(temp, 'kit-crlf'));
    const crlfText = toCrlf(lfSkill.toString('utf8'));
    await writeKitSkill(crlfKit, crlfText);
    const crlfSkill = await readFile(join(crlfKit, orchestrationDir, 'SKILL.md'));
    assert.ok(crlfSkill.includes(0x0d));
    await expectCreated(crlfKit, join(temp, 'app-crlf'), crlfSkill);

    const existing = join(temp, 'app-adopt');
    await createApp({ out: existing, spec: join(root, 'examples/catalogue.json') });
    await rm(join(existing, '.cursor'), { recursive: true, force: true });
    await rm(join(existing, '.agents'), { recursive: true, force: true });
    const inspect = runCli(crlfKit, ['adopt', '--app', existing]);
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.equal(JSON.parse(inspect.stdout).applied, false);
    const apply = runCli(crlfKit, ['adopt', '--app', existing, '--apply']);
    assert.equal(apply.status, 0, apply.stderr);
    const applied = JSON.parse(apply.stdout);
    assert.equal(applied.applied, true);
    assert.ok(applied.written.includes(`${orchestrationDir}/SKILL.md`));
    assert.deepEqual(applied.writtenGenerated, [orchestrationDiscovery]);
    assert.ok((await readFile(join(existing, orchestrationDir, 'SKILL.md'))).equals(crlfSkill));
    const adoptedDiscovery = await readFile(join(existing, orchestrationDiscovery), 'utf8');
    assert.deepEqual(skillFrontmatter(adoptedDiscovery), canonical);
    assert.equal(adoptedDiscovery.includes('\r'), false);
    const second = JSON.parse(runCli(crlfKit, ['adopt', '--app', existing, '--apply']).stdout);
    assert.equal(second.applied, false); assert.equal(second.status, 'current');

    const badKit = await kitCopy(join(temp, 'kit-bad'));
    await writeKitSkill(badKit, '---\r\nname: lite-orchestration\r\n---\r\ncorps\n');
    const refusedOut = join(temp, 'app-refused');
    const refusedCreate = runCli(badKit, ['create', '--spec', spec, '--out', refusedOut]);
    assert.equal(refusedCreate.status, 1);
    assert.match(refusedCreate.stderr, /frontmatter YAML avec `name` et `description` sur une ligne attendu/);
    await assert.rejects(stat(refusedOut), { code: 'ENOENT' });

    const victim = join(temp, 'app-victim');
    await createApp({ out: victim, spec: join(root, 'examples/services.json') });
    const before = await snapshot(victim);
    const refusedAdopt = runCli(badKit, ['adopt', '--app', victim, '--apply']);
    assert.equal(refusedAdopt.status, 1);
    assert.match(refusedAdopt.stderr, /frontmatter YAML avec `name` et `description` sur une ligne attendu/);
    assert.deepEqual(await snapshot(victim), before, 'aucune écriture partielle après frontmatter kit invalide');
  });
});
