/**
 * Preuve UI I7 — modèle nav (core + brand) sans hardcode métier kit.
 * En Electron packagé, le HTML peut être injecté depuis main via adapter.
 */
(function () {
  const mount = document.getElementById("creezio-nav-mount");
  if (!mount) return;
  // Miroir du modèle createNavShellAdapter (statique pour renderer sans preload).
  const model = {
    groups: [
      {
        id: "core",
        label: "Creezio",
        items: [
          { label: "Accueil", href: "/" },
          { label: "Réglages", href: "/settings" },
          { label: "Assistant", href: "/assistant" },
        ],
      },
      {
        id: "brand",
        label: "Métier",
        items: [{ label: "Notes", href: "/notes" }],
      },
    ],
  };
  const parts = ['<nav class="creezio-nav" data-creezio-shell-ui="i7">'];
  for (const g of model.groups) {
    parts.push('<div class="creezio-nav__group">');
    parts.push(
      '<div style="font-size:0.8rem;opacity:0.7;margin:1rem 0 0.35rem">' +
        g.label +
        "</div><ul>",
    );
    for (const item of g.items) {
      parts.push(
        "<li><a href=\"" + item.href + "\">" + item.label + "</a></li>",
      );
    }
    parts.push("</ul></div>");
  }
  parts.push("</nav>");
  mount.innerHTML = parts.join("");
})();
