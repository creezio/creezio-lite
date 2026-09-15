"use client";

import { DesktopSettingsPage } from "@creezio/shell-ui/ui/os-pages";
import { MailSettings } from "@creezio/mails/ui";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

/**
 * Configuration OS — l'onglet Email (transport, test d'envoi, comptes IMAP)
 * est injecté ici : shell-ui ne peut pas dépendre de @creezio/mails
 * (dépendance inverse). `?tab=email` ouvre directement l'onglet.
 */
function SettingsWithTabs() {
  const params = useSearchParams();
  return (
    <DesktopSettingsPage
      defaultTab={params.get("tab") ?? undefined}
      extraTabs={[{ value: "email", label: "Email", content: <MailSettings /> }]}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SettingsWithTabs />
    </Suspense>
  );
}
