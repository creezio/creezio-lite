import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdate, compareVersions, githubClient, KIT, releaseCommit } from '../template/scripts/check-lite-update.mjs';
import { publishRelease } from '../scripts/publish-release.mjs';

const sha = 'a'.repeat(40), repo = 'example/application';
const lock = { sourceRepository: `https://github.com/${KIT}.git`, kitVersion: '0.9.0' };
const release = { tag_name: 'v0.10.1', draft: false, prerelease: false, html_url: `https://github.com/${KIT}/releases/tag/v0.10.1` };
function fixture({ issues = [], version = '0.10.1', latest = release, refSha = sha, ci = 'success' } = {}) {
  const writes = [], state = [...issues];
  const api = async (path, options = {}) => {
    if (options.method && options.method !== 'GET') {
      writes.push({ path, ...options });
      if (path === `/repos/${repo}/issues`) { const issue = { ...options.body, number: 10, state: 'open', html_url: 'https://github.com/example/application/issues/10' }; state.push(issue); return issue; }
      if (path === `/repos/${KIT}/releases`) return { html_url: release.html_url };
      return {};
    }
    if (path.endsWith('/releases/latest')) return latest;
    if (path.includes('/releases/tags/')) return null;
    if (path.includes('/git/ref/')) return { object: { type: 'commit', sha: refSha } };
    if (path.includes('/contents/package.json')) return { content: Buffer.from(JSON.stringify({ version })).toString('base64') };
    if (path.includes('/actions/workflows/')) return { workflow_runs: [{ id: 42, head_sha: sha, head_branch: 'main', head_repository: { full_name: KIT }, event: 'push', status: 'completed', conclusion: ci }] };
    if (path.includes('/issues?')) return state;
    throw new Error(`Unexpected API call: ${path}`);
  };
  return { api, writes, state };
}

test('stable versions compare numerically and reject malformed or prerelease versions', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  for (const value of ['1.2', '01.2.3', '1.2.3-rc.1', '1.2.3;echo x']) assert.throws(() => compareVersions(value, '1.0.0'));
});

test('a new validated release creates one durable issue, repeated checks create none', async () => {
  const f = fixture();
  assert.equal((await checkUpdate({ ...f, repository: repo, lock })).status, 'notified');
  assert.match(f.writes[0].body.body, new RegExp(sha));
  assert.equal((await checkUpdate({ ...f, repository: repo, lock })).status, 'already-notified');
  assert.equal(f.writes.length, 1);
});

test('absent releases and up-to-date applications do not create issues', async () => {
  for (const [f, current, expected] of [[fixture({ latest: null }), lock, 'no-release'], [fixture(), { ...lock, kitVersion: '0.10.1' }, 'current'], [fixture(), { ...lock, kitVersion: '0.14.0' }, 'current']]) {
    assert.equal((await checkUpdate({ ...f, repository: repo, lock: current })).status, expected);
    assert.equal(f.writes.length, 0);
  }
});

test('prereleases, wrong source, and inconsistent tag/package cannot notify', async () => {
  for (const [f, current] of [[fixture({ latest: { ...release, prerelease: true } }), lock], [fixture({ version: '0.10.0' }), lock], [fixture(), { ...lock, sourceRepository: 'https://example.com/kit.git' }]]) {
    await assert.rejects(checkUpdate({ ...f, repository: repo, lock: current }));
    assert.equal(f.writes.length, 0);
  }
});

test('an integrated lockfile never closes the issue or pretends that deployment was verified', async () => {
  const f = fixture({ issues: [{ number: 2, state: 'open', body: '<!-- creezio-lite-update:v0.10.1 -->' }, { number: 3, state: 'open', body: 'Unrelated issue' }] });
  const result = await checkUpdate({ ...f, repository: repo, lock: { ...lock, kitVersion: '0.10.1' } });
  assert.equal(result.status, 'integrated-awaiting-verification');
  assert.equal(f.writes.length, 0);
});

test('manual deferral is preserved; premature completion is reopened without duplication', async () => {
  for (const reason of ['not_planned', 'completed']) {
    const f = fixture({ issues: [{ number: 2, state: 'closed', state_reason: reason, body: '<!-- creezio-lite-update:v0.10.1 -->' }] });
    await checkUpdate({ ...f, repository: repo, lock });
    assert.equal(f.writes.length, reason === 'not_planned' ? 0 : 1);
    if (f.writes.length) assert.equal(f.writes[0].body.state, 'open');
  }
});

test('issue pagination does not duplicate a notification on a later page', async () => {
  const f = fixture(), original = f.api;
  f.api = async (path, opts) => path.includes('/issues?') ? (path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ number: i, state: 'open', body: 'Other' })) : [{ number: 101, state: 'open', body: '<!-- creezio-lite-update:v0.10.1 -->' }]) : original(path, opts);
  assert.equal((await checkUpdate({ ...f, repository: repo, lock })).status, 'already-notified');
  assert.equal(f.writes.length, 0);
});

test('annotated release tags resolve to a commit, never to arbitrary refs', async () => {
  const api = async path => ({ object: { type: path.includes('/git/tags/') ? 'commit' : 'tag', sha } });
  assert.equal(await releaseCommit(api, 'v0.10.1'), sha);
  await assert.rejects(releaseCommit(api, '../main'));
});

const publication = { repository: KIT, sha, version: '0.10.1', changelog: '# Versions\n\n## 0.10.1 — Notifications\n\n- Suivi.\n\n## 0.10.0\nAncien.' };
test('publication requires green CI on the exact current main and creates an immutable release', async () => {
  const f = fixture({ latest: null });
  assert.equal((await publishRelease({ ...f, ...publication })).status, 'published');
  assert.equal(f.writes[0].body.target_commitish, sha);
  assert.equal(f.writes[0].body.tag_name, 'v0.10.1');
  assert.doesNotMatch(f.writes[0].body.body, /Ancien/);
  const failed = fixture({ ci: 'failure' });
  await assert.rejects(publishRelease({ ...failed, ...publication }), /CI/);
  assert.equal(failed.writes.length, 0);
  const stale = fixture({ refSha: 'b'.repeat(40) });
  assert.equal((await publishRelease({ ...stale, ...publication })).status, 'superseded');
  assert.equal(stale.writes.length, 0);
});

test('existing releases are idempotent and tags are never retargeted', async () => {
  const f = fixture(), original = f.api;
  f.api = (path, opts) => path.includes('/releases/tags/') ? release : original(path, opts);
  assert.equal((await publishRelease({ ...f, ...publication })).status, 'already-published');
  assert.equal(f.writes.length, 0);
  f.api = (path, opts) => path.includes('/git/ref/tags/') ? { object: { type: 'commit', sha: 'b'.repeat(40) } } : path.includes('/releases/tags/') ? release : original(path, opts);
  await assert.rejects(publishRelease({ ...f, ...publication }), /déjà réservée/);
  assert.equal(f.writes.length, 0);
});

test('API errors stop processing and never expose a token or response body', async () => {
  const api = githubClient('PRIVATE_TEST_SECRET', async (_url, opts) => {
    assert.equal(opts.redirect, 'error');
    return { status: 403, ok: false, text: async () => 'PRIVATE_TEST_SECRET' };
  });
  await assert.rejects(api(`/repos/${KIT}/releases/latest`), error => /HTTP 403/.test(error.message) && !error.message.includes('PRIVATE_TEST_SECRET'));
});
