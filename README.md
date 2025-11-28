# Parallelpedia Plugin for DKG Node

This plugin provides MCP tools and REST API endpoints for the Parallelpedia project, enabling AI agents and applications to query and publish Community Notes that compare Grokipedia vs Wikipedia articles on the OriginTrail DKG (Decentralized Knowledge Graph).

## Overview

The Parallelpedia plugin extends the DKG Node with functionality to:
- **Publish** Community Notes as Knowledge Assets to the DKG blockchain
- **Query** Community Notes using SPARQL queries
- **Search** Community Notes by keywords or trust score filters
- **Expose** MCP tools for AI agents to interact with Community Notes

## Architecture

The plugin is built using the DKG plugin framework and integrates with:
- **DKG Graph**: For SPARQL queries and data retrieval
- **DKG Asset**: For publishing Knowledge Assets
- **MCP Server**: For AI agent tool registration
- **REST API**: For HTTP endpoints

### Plugin Registration

The plugin is registered in `apps/agent/src/server/index.ts` and automatically loaded when the DKG node starts.

## Installation

### If Using the Parallelpedia Repository's DKG Node

The plugin is **already registered** in `apps/agent/src/server/index.ts`. Simply:

1. **Build the plugin**:
```bash
cd packages/dkg-plugin-parallelpedia
npm install
npm run build
```

2. **Install DKG Node dependencies** (links plugin via npm workspaces):
```bash
cd ../../
npm install
```

3. **The plugin will be automatically loaded** when the agent server starts.

### If Using a Fresh DKG Node Clone

If you're integrating this plugin into a fresh DKG Node installation:

1. **Clone the plugin** into the DKG Node's packages directory:
```bash
cd /path/to/dkg-node/packages
git clone https://github.com/denishotii/dkg-plugin-parallelpedia.git dkg-plugin-parallelpedia
cd dkg-plugin-parallelpedia
npm install
npm run build
```

2. **Register the plugin** in `apps/agent/src/server/index.ts`:
   - Add import: `import parallelpediaPlugin from "@dkg/plugin-parallelpedia";`
   - Add to plugins array: `parallelpediaPlugin,`

3. **Add dependency** to `apps/agent/package.json`:
```json
{
  "dependencies": {
    "@dkg/plugin-parallelpedia": "^0.0.1"
  }
}
```

4. **Install dependencies**:
```bash
cd /path/to/dkg-node
npm install
```

## Configuration

The plugin requires DKG node configuration via environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DKG_OTNODE_URL` | OT-Node endpoint URL | `https://v6-pegasus-node-02.origin-trail.network:8900` |
| `DKG_BLOCKCHAIN` | Blockchain network identifier | `otp:20430` (testnet) or `otp:2043` (mainnet) |
| `DKG_PUBLISH_WALLET` | Wallet private key for publishing | `0x...` (private key) |

**Note**: For testnet, you'll need testnet tokens (NEURO) in your wallet to pay for gas fees.

## Features

### MCP Tools

The plugin registers two MCP tools for AI agents:

#### 1. `parallelpedia-get-community-note`

Retrieve a Community Note for a specific topic.

**Input Schema:**
```typescript
{
  topicId: string  // Topic identifier (e.g., "Climate_change")
}
```

**Returns:**
```json
{
  "topicId": "Climate_change",
  "found": true,
  "trustScore": 75.5,
  "summary": "Summary of findings...",
  "grokTitle": "Climate Change",
  "wikiTitle": "Climate Change",
  "createdAt": "2025-01-01T00:00:00Z",
  "ual": "did:dkg:0x1234...",
  "assetDetails": { ... }
}
```

**How It Works:**
1. Executes SPARQL query to find Community Note by `topicId`
2. Retrieves most recent note (ordered by `dateCreated`)
3. Optionally fetches full asset details using UAL
4. Returns structured response with source Knowledge Asset reference

#### 2. `parallelpedia-search-community-notes`

Search Community Notes by keyword or trust score range.

**Input Schema:**
```typescript
{
  keyword?: string        // Search keyword (matches topicId, grokTitle, wikiTitle)
  minTrustScore?: number  // Minimum trust score (0-100)
  maxTrustScore?: number  // Maximum trust score (0-100)
  limit?: number          // Maximum results (default: 10)
}
```

