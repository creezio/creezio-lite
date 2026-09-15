"use client";
import { AppShell } from '@lite/shell-ui/ui';
import { AnalyticsClient } from '@/runtime/modules/observability/ui/analytics-client';
export default function Page(){return <AppShell title="Usage et activité"><section className="workspace-section"><AnalyticsClient/></section></AppShell>;}
