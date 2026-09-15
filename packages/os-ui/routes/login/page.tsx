"use client";

import { Suspense } from "react";
import { LoginPage } from "@creezio/auth/ui";

export default function Page() {
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      <LoginPage defaultRedirect="/dashboard" />
    </Suspense>
  );
}
