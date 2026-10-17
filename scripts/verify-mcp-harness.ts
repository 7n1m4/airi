import { readFile } from 'node:fs/promises'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// --- MOCKED/COPIED FROM PROJECT ---

// From packages/stage-ui/src/stores/mcp-tool-bridge.ts

// From packages/stage-ui/src/stores/modules/live-session.ts (Hardened Logic)
function mapAiriToolToGemini(tool: any): Record<string, unknown> {
  const params = tool.function.parameters ? JSON.parse(JSON.stringify(tool.function.parameters)) : { type: 'object', properties: {} }
  const cleanSchema = (obj: any) => {
    if (!obj || typeof obj !== 'object')
      return
    delete obj.$schema
    delete obj.additionalProperties
    if (obj.properties) {
      Object.values(obj.properties).forEach(cleanSchema)
    }
    if (obj.items) {
      cleanSchema(obj.items)
    }
  }
  cleanSchema(params)
  if (params.type !== 'object')
    params.type = 'object'
  if (!params.properties)
    params.properties = {}
  return {
    name: tool.function.name,
    description: tool.function.description || '',
    parameters: params,
  }
}

// --- HARNESS LOGIC ---

async function runHarness() {
  const configPath = 'c:/Users/h4rdc/.gemini/antigravity/mcp_config.json'
  console.info(`[Harness] Reading config from ${configPath}...`)

  const configRaw = await readFile(configPath, 'utf-8')
  const config = JSON.parse(configRaw)

  const archivistConfig = config.mcpServers.archivist
  if (!archivistConfig) {
    throw new Error('Archivist server not found in config')
  }

  console.info(`[Harness] Starting archivist server: ${archivistConfig.command} ${archivistConfig.args.join(' ')}`)

  const transport = new StdioClientTransport({
    command: archivistConfig.command,
    args: archivistConfig.args,
    env: archivistConfig.env,
  })

  const client = new Client({
    name: 'harness-mcp-gemini',
    version: '1.0.0',
  })

  try {
    await client.connect(transport)
    console.info('[Harness] Connected to MCP server!')

    // 1. Simulate mcp_list_tools execute logic
    console.info('[Harness] Listing tools...')
    const response = await client.listTools()

    // Convert to project's McpToolDescriptor format
    const descriptors = response.tools.map(t => ({
      serverName: 'archivist',
      name: `archivist::${t.name}`,
      toolName: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))

    console.info(`[Harness] Found ${descriptors.length} tools.`)

    // 2. Simulate AIRI tool creation (xsai tool wrapper)
    // We'll just create a mock AIRI tool object for mcp_list_tools itself first
    const mcpListToolsAiri = {
      function: {
        name: 'mcp_list_tools',
        description: 'List all tools available on the connected MCP servers',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
          $schema: 'http://json-schema.org/draft-07/schema#',
        },
      },
    }

    // 3. Test the mapping
    console.info('\n--- VERIFICATION: mcp_list_tools (Empty Params) ---')
    const purifiedList = mapAiriToolToGemini(mcpListToolsAiri)
    console.info(JSON.stringify(purifiedList, null, 2))

    // 4. Test calling an actual tool
    const targetToolName = 'catalog_list' // Raw name as returned by server
    const hasCatalogList = descriptors.some(t => t.toolName === targetToolName)

    if (hasCatalogList) {
      console.info(`\n[Harness] --- VERIFICATION: Calling ${targetToolName} ---`)
      try {
        const result = await client.callTool({
          name: targetToolName,
          arguments: {}, // Assuming catalog_list takes no mandatory args or we just test empty
        })
        console.info('[Harness] Call Result:', JSON.stringify(result, null, 2))
      }
      catch (callErr) {
        console.error(`[Harness] Call Error on ${targetToolName}:`, callErr)
      }
    }
    else {
      console.info(`\n[Harness] Tool '${targetToolName}' not found on server. Cannot test execution.`)
    }

    console.info('\n[Harness] All verification steps completed successfully!')
  }
  catch (err) {
    console.error('[Harness] Error:', err)
  }
  finally {
    await client.close()
  }
}

runHarness()
