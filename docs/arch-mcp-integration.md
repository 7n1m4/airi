# Architecture: MCP (Model Context Protocol) Integration

AIRI leverages the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) to extend its capabilities through external tools and data sources. This integration allows AIRI to connect to standardized MCP servers, enabling features like advanced file manipulation, database access, or custom API integrations without modifying the core codebase.

## Overview

The MCP integration in AIRI is primarily managed within the Electron main process of `stage-tamagotchi`. It acts as an **MCP Client** that can spawn and interact with external MCP servers over Standard I/O (stdio).

### Key Components

- **Manager**: `apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts`
  - Manages the lifecycle of MCP server sessions.
  - Handles tool listing and tool calling across all active servers.
  - Implements a unified naming convention for tools: `serverName::toolName`.
- **IPC Layer**: `apps/stage-tamagotchi/src/shared/eventa.ts`
  - Defines the `electronMcpListTools` and `electronMcpCallTool` contracts.
  - Allows the renderer (UI) to trigger tool executions.
- **Official SDK**: Uses `@modelcontextprotocol/sdk` for all protocol-level operations.

---

## Configuration

Custom MCP servers are defined in a local JSON configuration file.

- **Location**: `%AppData%/airi/mcp.json` (Managed by Electron's `userData` path).
- **Format**:
  ```json
  {
    "mcpServers": {
      "my-custom-server": {
        "command": "node",
        "args": ["C:/path/to/server/index.js"],
        "env": {
          "API_KEY": "your-key-here"
        },
        "enabled": true
      }
    }
  }
  ```

### Example Entry: Filesystem Server
To add the official [Google Search MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/google-search) or a local one:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/name/Documents"],
      "enabled": true
    }
  }
}
```

---

## Tool Execution Flow

1. **Discovery**: On startup (or via `applyAndRestart`), the manager reads `mcp.json` and connects to all enabled servers.
2. **Listing**: The UI calls `electronMcpListTools` to get all available tools from all connected servers.
3. **Execution**:
   - The UI/Agent identifies a tool by its qualified name (e.g., `filesystem::read_file`).
   - The `electronMcpCallTool` IPC event is fired.
   - The manager parses the prefix to find the correct `McpServerSession`.
   - The tool is executed via the `session.client.callTool` method.
   - Results are returned to the caller as an `ElectronMcpCallToolResult`.

## Libraries & Dependencies

- **@modelcontextprotocol/sdk**: The core protocol implementation.
- **zod**: Used for strict validation of the `mcp.json` configuration.
- **@moeru/eventa**: Powers the type-safe IPC communication between the UI and the MCP manager.
- **@guiiai/logg**: Provides structured logging for server stdout/stderr monitoring.

---

## User Interface Design (Proposed)

To provide a premium and accessible experience, AIRI's MCP management should be integrated into **Settings > Modules** with a focus on both ease of use and power-user control.

### 1. The MCP Store
A curated discovery surface for pre-loading useful MCP servers without manual configuration.
- **Curated Selection**: Pre-sets for common utilities like Google Search, Filesystem access, and Cloud provider tools.
- **Search & Discovery**: Allows users to quickly find and "install" compatible servers.

### 2. Server Management Dashboard
The primary interface for monitoring and configuring connected servers.
- **Server Registry**: A sidebar or list showing all configured servers with real-time tool counts (e.g., `archivist: 91/91 tools`).
- **Global Controls**: Buttons for **Refresh** (re-poll tools), **View Raw Config**, and **Apply & Restart**.
- **Per-Server Toggles**: Enable/disable entire servers or individual tools within them to optimize agent performance.

### 3. Integrated Guidance
To help users understand how to leverage their configured tools, the "Configure" screen should include a **prominent prompt template** at the top:

> [!TIP]
> **How to use these tools:**
> "To execute an MCP action, simply ask the AI: *'Please use the **mcp_tool_call** capability for the **archivist** server to run the **batch_sequence** tool with the following arguments...'*."

---

## Technical Appendix: Configuration Screenshots

_Screenshots unavailable: the proposed MCP Store / server dashboard UI was never implemented, and the original images lived on a contributor's machine._

---

## Internal MCP Servers

The standalone service that used to expose AIRI's own functionality as an MCP server
(`services/twitter-services/src/adapters/mcp-adapter.ts`) was removed along with the other
`services/*` bots in this fork. AIRI is now MCP **client** only; to expose internal
capabilities to external tools, add an MCP server config entry in `mcp.json` pointing at your
own stdio server.

---

## Relevant Skills

- [[airi-mcp-integration]]