**Returns:**
```json
{
  "found": true,
  "count": 5,
  "notes": [
    {
      "topicId": "Climate_change",
      "trustScore": 75.5,
      "summary": "...",
      "grokTitle": "Climate Change",
      "wikiTitle": "Climate Change",
      "createdAt": "2025-01-01T00:00:00Z",
      "ual": "did:dkg:0x1234..."
    }
  ]
}
```

**How It Works:**
1. Builds SPARQL query with optional filters
2. Filters by keyword (case-insensitive, matches topicId/titles)
3. Filters by trust score range if provided
4. Orders by creation date (newest first)
5. Limits results to specified count

### API Endpoints

#### `GET /parallelpedia/community-notes/:topicId`

Get a Community Note for a specific topic.

**Parameters:**
- `topicId` (path): Topic identifier

**Response:**
```json
{
  "topicId": "Climate_change",
  "found": true,
  "trustScore": 75.5,
  "summary": "Summary of findings...",
  "grokTitle": "Climate Change",
  "wikiTitle": "Climate Change",
  "createdAt": "2025-01-01T00:00:00Z",
  "ual": "did:dkg:0x1234..."
}
```

**Errors:**
- `404`: Community Note not found
- `500`: SPARQL query failed (may indicate data not indexed yet)

**Note**: Remote testnet nodes may return 500 errors for SPARQL queries. In this case, retrieve the asset directly by UAL using `GET /api/dkg/assets?ual=YOUR_UAL`.

#### `GET /parallelpedia/community-notes`

Search Community Notes with filters.

**Query Parameters:**
- `keyword` (optional): Search keyword
- `minTrustScore` (optional): Minimum trust score (0-100)
- `maxTrustScore` (optional): Maximum trust score (0-100)
- `limit` (optional): Maximum results (default: 10)

**Response:**
```json
{
  "found": true,
  "count": 5,
  "notes": [ ... ]
}
```

**Example:**
```bash
curl "http://localhost:9200/parallelpedia/community-notes?keyword=climate&minTrustScore=50&limit=20"
```

#### `POST /parallelpedia/community-notes`

Publish a Community Note to DKG as a Knowledge Asset.

**Request Body:**
```json
{
  "topicId": "Climate_change",
  "trustScore": 75.5,
  "summary": "Summary of findings...",
  "labelsCount": {
    "aligned": 45,
    "missing_context": 12,
    "conflict": 3,
    "unsupported": 5
  },
  "keyExamples": [
    {
      "text": "Segment text...",
      "label": "conflict"
    }
  ],
  "grokTitle": "Climate Change",
  "wikiTitle": "Climate Change",
  "provenance": {
    "createdBy": "Parallelpedia",
    "version": "1.0.0",
    "inputHash": "sha256-hash",
    "sources": {
      "grokUrl": "https://grokipedia.com/...",
      "wikiUrl": "https://en.wikipedia.org/...",
      "grokUal": "did:dkg:...",
      "wikiUal": "did:dkg:..."
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "ual": "did:dkg:0x1234...",
  "asset_id": "did:dkg:0x1234...",
  "verification_url": "/api/dkg/assets?ual=did:dkg:0x1234...",
  "operation_id": "op-123...",
  "transaction_hash": "0xabc..."
}
```

**Errors:**
- `500`: Publishing failed (see error message for details)

**Common Error Scenarios:**
- **Insufficient Funds**: Wallet needs testnet tokens (NEURO) for gas fees
- **OT-Node Connection**: Cannot connect to OT-Node (check `DKG_OTNODE_URL`)
- **Configuration Missing**: Missing `DKG_BLOCKCHAIN` or `DKG_PUBLISH_WALLET`

## How Publishing Works

### Publishing Flow

1. **Request Validation**: Validates request body and DKG configuration
2. **JSON-LD Creation**: Converts Community Note to JSON-LD format with schema.org vocabulary
3. **Asset Wrapping**: Wraps JSON-LD in `{ public: jsonld }` structure
4. **DKG Publishing**: Calls `ctx.dkg.asset.create()` with publishing options:
   - `epochsNum: 2` - Number of epochs for storage
   - `minimumNumberOfFinalizationConfirmations: 3` - Blockchain confirmations
   - `minimumNumberOfNodeReplications: 1` - Minimum node replications
5. **UAL Extraction**: Extracts UAL from response (checks multiple possible fields)
6. **Response**: Returns UAL and verification URL

### Publishing Options

The plugin uses the following DKG publishing options:
- **Epochs**: 2 epochs (determines storage duration)
- **Confirmations**: 3 blockchain confirmations required
- **Replications**: Minimum 1 node replication

### Error Handling

