import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KIT = 'creezio/creezio-lite';
const marker = version => `<!-- creezio-lite-update:v${version} -->`;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareVersions(left, right) {
  if (!versionPattern.test(left) || !versionPattern.test(right)) throw new Error('Version stable x.y.z attendue.');
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function githubClient(token, fetchImpl = fetch) {
  if (!token) throw new Error('GITHUB_TOKEN est requis.');
  return async function api(path, { method = 'GET', body, allow404 = false } = {}) {
    if (!path.startsWith('/repos/') || /[\r\n]/.test(path)) throw new Error('Chemin API non autorisé.');
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} : HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
}

export async function allIssues(api, repository) {
  const items = [];
  for (let page = 1; ; page++) {
    const rows = await api(`/repos/${repository}/issues?state=all&per_page=100&page=${page}`);
    items.push(...rows.filter(row => !row.pull_request));
    if (rows.length < 100) return items;
  }
}

export async function releaseCommit(api, tag) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) throw new Error('Tag de version invalide.');
  let object = (await api(`/repos/${KIT}/git/ref/tags/${tag}`)).object;
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) {
    object = (await api(`/repos/${KIT}/git/tags/${object.sha}`)).object;
  }
  if (object.type !== 'commit' || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error('Le tag ne désigne pas un commit immuable.');
  return object.sha;
}

export function updateBody({ current, target, sha }) {
  return `${marker(target)}
Une version validée de **Creezio Lite** est disponible pour cette application.

- Version déclarée à la détection : **${current}**.
- Version cible : **${target}** ; commit exact : \`${sha}\`.
- [Release et changements](https://github.com/${KIT}/releases/tag/v${target}).
- [Guide de mise à jour](https://github.com/${KIT}/blob/${sha}/docs/UPDATES.md).
- [Comparer les changements du kit](https://github.com/${KIT}/blob/${sha}/CHANGELOG.md).

Responsable : le pilote de cette application. Reprendre une PR de mise à jour existante avant d'en créer une autre.

- [ ] Partir du main actuel de l'application et du commit exact du kit ci-dessus.
- [ ] Lire AGENTS.md et le guide ; exécuter doctor puis upgrade en lecture seule.
- [ ] Appliquer l'upgrade compatible ou fusionner explicitement les adaptations ; préserver métier, données, migrations appliquées, secrets et identité Sites.
- [ ] Contrôler aussi les fichiers hors runtime (scripts, workflows, pages, dépendances) ; l'upgrade du runtime ne les remplace pas.
- [ ] Ouvrir une PR liée à cette issue ; relire, tester les régressions, les droits et les parcours modifiés, vérifier typecheck/build et CI avant fusion.
- [ ] Consigner séparément la fusion dans le dépôt et la vérification du déploiement existant, dans le cadre du mandat de l'application.

La veille peut constater que la version est intégrée au dépôt grâce à lite.lock.json. Le pilote clôt cette issue après les tests et la vérification du déploiement prévu, ou consigne explicitement un report. Ne jamais modifier ce verrou pour masquer un conflit ou simuler une mise à jour.
`;
}

export async function checkUpdate({ api, repository, lock }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || repository === KIT) throw new Error('Dépôt applicatif GitHub attendu.');
  if (lock.sourceRepository !== `https://github.com/${KIT}.git` && lock.sourceRepository !== `https://github.com/${KIT}`) throw new Error('Cette application ne déclare pas Creezio Lite comme source.');
  compareVersions(lock.kitVersion, lock.kitVersion);
  const release = await api(`/repos/${KIT}/releases/latest`, { allow404: true });
  if (!release) return { status: 'no-release' };
  if (release.draft || release.prerelease) throw new Error('La release cible doit être stable et publiée.');
  const target = release.tag_name.replace(/^v/, '');
  compareVersions(target, target);
  const sha = await releaseCommit(api, release.tag_name);
  const metadata = await api(`/repos/${KIT}/contents/package.json?ref=${sha}`);
  const pkg = JSON.parse(Buffer.from(metadata.content, 'base64').toString('utf8'));
  if (pkg.version !== target) throw new Error('La version du tag et celle du commit ne correspondent pas.');
  const issues = await allIssues(api, repository);
  // Only the application owner can attest tests and deployment; never close an issue here.
  if (compareVersions(lock.kitVersion, target) >= 0) {
    const pending = issues.filter(issue => issue.state === 'open' && issue.body?.includes('<!-- creezio-lite-update:v'));
    return { status: pending.length ? 'integrated-awaiting-verification' : 'current', current: lock.kitVersion, target, pending: pending.map(issue => issue.html_url) };
  }
  const existing = issues.find(issue => issue.body?.includes(marker(target)));
  if (existing) {
    if (existing.state === 'closed' && existing.state_reason !== 'not_planned') {
      await api(`/repos/${repository}/issues/${existing.number}`, { method: 'PATCH', body: { state: 'open', state_reason: 'reopened' } });
    }
    return { status: existing.state_reason === 'not_planned' ? 'deferred' : 'already-notified', target, issue: existing.html_url };
  }
  const issue = await api(`/repos/${repository}/issues`, { method: 'POST', body: {
    title: `Creezio Lite ${target} — mise à jour à intégrer`, body: updateBody({ current: lock.kitVersion, target, sha }),
  } });
  return { status: 'notified', target, issue: issue.html_url };
}

async function main() {
  const lock = JSON.parse(await readFile('lite.lock.json', 'utf8'));
  const result = await checkUpdate({ api: githubClient(process.env.GITHUB_TOKEN), repository: process.env.GITHUB_REPOSITORY, lock });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Veille Creezio Lite\n\nÉtat : **${result.status}**. ${result.issue ? `[Suivi de la mise à jour](${result.issue})` : ''}\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
