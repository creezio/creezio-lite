"use client";
import { AppShell } from '@lite/shell-ui/ui';
import { RequestLogsClient } from '@/runtime/modules/observability/ui/request-logs-client';
export default function Page(){return <AppShell title="Journal d’activité"><section className="workspace-section"><RequestLogsClient/></section></AppShell>;}
