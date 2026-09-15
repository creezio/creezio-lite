// @ts-nocheck
/**
 * Fenêtre profil collaborateur IA (P2 multi-profils, décision Q1 : in-process).
 *
 * Une BaseWindow dédiée par IA — « {productName} — <nom IA> » — qui porte la
 * WebContentsView CRM persona + les onglets web de son SupplierTabManager,
 * en PARALLÈLE de la fenêtre owner (jamais de masquage croisé).
 *
 * Persistance (décision Q8) : fermer la fenêtre = la masquer (le workspace,
 * ses sessions web et le runner restent actifs). La vraie fermeture passe par
 * le tray « Workspaces IA », le cockpit, ou l'arrêt du serveur.
 */

import type { BaseWindow as BaseWindowType, WebContentsView } from "electron";
import { log, logError } from "../logger.js";
import { getAiWorkspaceHostBindings } from "./bindings.js";
import { loadElectron } from "../load-electron.js";


export type AiProfileWindowOptions = {
  label: string;
  /** true pendant le vrai quit app — laisse la fenêtre se fermer. */
  isQuitting: () => boolean;
  /** Notifie l'hôte (menu tray, cockpit) d'un changement de visibilité. */
  onVisibilityChanged?: () => void;
};

export class AiProfileWindow {
  readonly win: BaseWindowType;
  private reallyClosing = false;

  constructor(private readonly opts: AiProfileWindowOptions) {
    // Cadre natif sur toutes les plateformes (V1) : les boutons du chrome
    // custom Windows pilotent la fenêtre principale via IPC — on évite le
    // frameless ici pour ne pas croiser les commandes de fenêtres.
    const { BaseWindow } = loadElectron();
    this.win = new BaseWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      title: `${getAiWorkspaceHostBindings().productName} — ${opts.label}`,
      backgroundColor: "#14182f",
      autoHideMenuBar: true,
      show: false,
    });
    this.win.on("close", (e) => {
      if (this.reallyClosing || this.opts.isQuitting()) return;
      e.preventDefault();
      try {
        this.win.hide();
        log("ai-window", `fenêtre IA masquée (${this.opts.label}) — workspace toujours actif`);
      } catch (err) {
        logError("ai-window", err);
      }
      this.opts.onVisibilityChanged?.();
    });
    this.win.on("show", () => this.opts.onVisibilityChanged?.());
    this.win.on("hide", () => this.opts.onVisibilityChanged?.());
  }

  /** Attache la vue CRM persona et la garde ajustée au contenu. */
  attach(view: WebContentsView): void {
    this.win.contentView.addChildView(view);
    const fit = () => {
      try {
        const { width, height } = this.win.getContentBounds();
        view.setBounds({ x: 0, y: 0, width, height });
      } catch (e) {
        logError("ai-window", e);
      }
    };
    fit();
    this.win.on("resize", fit);
  }

  setLabel(label: string): void {
    try {
      if (!this.win.isDestroyed()) this.win.setTitle(`${getAiWorkspaceHostBindings().productName} — ${label}`);
    } catch (e) {
      logError("ai-window", e);
    }
  }

  isVisible(): boolean {
    try {
      return !this.win.isDestroyed() && this.win.isVisible();
    } catch {
      return false;
    }
  }

  /** Affiche + focus (tray / cockpit « Ouvrir le workspace »). */
  show(): void {
    if (this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  /** Affiche sans voler le focus (actions du runner pendant un run). */
  showInactive(): void {
    if (this.win.isDestroyed() || this.win.isVisible()) return;
    this.win.showInactive();
  }

  hide(): void {
    try {
      if (!this.win.isDestroyed()) this.win.hide();
    } catch (e) {
      logError("ai-window", e);
    }
    this.opts.onVisibilityChanged?.();
  }

  /** Vraie fermeture (libère la RAM) — bypasse le close → hide. */
  destroy(): void {
    this.reallyClosing = true;
    try {
      if (!this.win.isDestroyed()) this.win.destroy();
    } catch (e) {
      logError("ai-window", e);
    }
  }
}