The plugin includes comprehensive error handling:
- **Configuration Validation**: Checks all required environment variables
- **Connectivity Testing**: Tests OT-Node connectivity before publishing
- **Error Extraction**: Extracts detailed error messages from DKG responses
- **User-Friendly Messages**: Provides actionable error messages with troubleshooting steps

## How Querying Works

### SPARQL Queries

The plugin uses SPARQL queries to retrieve Community Notes from the DKG graph.

#### Get Community Note Query

```sparql
PREFIX schema: <https://schema.org/>
PREFIX parallelpedia: <https://parallelpedia.org/schema/>

SELECT ?asset ?ual ?trustScore ?summary ?grokTitle ?wikiTitle ?createdAt WHERE {
  ?asset schema:@type "CommunityNote" .
  ?asset schema:topicId "Climate_change" .
  ?asset schema:trustScore ?trustScore .
  ?asset schema:summary ?summary .
  ?asset parallelpedia:grokTitle ?grokTitle .
  ?asset parallelpedia:wikiTitle ?wikiTitle .
  ?asset schema:dateCreated ?createdAt .
  ?asset schema:identifier ?ual .
}
ORDER BY DESC(?createdAt)
LIMIT 1
```

#### Search Query (with filters)

```sparql
PREFIX schema: <https://schema.org/>
PREFIX parallelpedia: <https://parallelpedia.org/schema/>

SELECT ?asset ?ual ?topicId ?trustScore ?summary ?grokTitle ?wikiTitle ?createdAt WHERE {
  ?asset schema:@type "CommunityNote" .
  ?asset schema:topicId ?topicId .
  ?asset schema:trustScore ?trustScore .
  ?asset schema:summary ?summary .
  ?asset parallelpedia:grokTitle ?grokTitle .
  ?asset parallelpedia:wikiTitle ?wikiTitle .
  ?asset schema:dateCreated ?createdAt .
  ?asset schema:identifier ?ual .
  FILTER (
    CONTAINS(LCASE(?topicId), LCASE("climate")) ||
    CONTAINS(LCASE(?grokTitle), LCASE("climate")) ||
    CONTAINS(LCASE(?wikiTitle), LCASE("climate"))
  )
  FILTER (?trustScore >= 50)
}
ORDER BY DESC(?createdAt)
LIMIT 10
```

### Query Execution

1. **SPARQL Query**: Builds SPARQL query based on parameters
2. **Graph Query**: Executes query via `ctx.dkg.graph.query()`
3. **Result Parsing**: Parses SPARQL results and extracts values
4. **Error Handling**: Handles query failures gracefully (returns empty results)

**Note**: SPARQL queries may fail on remote testnet nodes if data is not yet indexed. In this case, retrieve assets directly by UAL.

## Data Structure

### JSON-LD Schema

Community Notes are stored as Knowledge Assets with the following JSON-LD structure:

```json
{
  "@context": {
    "@vocab": "https://schema.org/",
    "parallelpedia": "https://parallelpedia.org/schema/"
  },
  "@type": "CommunityNote",
  "topicId": "Climate_change",
  "trustScore": 75.5,
  "summary": "Summary of findings...",
  "labelsCount": {
    "aligned": 45,
    "missing_context": 12,
    "conflict": 3,
    "unsupported": 5
  },
  "keyExamples": [
    {
      "text": "Segment text...",
      "label": "conflict"
    }
  ],
  "grokTitle": "Climate Change",
  "wikiTitle": "Climate Change",
  "dateCreated": "2025-01-01T00:00:00Z",
  "provenance": {
    "createdBy": "Parallelpedia",
    "version": "1.0.0",
    "inputHash": "sha256-hash",
    "sources": {
      "grokUrl": "https://grokipedia.com/...",
      "wikiUrl": "https://en.wikipedia.org/..."
    }
  }
}
```

### Schema Vocabulary

