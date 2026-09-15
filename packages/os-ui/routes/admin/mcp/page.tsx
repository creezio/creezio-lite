"use client";

import { McpAdminClient } from "@creezio/mcp-facade/ui";
import { RequestLogsClient } from "@creezio/observability/ui";

export default function Page() {
  return (
    <McpAdminClient logsSlot={<RequestLogsClient />} />
  );
}
