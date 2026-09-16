import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, cp, readdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createApp, doctor, adopt, inspectOrchestration, orchestrationSources, orchestrationGenerated, renderDiscovery, skillFrontmatter, orchestrationDir, orchestrationManifest, orchestrationRule, orchestrationDiscovery } from '../bin/lite.mjs';

// P3 — distribution et découverte du standard. Les ressources P1/P2 (PLANNING.md, schémas, exemples, plan-missions.mjs) ne sont pas
// sur cette branche : les fichiers ci-dessous sont des FIXTURES de distribution, identifiées comme telles, qui n'implémentent aucun format.
const root = fileURLToPath(new URL('../', import.meta.url));
const FIXTURE_NOTE = 'FIXTURE P3 (test de distribution) — remplaçant provisoire sans valeur contractuelle ; les vrais fichiers P1/P2 remplaceront ce contenu.';
const fixtures = {
  'PLANNING.md': `# ${FIXTURE_NOTE}\n`,
  'planning-plan.schema.json': JSON.stringify({ $comment: FIXTURE_NOTE }, null, 2) + '\n',
  'examples/planning-plan.json': JSON.stringify({ $comment: FIXTURE_NOTE }, null, 2) + '\n',
  'scripts/plan-missions.mjs': `// ${FIXTURE_NOTE}\nconsole.log(JSON.stringify({ fixture: 'P3', argv: process.argv.slice(2) }));\n`,
};
const fixturePaths = Object.keys(fixtures).map(f => `${orchestrationDir}/${f}`).sort();
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
  // Pure fonction : une ressource future (référence ou script) apparaît dans la bonne section sans autre code.
  const future = renderDiscovery(canonical, [...Object.keys(sources), `${orchestrationDir}/PLANNING.md`, `${orchestrationDir}/examples/planning-plan.json`, `${orchestrationDir}/scripts/plan-missions.mjs`]);
  const [references, scripts] = future.split('## Scripts distribués');
  assert.ok(references.includes(`\`${orchestrationDir}/PLANNING.md\``) && references.includes(`\`${orchestrationDir}/examples/planning-plan.json\``));
  assert.ok(scripts.includes(`\`node ${orchestrationDir}/scripts/plan-missions.mjs\``) && scripts.includes(`\`node ${orchestrationDir}/scripts/cursor-agents.mjs\``));
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
    assert.ok(referenced.length >= 5);
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
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).kitVersion, '0.12.0');
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
    assert.ok(listed.includes(`node ${orchestrationDir}/scripts/plan-missions.mjs`));
    assert.equal(manifest.generated[orchestrationDiscovery], sha(discovery));
    assert.equal((await discoverSkills(app, '.agents/skills')).length, 1);
    const run = spawnSync(process.execPath, [`${orchestrationDir}/scripts/plan-missions.mjs`, 'validate', '--plan', 'plan.json'], { encoding: 'utf8', cwd: app, env: childEnv });
    assert.equal(run.status, 0, run.stderr); assert.deepEqual(JSON.parse(run.stdout), { fixture: 'P3', argv: ['validate', '--plan', 'plan.json'] });
    assert.doesNotMatch(await readFile(join(kit, orchestrationDir, 'PLANNING.md'), 'utf8'), PRIVATE);

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
