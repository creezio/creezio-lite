import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT, compareVersions, githubClient, releaseCommit } from '../template/scripts/check-lite-update.mjs';

export function releaseNotes(changelog, version, sha) {
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find(value => value.startsWith(`${version} `) || value.startsWith(`${version}\n`));
  if (!section || !sections[0].startsWith(version)) throw new Error('Le changelog doit commencer par la version publiée.');
  return `## ${section.trim()}\n\nCommit validé : \`${sha}\`.\n\n[Procédure de mise à jour](https://github.com/${KIT}/blob/${sha}/docs/UPDATES.md). Chaque application reçoit une issue via sa veille GitHub Actions ; ses tests et sa publication restent sous la responsabilité de son pilote.\n`;
}

export async function publishRelease({ api, repository, sha, version, changelog }) {
  if (repository !== KIT || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Publication réservée au dépôt du kit et à un SHA exact.');
  compareVersions(version, version);
  const body = releaseNotes(changelog, version, sha);
  const main = await api(`/repos/${KIT}/git/ref/heads/main`);
  if (main.object.sha !== sha) return { status: 'superseded', sha };
  const runs = await api(`/repos/${KIT}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`);
  const latest = runs.workflow_runs.filter(run => run.head_sha === sha && run.event === 'push' && run.head_branch === 'main' && run.head_repository?.full_name === KIT)
    .sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') throw new Error('La CI de main doit réussir sur le commit exact avant publication.');
  const tag = `v${version}`;
  const existing = await api(`/repos/${KIT}/releases/tags/${tag}`, { allow404: true });
  if (existing) {
    if (existing.draft || existing.prerelease || await releaseCommit(api, tag) !== sha) throw new Error('Cette version est déjà réservée à un autre état : augmenter la version, ne jamais déplacer le tag.');
    return { status: 'already-published', version, sha, url: existing.html_url };
  }
  const previous = await api(`/repos/${KIT}/releases/latest`, { allow404: true });
  if (previous && compareVersions(version, previous.tag_name.replace(/^v/, '')) <= 0) throw new Error('La nouvelle version doit être supérieure à la dernière release.');
  const ref = await api(`/repos/${KIT}/git/ref/tags/${tag}`, { allow404: true });
  if (ref && await releaseCommit(api, tag) !== sha) throw new Error('Le tag existe sur un autre commit ; aucun déplacement autorisé.');
  // Recheck after reads, so a newer main is not accidentally described as this release.
  if ((await api(`/repos/${KIT}/git/ref/heads/main`)).object.sha !== sha) return { status: 'superseded', sha };
  const release = await api(`/repos/${KIT}/releases`, { method: 'POST', body: { tag_name: tag, target_commitish: sha, name: `Creezio Lite ${version}`, body, draft: false, prerelease: false, make_latest: 'true' } });
  return { status: 'published', version, sha, url: release.html_url };
}

async function main() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const result = await publishRelease({ api: githubClient(process.env.GITHUB_TOKEN), repository: process.env.GITHUB_REPOSITORY, sha: process.env.RELEASE_SHA, version: pkg.version, changelog: await readFile('CHANGELOG.md', 'utf8') });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
