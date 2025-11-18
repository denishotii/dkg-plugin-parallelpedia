# Parallelpedia Plugin for DKG Node

This plugin provides MCP tools and API endpoints for the Parallelpedia project, enabling AI agents to query Community Notes that compare Grokipedia vs Wikipedia articles.

## Features

### MCP Tools

1. **`parallelpedia-get-community-note`** - Retrieve a Community Note for a specific topic
   - Input: `topicId` (string)
   - Returns: Community Note with trust score, summary, and key findings

2. **`parallelpedia-search-community-notes`** - Search Community Notes by keyword or trust score
   - Input: `keyword` (optional), `minTrustScore` (optional), `maxTrustScore` (optional), `limit` (optional)
   - Returns: List of matching Community Notes

### API Endpoints

1. **`GET /parallelpedia/community-notes/:topicId`** - Get Community Note for a topic
2. **`GET /parallelpedia/community-notes`** - Search Community Notes (query params: keyword, minTrustScore, maxTrustScore, limit)
3. **`POST /parallelpedia/community-notes`** - Publish a Community Note to DKG

## Installation

The plugin is already registered in the agent server. To use it:

1. Build the plugin:
```bash
cd packages/dkg-plugin-parallelpedia
npm install
npm run build
```

2. Install in the agent:
```bash
cd ../../apps/agent
npm install
```

3. The plugin will be automatically loaded when the agent server starts.

## Usage

### From Backend (Python)

```python
from app.services.dkg_client import DKGClient

client = DKGClient(base_url="http://localhost:9200")

# Get a Community Note
note = await client.get_community_note("Climate_change")

# Publish a Community Note
ual = await client.publish_community_note(community_note)
```

### From MCP (AI Agents)

AI agents can use the MCP tools directly:

- `parallelpedia-get-community-note` with `topicId: "Climate_change"`
- `parallelpedia-search-community-notes` with filters

### From REST API

```bash
# Get Community Note
curl http://localhost:9200/parallelpedia/community-notes/Climate_change

# Search Community Notes
curl "http://localhost:9200/parallelpedia/community-notes?keyword=climate&minTrustScore=50"

# Publish Community Note
curl -X POST http://localhost:9200/parallelpedia/community-notes \
  -H "Content-Type: application/json" \
  -d '{
    "topicId": "Climate_change",
    "trustScore": 75.5,
    "summary": "Summary of findings...",
    "labelsCount": {"aligned": 10, "conflict": 2},
    "grokTitle": "Climate Change",
    "wikiTitle": "Climate Change"
  }'
```

## Data Structure

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
  "labelsCount": {"aligned": 10, "conflict": 2},
  "keyExamples": [
    {"text": "...", "label": "conflict"}
  ],
  "grokTitle": "Climate Change",
  "wikiTitle": "Climate Change",
  "dateCreated": "2025-01-01T00:00:00Z"
}
```

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Type check
npm run check-types

# Lint
npm run lint
```

