/**
 * Souris virtuelle de l'assistant — curseur visuel animé qui se déplace
 * jusqu'à la cible puis « clique » (halo). Singleton DOM hors React pour
 * survivre aux navigations App Router.
 */

const CURSOR_ID = "creezio-fake-cursor";
const HIDE_DELAY_MS = 3500;

const CURSOR_SVG = `
<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 2.5 L4 18.5 L8.2 14.8 L11 21 L13.6 19.8 L10.9 13.8 L16.5 13.3 Z"
    fill="#0284c7" stroke="white" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;

class FakeCursor {
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
    wrap.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "z-index:2147483000",
      "pointer-events:none",
      "opacity:0",
      "transition:opacity 220ms ease",
      "will-change:transform",
      "filter:drop-shadow(0 2px 5px rgba(2,132,199,.45))",
    ].join(";");
    wrap.innerHTML = CURSOR_SVG;

    const badge = document.createElement("div");
    badge.textContent = "IA";
    badge.style.cssText = [
      "position:absolute",
      "left:18px",
      "top:20px",
      "background:#0284c7",
      "color:white",
      "font:600 9px/1 system-ui,sans-serif",
      "letter-spacing:.06em",
      "padding:3px 6px",
      "border-radius:9999px",
      "border:1.5px solid white",
      "white-space:nowrap",
    ].join(";");
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
    const duration = Math.max(320, Math.min(1100, dist * 1.35));

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
    ripple.style.cssText = [
      "position:fixed",
      `left:${this.x - 16}px`,
      `top:${this.y - 16}px`,
      "width:32px",
      "height:32px",
      "border-radius:9999px",
      "border:2.5px solid #0284c7",
      "background:rgba(2,132,199,.18)",
      "z-index:2147482999",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(ripple);
    return new Promise((resolve) => {
      const anim = ripple.animate(
        [
          { transform: "scale(.4)", opacity: 1 },
          { transform: "scale(1.7)", opacity: 0 },
        ],
        { duration: 420, easing: "ease-out" },
      );
      anim.onfinish = () => {
        ripple.remove();
        resolve();
      };
      anim.oncancel = () => {
        ripple.remove();
        resolve();
      };
    });
  }

  get position() {
    return { x: this.x, y: this.y };
  }
}

let singleton: FakeCursor | null = null;

export function getFakeCursor(): FakeCursor {
  if (!singleton) singleton = new FakeCursor();
  return singleton;
}
