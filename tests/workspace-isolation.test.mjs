import './register-ui-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { createElement: h, useState } = await import('react');
const { create, act } = await import('react-test-renderer');
const { Children, ChildrenContext, ElementsContext, Slot, BfcacheIdentityMapContext } = await import('vinext/shims/slot');
const { KeepAliveOutlet, WorkspacePaneRouterContext, invalidateKeepAlive } = await import('../runtime/modules/shell-ui/ui/workspace/keep-alive.tsx');
const { LayoutRouterContext } = await import('vinext/shims/internal/app-router-context');
const { SitesPaneRouter } = await import('../template/app/sites-pane-router.tsx');
const { AppShell } = await import('../runtime/modules/shell-ui/ui/layout/app-shell.tsx');
const { configureTabWorkspaceHost } = await import('../runtime/modules/shell-ui/ui/workspace/tab-workspace-host.ts');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const titleByHref = new Map();
const workspace = { ready: true, setTabMeta: (href, meta) => titleByHref.set(href, meta.title) };
configureTabWorkspaceHost({ useTabWorkspace: () => workspace, useOpenTab: () => () => {} });
function Page({ title }) {
  const [draft, setDraft] = useState('');
  return h(AppShell, { title }, h('h1', null, title), h('input', {
    value: draft, onChange: e => setDraft(e.target.value),
  }));
}
// The same live Children/Slot elements used by Vinext's root layout.
// Merely retaining <Children/> does not retain its context or the page it resolves.
function Tree({ route, active = route, revision = '' }) {
  const title = ({ '/clients': 'Clients', '/dossiers': 'Dossiers', '/support': 'Support' })[route.split('?')[0]];
  return h(ElementsContext.Provider, { value: { 'page:/[moduleId]': h(Page, { title: title + revision }) } },
    h(BfcacheIdentityMapContext.Provider, { value: { 'page:/[moduleId]': route } },
      h(ChildrenContext.Provider, { value: h(Slot, { id: 'page:/[moduleId]' }) },
        h(WorkspacePaneRouterContext.Provider, { value: SitesPaneRouter },
          h(KeepAliveOutlet, { routeKey: route, activeHref: active }, h(Children))))));
}
test('Switching Lite panes retains each Vinext page, title and unsaved form', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  let root;
  try {
    await act(() => { root = create(h(Tree, { route: '/clients' })); });
    const pane = href => root.root.findByProps({ 'data-workspace-pane': href });
    await act(() => pane('/clients').findByType('input').props.onChange({ target: { value: 'Client en cours' } }));
    await act(() => root.update(h(Tree, { route: '/dossiers' })));
    assert.equal(pane('/clients').findByType('h1').children.join(''), 'Clients');
    assert.equal(pane('/clients').findByType('input').props.value, 'Client en cours');
    assert.equal(titleByHref.get('/clients'), 'Clients');
    assert.equal(pane('/dossiers').findByType('h1').children.join(''), 'Dossiers');
    assert.equal(titleByHref.get('/dossiers'), 'Dossiers');
    await act(() => pane('/dossiers').findByType('input').props.onChange({ target: { value: 'Dossier en cours' } }));
    // Optimistic switch to a cached tab, before its route payload arrives.
    await act(() => root.update(h(Tree, { route: '/dossiers', active: '/clients' })));
    assert.equal(pane('/clients').props['data-active'], 'true');
    assert.equal(pane('/clients').findByType('input').props.value, 'Client en cours');
    // A cold target shows a placeholder, never the previous page.
    await act(() => root.update(h(Tree, { route: '/dossiers', active: '/support' })));
    assert.equal(root.root.findAllByProps({ 'data-workspace-pane-placeholder': '/support' }).length, 1);
    assert.equal(pane('/dossiers').props['data-active'], 'false');
    await act(() => root.update(h(Tree, { route: '/support' })));
    for (const route of ['/clients', '/dossiers', '/support', '/dossiers', '/clients']) {
      await act(() => root.update(h(Tree, { route })));
      assert.equal(pane('/clients').findByType('input').props.value, 'Client en cours');
      assert.equal(pane('/dossiers').findByType('input').props.value, 'Dossier en cours');
      assert.equal(titleByHref.get('/clients'), 'Clients');
      assert.equal(titleByHref.get('/dossiers'), 'Dossiers');
      assert.equal(titleByHref.get('/support'), 'Support');
      assert.equal(root.root.findAll(n => n.props['data-workspace-pane'] && n.props['data-active'] === 'true').length, 1);
    }
    // Refreshing the current route still delivers fresh content only to it.
    await act(() => root.update(h(Tree, { route: '/clients', revision: ' actualisés' })));
    assert.equal(pane('/clients').findByType('h1').children.join(''), 'Clients actualisés');
    assert.equal(pane('/clients').findByType('input').props.value, 'Client en cours');
    assert.equal(titleByHref.get('/dossiers'), 'Dossiers');
    // Closing an inactive tab invalidates only its pane.
    await act(() => invalidateKeepAlive('/support'));
    assert.equal(root.root.findAllByProps({ 'data-workspace-pane': '/support' }).length, 0);
    assert.equal(pane('/dossiers').findByType('input').props.value, 'Dossier en cours');
    // Query-specific panes retain their own unsaved state as well.
    await act(() => root.update(h(Tree, { route: '/clients?view=archive' })));
    await act(() => pane('/clients?view=archive').findByType('input').props.onChange({ target: { value: 'Archives' } }));
    await act(() => root.update(h(Tree, { route: '/dossiers' })));
    assert.equal(pane('/clients?view=archive').findByType('input').props.value, 'Archives');
    assert.equal(pane('/clients').findByType('input').props.value, 'Client en cours');
  } finally {
    if (root) await act(() => root.unmount());
    globalThis.window = previousWindow;
  }
});

test('Without the Sites bridge, the native Next LayoutRouter freeze still isolates pages', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const { useContext } = await import('react');
  function NextRoute() { return h('h1', null, useContext(LayoutRouterContext)); }
  function NextTree({ route }) {
    return h(LayoutRouterContext.Provider, { value: route },
      h(KeepAliveOutlet, { routeKey: route, activeHref: route }, h(NextRoute)));
  }
  let root;
  try {
    await act(() => { root = create(h(NextTree, { route: '/clients' })); });
    await act(() => root.update(h(NextTree, { route: '/support' })));
    assert.equal(root.root.findByProps({ 'data-workspace-pane': '/clients' }).findByType('h1').children[0], '/clients');
    assert.equal(root.root.findByProps({ 'data-workspace-pane': '/support' }).findByType('h1').children[0], '/support');
  } finally {
    if (root) await act(() => root.unmount());
    globalThis.window = previousWindow;
  }
});
