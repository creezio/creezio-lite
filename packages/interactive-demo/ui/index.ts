/**
 * @creezio/interactive-demo/ui — surface publique React.
 *
 * `InteractiveDemoRoot` : à monter une fois dans le chrome de la marque
 * (auto-lancement première visite + lanceur flottant). `DemoPlayer` : lecteur
 * bas niveau pour un scénario donné. `startInteractiveDemo` : déclenchement
 * programmatique. Importer aussi la feuille
 * `@creezio/interactive-demo/ui/interactive-demo.css`.
 */

export {
  InteractiveDemoRoot,
  startInteractiveDemo,
  INTERACTIVE_DEMO_EVENT,
} from "./demo-root";
export type { InteractiveDemoRootProps } from "./demo-root";

export { DemoPlayer } from "./demo-player";
export type { DemoPlayerProps } from "./demo-player";

export { getDemoCursor } from "./fake-cursor";
export {
  resolveDemoTarget,
  waitForDemoTarget,
} from "./dom";
