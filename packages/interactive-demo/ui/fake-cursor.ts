/**
 * Faux curseur de la démo interactive — curseur visuel animé (Web Animations
 * API) qui se déplace jusqu'à la cible puis « clique » (halo). Singleton DOM
 * hors React pour survivre aux navigations App Router. Indépendant du
 * curseur de l'assistant (`@creezio/assistant`) : la démo est un scénario
 * scripté, pas une action LLM.
 *
 * Styles : classes `.creezio-demo-*` (feuille `interactive-demo.css`).
 */

const CURSOR_ID = "creezio-demo-cursor";
const HIDE_DELAY_MS = 2600;

const CURSOR_SVG = `
<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 2.5 L4 18.5 L8.2 14.8 L11 21 L13.6 19.8 L10.9 13.8 L16.5 13.3 Z"
    fill="var(--creezio-demo-accent, #7c3aed)" stroke="white" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;

class DemoCursor {
  private el: HTMLDivElement | null = null;
  private badge: HTMLDivElement | null = null;
  private x = 0;
  private y = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private currentAnim: Animation | null = null;

  private ensure(): HTMLDivElement {
    if (this.el && document.body.contains(this.el)) return this.el;

    const wrap = document.createElement("div");
    wrap.id = CURSOR_ID;
    wrap.className = "creezio-demo-cursor";
    wrap.setAttribute("data-creezio-demo-ui", "1");
    wrap.innerHTML = CURSOR_SVG;

    const badge = document.createElement("div");
    badge.textContent = "Démo";
    badge.className = "creezio-demo-cursor-badge";
    wrap.appendChild(badge);

    document.body.appendChild(wrap);
    this.el = wrap;
    this.badge = badge;

    // Position de départ : centre de l'écran.
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2;
    wrap.style.transform = `translate(${this.x}px, ${this.y}px)`;
    return wrap;
  }

  setLabel(text: string) {
    this.ensure();
    if (this.badge) this.badge.textContent = text;
  }

  show() {
    const el = this.ensure();
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    el.style.opacity = "1";
  }

  hide() {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.el) {
      this.el.style.opacity = "0";
      /* Terminer / Quitter : retirer le nœud. hide() historique laissait
         #creezio-demo-cursor (data-creezio-demo-ui) → E2E « overlay reste ». */
      this.el.remove();
      this.el = null;
      this.badge = null;
    }
  }

  hideSoon(delayMs = HIDE_DELAY_MS) {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.el) this.el.style.opacity = "0";
    }, delayMs);
  }

  /** Déplacement fluide vers (x, y) viewport — durée proportionnelle à la distance. */
  moveTo(x: number, y: number): Promise<void> {
    const el = this.ensure();
    this.show();
    this.currentAnim?.cancel();

    const dx = x - this.x;
    const dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    const duration = Math.max(360, Math.min(1200, dist * 1.4));

    return new Promise((resolve) => {
      const anim = el.animate(
        [
          { transform: `translate(${this.x}px, ${this.y}px)` },
          { transform: `translate(${x}px, ${y}px)` },
        ],
        { duration, easing: "cubic-bezier(.3,.9,.35,1)", fill: "forwards" },
      );
      this.currentAnim = anim;
      const finish = () => {
        this.x = x;
        this.y = y;
        el.style.transform = `translate(${x}px, ${y}px)`;
        try {
          anim.cancel();
        } catch {
          /* ignore */
        }
        resolve();
      };
      anim.onfinish = finish;
      anim.oncancel = () => resolve();
    });
  }

  /** Halo de clic à la position courante. */
  clickEffect(): Promise<void> {
    this.ensure();
    const ripple = document.createElement("div");
    ripple.className = "creezio-demo-click-ripple";
    ripple.setAttribute("data-creezio-demo-ui", "1");
    ripple.style.left = `${this.x - 18}px`;
    ripple.style.top = `${this.y - 18}px`;
    document.body.appendChild(ripple);
    return new Promise((resolve) => {
      const anim = ripple.animate(
        [
          { transform: "scale(.35)", opacity: 1 },
          { transform: "scale(1.8)", opacity: 0 },
        ],
        { duration: 460, easing: "ease-out" },
      );
      const done = () => {
        ripple.remove();
        resolve();
      };
      anim.onfinish = done;
      anim.oncancel = done;
    });
  }

  get position() {
    return { x: this.x, y: this.y };
  }
}

let singleton: DemoCursor | null = null;

export function getDemoCursor(): DemoCursor {
  if (!singleton) singleton = new DemoCursor();
  return singleton;
}
