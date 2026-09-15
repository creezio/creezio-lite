"use client";
import { AppShell } from '@lite/shell-ui/ui';
import { ApiEndpointsClient } from '@/runtime/modules/observability/ui/api-endpoints-client';
export default function Page(){return <AppShell title="API"><section className="workspace-section"><ApiEndpointsClient/></section></AppShell>;}
