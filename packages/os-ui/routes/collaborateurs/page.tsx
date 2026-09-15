"use client";

import { AccountSettings } from "@creezio/shell-ui/ui/settings/account-settings";

export default function Page() {
  return (
    <>
      <h1>Collaborateurs</h1>
      <p style={{ opacity: 0.75 }}>Compte local / session — OS Creezio.</p>
      <AccountSettings />
    </>
  );
}
