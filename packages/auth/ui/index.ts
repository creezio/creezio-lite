/**
 * @creezio/auth/ui — LoginForm + SessionProvider (React / Next).
 * Bridge desktop : configureShellUiBrand({ desktopApiGlobal }) côté marque.
 */

export type { LoginFormProps } from "./login-form";
export { LoginForm } from "./login-form";

export type { LoginPageProps } from "./login-page";
export { LoginPage } from "./login-page";

export type {
  SessionContextValue,
  SessionMe,
  SessionProviderProps,
  SessionRole,
} from "./session-provider";
export { SessionProvider, useSession } from "./session-provider";

export type { RequireSessionProps } from "./require-session";
export { RequireSession } from "./require-session";
