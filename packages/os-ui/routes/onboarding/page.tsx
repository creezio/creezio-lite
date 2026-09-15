import { redirect } from "next/navigation";

/**
 * Fallback OS `/onboarding` — sans page métier marque, jamais d'écran mort.
 * Les marques avec parcours produit déclarent `ui/app/onboarding/` (prime sur
 * ce wrapper via materialize). Flag `features.onboarding: false` / brand-spec
 * `platform.onboarding: false` : post-setup → home ; cette route redirige aussi.
 */
export default function Page() {
  redirect("/");
}
