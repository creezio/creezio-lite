# Assistant tools and MCP defaults

Lite builds HTTP operations, MCP tools, and native assistant tools from the same operation catalogue. Every execution still checks the current workspace, role, access receipt, credential scope, and persisted MCP switch.

Applications may opt into a smaller default catalogue with `AppExtensions.assistant` and `AppExtensions.mcp`. Assistant profiles provide role-specific instructions and direct tool names. MCP profiles provide default-enabled tool names keyed by the server-observed access profile. If a user belongs to several bound groups, Lite enables the union of those profile defaults. An application without this configuration keeps the previous behavior: every otherwise eligible MCP tool is enabled.

Defaults never overwrite administrator choices. A persisted switch in `lite_mcp_policies` has priority over application defaults, including explicitly enabling an advanced tool. Removing a group binding or disabling a tool takes effect on the next discovery or execution check.

The native assistant sends at most 128 function definitions to a provider. `lite_tools_search` discovers active, authorized overflow tools, and `lite_tools_call` executes one by exact name. The call reloads active tools, rejects reserved meta-tool names, validates the selected tool's own JSON Schema, and only then invokes it. This keeps uncommon operations available without loading the full catalogue into every model request.
