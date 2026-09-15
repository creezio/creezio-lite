import type { ReactNode } from "react";
import type { ShellUiLoginBrand } from "@creezio/shell-ui";

export type CreezioUiBootProps = {
  children: ReactNode;
  desktopApiGlobal: string;
  productName: string;
  publicHostSuffix: string;
  login?: ShellUiLoginBrand;
  /** Overrides `InteractiveDemoRoot` — contrat source dans `boot.tsx`. */
  interactiveDemo?: Record<string, unknown>;
};

/** Implémentation : `@creezio/os-ui/boot` (`src/boot.tsx`, source Next). */
export declare function CreezioUiBoot(props: CreezioUiBootProps): ReactNode;
