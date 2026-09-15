"use client";
import { AppShell } from '@lite/shell-ui/ui';
import { McpAdminClient } from '@/runtime/ui/mcp-admin-client';
import { RequestLogsClient } from "@/runtime/modules/observability/ui/request-logs-client";
export default function Page(){return <AppShell title="MCP"><section className="workspace-section"><McpAdminClient logsSlot={<RequestLogsClient/>}/></section></AppShell>;}