- **schema.org**: Standard vocabulary for structured data
- **parallelpedia.org/schema/**: Custom vocabulary for Parallelpedia-specific fields
  - `parallelpedia:grokTitle` - Grokipedia article title
  - `parallelpedia:wikiTitle` - Wikipedia article title

## Usage Examples

### From Backend (Python)

```python
from app.services.dkg_client import DKGClient

client = DKGClient(base_url="http://localhost:9200")

# Get a Community Note
note = await client.get_community_note("Climate_change")
if note:
    print(f"Trust Score: {note.trust_score}")
    print(f"Summary: {note.summary}")

# Publish a Community Note
ual = await client.publish_community_note(community_note)
print(f"Published with UAL: {ual}")
```

### From MCP (AI Agents)

AI agents can use the MCP tools directly:

```javascript
// Get Community Note
const result = await mcp.callTool("parallelpedia-get-community-note", {
  topicId: "Climate_change"
});

// Search Community Notes
const results = await mcp.callTool("parallelpedia-search-community-notes", {
  keyword: "climate",
  minTrustScore: 50,
  limit: 10
});
```

### From REST API

```bash
# Get Community Note
curl http://localhost:9200/parallelpedia/community-notes/Climate_change

# Search Community Notes
curl "http://localhost:9200/parallelpedia/community-notes?keyword=climate&minTrustScore=50&limit=20"

# Publish Community Note
curl -X POST http://localhost:9200/parallelpedia/community-notes \
  -H "Content-Type: application/json" \
  -d '{
    "topicId": "Climate_change",
    "trustScore": 75.5,
    "summary": "Summary of findings...",
    "labelsCount": {"aligned": 45, "conflict": 3},
    "keyExamples": [{"text": "...", "label": "conflict"}],
    "grokTitle": "Climate Change",
    "wikiTitle": "Climate Change"
  }'
```

## Error Handling

### Common Errors

1. **SPARQL Query Failures (500)**:
   - **Cause**: Remote testnet nodes may not support SPARQL queries immediately
   - **Solution**: Retrieve asset directly by UAL: `GET /api/dkg/assets?ual=YOUR_UAL`

2. **Publishing Failures**:
   - **Insufficient Funds**: Wallet needs testnet tokens (NEURO)
   - **OT-Node Connection**: Check `DKG_OTNODE_URL` and network connectivity
   - **Configuration**: Verify `DKG_BLOCKCHAIN` and `DKG_PUBLISH_WALLET` are set

3. **Asset Not Found (404)**:
   - **Cause**: No Community Note exists for the topic
   - **Solution**: Publish a Community Note first

### Error Response Format

```json
{
  "success": false,
  "ual": null,
  "error": "Detailed error message with troubleshooting steps"
}
```

## Development

### Build Commands

```bash
# Build plugin
npm run build

# Watch mode (auto-rebuild on changes)
npm run dev

# Type check
npm run check-types

# Lint
npm run lint

# Run tests
npm test
```

### Project Structure

```
dkg-plugin-parallelpedia/
├── src/
│   └── index.ts          # Main plugin implementation
├── dist/                 # Built files (generated)
├── tests/                # Test files
├── package.json
├── tsconfig.json
└── README.md
```

### Adding New Features

1. Edit `src/index.ts`
2. Add MCP tools using `mcp.registerTool()`
3. Add API routes using `api.get()` or `api.post()`
4. Rebuild: `npm run build`
5. Restart DKG node to load changes

## Integration with DKG Node

The plugin integrates with the DKG Node through:

- **Plugin Context (`ctx`)**: Provides access to DKG services
  - `ctx.dkg.graph`: SPARQL query interface
  - `ctx.dkg.asset`: Knowledge Asset publishing interface

- **MCP Server (`mcp`)**: Registers tools for AI agents

- **REST API (`api`)**: Exposes HTTP endpoints

The plugin is automatically loaded when the DKG node starts if registered in `apps/agent/src/server/index.ts`.

## Troubleshooting

### SPARQL Queries Return 500

**Symptom**: SPARQL queries fail with 500 errors on remote testnet nodes.

**Solution**: 
- Use UAL-based retrieval: `GET /api/dkg/assets?ual=YOUR_UAL`
- Wait for data to be indexed (may take time on testnet)
- Use local OT-Node for development

### Publishing Fails with Empty Error

**Symptom**: Publishing fails but error message is empty.

**Check**:
1. `DKG_OTNODE_URL` is set and accessible
2. `DKG_BLOCKCHAIN` is set correctly
3. `DKG_PUBLISH_WALLET` contains valid private key
4. Wallet has testnet tokens (NEURO) for gas fees
5. OT-Node is running and accessible

### Asset Created But No UAL

**Symptom**: Publishing succeeds but no UAL in response.

**Solution**: Check DKG node logs for full response structure. UAL may be in a different field (plugin checks multiple possible fields).

## API Documentation

The plugin endpoints are automatically documented in the DKG Node's Swagger UI:
- **Swagger UI**: `http://localhost:9200/api-docs`
- Look for the "Parallelpedia" tag

