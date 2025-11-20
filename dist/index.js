"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_plugins = require("@dkg/plugins");
var import_plugin_swagger = require("@dkg/plugin-swagger");
var import_utils = require("@dkg/plugin-dkg-essentials/utils");
function validateRemoteOtnode() {
  const otnodeUrl = process.env.DKG_OTNODE_URL;
  if (!otnodeUrl) {
    throw new Error(
      "DKG_OTNODE_URL is not configured. Please set DKG_OTNODE_URL to a remote OT-Node (e.g., https://v6-pegasus-node-02.origin-trail.network:8900). Community notes must be queried from the remote DKG network, not a local node."
    );
  }
  const urlLower = otnodeUrl.toLowerCase();
  if (urlLower.includes("localhost") || urlLower.includes("127.0.0.1") || urlLower.startsWith("http://localhost") || urlLower.startsWith("http://127.0.0.1")) {
    throw new Error(
      `DKG_OTNODE_URL is configured to use a local node (${otnodeUrl}). Community notes must be queried from a remote OT-Node connected to the DKG network. Please set DKG_OTNODE_URL to a remote node, for example: https://v6-pegasus-node-02.origin-trail.network:8900`
    );
  }
  try {
    const url = new URL(otnodeUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") {
      throw new Error(
        `DKG_OTNODE_URL points to a local address (${url.hostname}). Community notes must be queried from a remote OT-Node. Please set DKG_OTNODE_URL to a remote node, for example: https://v6-pegasus-node-02.origin-trail.network:8900`
      );
    }
  } catch (urlError) {
  }
}
var index_default = (0, import_plugins.defineDkgPlugin)((ctx, mcp, api) => {
  mcp.registerTool(
    "parallelpedia-get-community-note",
    {
      title: "Get Community Note",
      description: "Retrieve a Community Note for a specific topic comparing Grokipedia vs Wikipedia. Returns trust score, summary, and key discrepancies found.",
      inputSchema: {
        topicId: import_plugin_swagger.z.string().describe("Topic identifier (e.g., 'Climate_change', 'Artificial_intelligence')")
      }
    },
    async ({ topicId }) => {
      try {
        try {
          validateRemoteOtnode();
        } catch (validationError) {
          const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    topicId,
                    found: false,
                    error: errorMessage
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const query = `
          PREFIX schema: <https://schema.org/>
          PREFIX parallelpedia: <https://parallelpedia.org/schema/>
          
          SELECT ?asset ?ual ?trustScore ?summary ?grokTitle ?wikiTitle ?createdAt WHERE {
            ?asset a schema:CommunityNote .
            ?asset schema:topicId "${topicId}" .
            ?asset schema:trustScore ?trustScore .
            OPTIONAL { ?asset schema:summary ?summary . }
            OPTIONAL { ?asset schema:grokTitle ?grokTitle . }
            OPTIONAL { ?asset schema:wikiTitle ?wikiTitle . }
            OPTIONAL { ?asset schema:dateCreated ?createdAt . }
            OPTIONAL { ?asset schema:identifier ?ual . }
          }
          ORDER BY DESC(?createdAt)
          LIMIT 1
        `;
        let queryResult;
        try {
          queryResult = await ctx.dkg.graph.query(query, "SELECT");
        } catch (queryError) {
          console.warn("SPARQL query failed, trying alternative approach:", queryError);
          queryResult = null;
        }
        if (!queryResult || !queryResult.data || queryResult.data.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    topicId,
                    found: false,
                    message: "No Community Note found for this topic. You may want to create one first."
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const note = queryResult.data?.[0];
        if (!note) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    topicId,
                    found: false,
                    message: "No Community Note found for this topic."
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const extractValue = (value) => {
          if (!value) return "";
          if (typeof value === "string") {
            let clean = value.replace(/^"|"$/g, "").replace(/\\"/g, '"');
            const typeMatch = clean.match(/^(.+?)\^\^.+$/);
            if (typeMatch && typeMatch[1]) {
              clean = typeMatch[1].replace(/^"|"$/g, "");
            }
            return clean;
          }
          if (value.value) {
            return extractValue(value.value);
          }
          return String(value);
        };
        const ual = note.ual?.value || note.ual || note.asset?.value || note.asset;
        let assetDetails = null;
        if (ual) {
          try {
            assetDetails = await ctx.dkg.asset.get(ual, {
              includeMetadata: true
            });
          } catch (err) {
            console.warn("Could not fetch full asset details:", err);
          }
        }
        const response = {
          topicId: extractValue(note.topicId) || topicId,
          found: true,
          trustScore: parseFloat(extractValue(note.trustScore)) || 0,
          summary: extractValue(note.summary),
          grokTitle: extractValue(note.grokTitle),
          wikiTitle: extractValue(note.wikiTitle),
          createdAt: extractValue(note.createdAt),
          ual: ual || null,
          assetDetails: assetDetails || null
        };
        return (0, import_utils.withSourceKnowledgeAssets)(
          {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, 2)
              }
            ]
          },
          ual ? [
            {
              title: `Community Note: ${topicId}`,
              issuer: "Parallelpedia",
              ual
            }
          ] : []
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  topicId,
                  found: false,
                  error: `Failed to query Community Note: ${error}`
                },
                null,
                2
              )
            }
          ]
        };
      }
    }
  );
  mcp.registerTool(
    "parallelpedia-search-community-notes",
    {
      title: "Search Community Notes",
      description: "Search for Community Notes by topic keywords or filter by trust score range. Returns a list of matching Community Notes.",
      inputSchema: {
        keyword: import_plugin_swagger.z.string().optional().describe("Search keyword to match against topic IDs or titles"),
        minTrustScore: import_plugin_swagger.z.number().optional().describe("Minimum trust score (0-100)"),
        maxTrustScore: import_plugin_swagger.z.number().optional().describe("Maximum trust score (0-100)"),
        limit: import_plugin_swagger.z.number().optional().default(10).describe("Maximum number of results to return")
      }
    },
    async ({ keyword, minTrustScore, maxTrustScore, limit = 10 }) => {
      try {
        try {
          validateRemoteOtnode();
        } catch (validationError) {
          const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    found: false,
                    count: 0,
                    notes: [],
                    error: errorMessage
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        let query = `
          PREFIX schema: <https://schema.org/>
          PREFIX parallelpedia: <https://parallelpedia.org/schema/>
          
          SELECT ?asset ?ual ?topicId ?trustScore ?summary ?grokTitle ?wikiTitle ?createdAt WHERE {
            ?asset a schema:CommunityNote .
            ?asset schema:topicId ?topicId .
            ?asset schema:trustScore ?trustScore .
            OPTIONAL { ?asset schema:summary ?summary . }
            OPTIONAL { ?asset schema:grokTitle ?grokTitle . }
            OPTIONAL { ?asset schema:wikiTitle ?wikiTitle . }
            OPTIONAL { ?asset schema:dateCreated ?createdAt . }
            OPTIONAL { ?asset schema:identifier ?ual . }
        `;
        if (keyword) {
          query += `
            FILTER (
              CONTAINS(LCASE(?topicId), LCASE("${keyword}")) ||
              CONTAINS(LCASE(?grokTitle), LCASE("${keyword}")) ||
              CONTAINS(LCASE(?wikiTitle), LCASE("${keyword}"))
            )
          `;
        }
        if (minTrustScore !== void 0) {
          query += `FILTER (?trustScore >= ${minTrustScore})`;
        }
        if (maxTrustScore !== void 0) {
          query += `FILTER (?trustScore <= ${maxTrustScore})`;
        }
        query += `
          }
          ORDER BY DESC(?createdAt)
          LIMIT ${limit}
        `;
        let queryResult;
        try {
          queryResult = await ctx.dkg.graph.query(query, "SELECT");
        } catch (queryError) {
          console.error("SPARQL query error:", queryError);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    found: false,
                    count: 0,
                    notes: [],
                    message: "No Community Notes found matching the criteria."
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        if (!queryResult || !queryResult.data || queryResult.data.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    found: false,
                    count: 0,
                    notes: [],
                    message: "No Community Notes found matching the criteria."
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        const extractValue = (value) => {
          if (!value) return "";
          if (typeof value === "string") {
            let clean = value.replace(/^"|"$/g, "").replace(/\\"/g, '"');
            const typeMatch = clean.match(/^(.+?)\^\^.+$/);
            if (typeMatch && typeMatch[1]) {
              clean = typeMatch[1].replace(/^"|"$/g, "");
            }
            return clean;
          }
          if (value.value) {
            return extractValue(value.value);
          }
          return String(value);
        };
        const notes = queryResult.data.map((note) => {
          const assetUri = note.asset?.value || note.asset;
          const ual = note.ual?.value || note.ual || assetUri;
          return {
            topicId: extractValue(note.topicId),
            trustScore: parseFloat(extractValue(note.trustScore)) || 0,
            summary: extractValue(note.summary),
            grokTitle: extractValue(note.grokTitle),
            wikiTitle: extractValue(note.wikiTitle),
            createdAt: extractValue(note.createdAt),
            ual: ual || null
          };
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  found: true,
                  count: notes.length,
                  notes
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  found: false,
                  count: 0,
                  notes: [],
                  error: `Failed to search Community Notes: ${error}`
                },
                null,
                2
              )
            }
          ]
        };
      }
    }
  );
  api.get(
    "/parallelpedia/community-notes/:topicId",
    (0, import_plugin_swagger.openAPIRoute)(
      {
        tag: "Parallelpedia",
        summary: "Get Community Note for a topic",
        description: "Retrieve a Community Note comparing Grokipedia vs Wikipedia for a specific topic",
        params: import_plugin_swagger.z.object({
          topicId: import_plugin_swagger.z.string().openapi({
            description: "Topic identifier",
            example: "Climate_change"
          })
        }),
        response: {
          description: "Community Note data",
          schema: import_plugin_swagger.z.object({
            topicId: import_plugin_swagger.z.string(),
            found: import_plugin_swagger.z.boolean(),
            trustScore: import_plugin_swagger.z.number().optional(),
            summary: import_plugin_swagger.z.string().optional(),
            grokTitle: import_plugin_swagger.z.string().optional(),
            wikiTitle: import_plugin_swagger.z.string().optional(),
            createdAt: import_plugin_swagger.z.string().optional(),
            ual: import_plugin_swagger.z.string().nullable().optional()
          })
        }
      },
      async (req, res) => {
        const { topicId } = req.params;
        try {
          try {
            validateRemoteOtnode();
          } catch (validationError) {
            const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
            console.error("[Community Note Query] Remote OT-Node validation failed:", errorMessage);
            return res.status(400).json({
              topicId,
              found: false,
              error: errorMessage
            });
          }
          const query = `
            PREFIX schema: <https://schema.org/>
            PREFIX parallelpedia: <https://parallelpedia.org/schema/>
            
            SELECT ?asset ?ual ?trustScore ?summary ?grokTitle ?wikiTitle ?createdAt WHERE {
              ?asset a schema:CommunityNote .
              ?asset schema:topicId "${topicId}" .
              ?asset schema:trustScore ?trustScore .
              OPTIONAL { ?asset schema:summary ?summary . }
              OPTIONAL { ?asset schema:grokTitle ?grokTitle . }
              OPTIONAL { ?asset schema:wikiTitle ?wikiTitle . }
              OPTIONAL { ?asset schema:dateCreated ?createdAt . }
              OPTIONAL { ?asset schema:identifier ?ual . }
            }
            ORDER BY DESC(?createdAt)
            LIMIT 1
          `;
          let queryResult;
          try {
            console.log(`[Community Note Query] Executing SPARQL query for topicId: ${topicId}`);
            console.log(`[Community Note Query] Query: ${query.substring(0, 200)}...`);
            queryResult = await ctx.dkg.graph.query(query, "SELECT");
            console.log(`[Community Note Query] Query result:`, {
              hasData: !!queryResult?.data,
              dataLength: queryResult?.data?.length || 0,
              resultKeys: queryResult ? Object.keys(queryResult) : []
            });
          } catch (queryError) {
            console.error("[Community Note Query] SPARQL query error:", queryError);
            const errorMessage = queryError instanceof Error ? queryError.message : String(queryError);
            const errorDetails = {
              message: errorMessage,
              stack: queryError instanceof Error ? queryError.stack : void 0
            };
            if (errorMessage.includes("500") || errorMessage.includes("status code 500")) {
              console.error("[Community Note Query] OT-Node returned 500 error. This is common with remote testnet nodes.");
              console.error("[Community Note Query] Remote OT-Nodes may not support SPARQL queries immediately, or the data may not be indexed yet.");
              console.error("[Community Note Query] To retrieve your published asset, use the UAL from the publish response:");
              console.error("[Community Note Query]   GET /api/dkg/assets?ual=YOUR_UAL_HERE");
            }
            console.error("[Community Note Query] Error details:", errorDetails);
            return res.status(404).json({
              topicId,
              found: false,
              error: errorMessage.includes("500") ? "" : "SPARQL query failed. The data may not be indexed yet, or the query syntax may need adjustment."
            });
          }
          if (!queryResult || !queryResult.data || queryResult.data.length === 0) {
            return res.status(404).json({
              topicId,
              found: false
            });
          }
          const note = queryResult.data?.[0];
          if (!note) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      topicId,
                      found: false,
                      message: "No Community Note found for this topic."
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
          const extractValue = (value) => {
            if (!value) return "";
            if (typeof value === "string") {
              let clean = value.replace(/^"|"$/g, "").replace(/\\"/g, '"');
              const typeMatch = clean.match(/^(.+?)\^\^.+$/);
              if (typeMatch && typeMatch[1]) {
                clean = typeMatch[1].replace(/^"|"$/g, "");
              }
              return clean;
            }
            if (value.value) {
              return extractValue(value.value);
            }
            return String(value);
          };
          const assetUri = note.asset?.value || note.asset;
          const ual = note.ual?.value || note.ual || assetUri;
          res.json({
            topicId: extractValue(note.topicId) || topicId,
            found: true,
            trustScore: parseFloat(extractValue(note.trustScore)) || 0,
            summary: extractValue(note.summary),
            grokTitle: extractValue(note.grokTitle),
            wikiTitle: extractValue(note.wikiTitle),
            createdAt: extractValue(note.createdAt),
            ual: ual || null
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          res.status(500).json({
            topicId,
            found: false,
            error: `Failed to query Community Note: ${error}`
          });
        }
      }
    )
  );
  api.get(
    "/parallelpedia/community-notes",
    (0, import_plugin_swagger.openAPIRoute)(
      {
        tag: "Parallelpedia",
        summary: "Search Community Notes",
        description: "Search for Community Notes by keyword or trust score",
        query: import_plugin_swagger.z.object({
          keyword: import_plugin_swagger.z.string().optional(),
          minTrustScore: import_plugin_swagger.z.number({ coerce: true }).optional().openapi({ description: "Minimum trust score (0-100)" }),
          maxTrustScore: import_plugin_swagger.z.number({ coerce: true }).optional().openapi({ description: "Maximum trust score (0-100)" }),
          limit: import_plugin_swagger.z.number({ coerce: true }).optional().default(10).openapi({ description: "Maximum results" })
        }),
        response: {
          description: "List of Community Notes",
          schema: import_plugin_swagger.z.object({
            found: import_plugin_swagger.z.boolean(),
            count: import_plugin_swagger.z.number(),
            notes: import_plugin_swagger.z.array(
              import_plugin_swagger.z.object({
                topicId: import_plugin_swagger.z.string(),
                trustScore: import_plugin_swagger.z.number(),
                summary: import_plugin_swagger.z.string(),
                grokTitle: import_plugin_swagger.z.string(),
                wikiTitle: import_plugin_swagger.z.string(),
                createdAt: import_plugin_swagger.z.string(),
                ual: import_plugin_swagger.z.string().nullable()
              })
            )
          })
        }
      },
      async (req, res) => {
        const { keyword, minTrustScore, maxTrustScore, limit = 10 } = req.query;
        try {
          try {
            validateRemoteOtnode();
          } catch (validationError) {
            const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
            console.error("[Community Note Search] Remote OT-Node validation failed:", errorMessage);
            return res.status(400).json({
              found: false,
              count: 0,
              notes: [],
              error: errorMessage
            });
          }
          let query = `
            PREFIX schema: <https://schema.org/>
            PREFIX parallelpedia: <https://parallelpedia.org/schema/>
            
            SELECT ?asset ?ual ?topicId ?trustScore ?summary ?grokTitle ?wikiTitle ?createdAt WHERE {
              ?asset a schema:CommunityNote .
              ?asset schema:topicId ?topicId .
              ?asset schema:trustScore ?trustScore .
              OPTIONAL { ?asset schema:summary ?summary . }
              OPTIONAL { ?asset schema:grokTitle ?grokTitle . }
              OPTIONAL { ?asset schema:wikiTitle ?wikiTitle . }
              OPTIONAL { ?asset schema:dateCreated ?createdAt . }
              OPTIONAL { ?asset schema:identifier ?ual . }
          `;
          if (keyword) {
            query += `
              FILTER (
                CONTAINS(LCASE(?topicId), LCASE("${keyword}")) ||
                CONTAINS(LCASE(?grokTitle), LCASE("${keyword}")) ||
                CONTAINS(LCASE(?wikiTitle), LCASE("${keyword}"))
              )
            `;
          }
          if (minTrustScore !== void 0) {
            query += `FILTER (?trustScore >= ${minTrustScore})`;
          }
          if (maxTrustScore !== void 0) {
            query += `FILTER (?trustScore <= ${maxTrustScore})`;
          }
          query += `
            }
            ORDER BY DESC(?createdAt)
            LIMIT ${limit}
          `;
          let queryResult;
          try {
            console.log(`[Community Note Search] Executing SPARQL query with filters:`, {
              keyword,
              minTrustScore,
              maxTrustScore,
              limit
            });
            queryResult = await ctx.dkg.graph.query(query, "SELECT");
            console.log(`[Community Note Search] Query result:`, {
              hasData: !!queryResult?.data,
              dataLength: queryResult?.data?.length || 0
            });
            if ((!queryResult?.data || queryResult.data.length === 0) && !keyword && minTrustScore === void 0 && maxTrustScore === void 0) {
              console.log("[Community Note Search] No results with type query, trying alternative pattern...");
              const altQuery = `
                PREFIX schema: <https://schema.org/>
                
                SELECT ?asset ?ual ?topicId ?trustScore ?summary ?grokTitle ?wikiTitle ?createdAt WHERE {
                  ?asset schema:trustScore ?trustScore .
                  ?asset schema:topicId ?topicId .
                  OPTIONAL { ?asset schema:summary ?summary . }
                  OPTIONAL { ?asset schema:grokTitle ?grokTitle . }
                  OPTIONAL { ?asset schema:wikiTitle ?wikiTitle . }
                  OPTIONAL { ?asset schema:dateCreated ?createdAt . }
                  OPTIONAL { ?asset schema:identifier ?ual . }
                  FILTER (?trustScore >= 0 && ?trustScore <= 100)
                }
                ORDER BY DESC(?createdAt)
                LIMIT ${limit}
              `;
              try {
                const altResult = await ctx.dkg.graph.query(altQuery, "SELECT");
                if (altResult?.data && altResult.data.length > 0) {
                  console.log(`[Community Note Search] Alternative query found ${altResult.data.length} results`);
                  queryResult = altResult;
                }
              } catch (altErr) {
                console.warn("[Community Note Search] Alternative query also failed:", altErr);
              }
            }
          } catch (queryError) {
            const errorMessage = queryError instanceof Error ? queryError.message : String(queryError);
            console.error("[Community Note Search] SPARQL query error:", queryError);
            if (errorMessage.includes("500") || errorMessage.includes("status code 500")) {
              console.error("[Community Note Search] OT-Node returned 500 error. Remote testnet nodes may not support SPARQL queries.");
            }
            console.error("[Community Note Search] Error details:", {
              message: errorMessage
            });
            return res.json({
              found: false,
              count: 0,
              notes: [],
              error: errorMessage.includes("500") ? "" : "SPARQL query failed. The data may not be indexed yet."
            });
          }
          if (!queryResult || !queryResult.data || queryResult.data.length === 0) {
            return res.json({
              found: false,
              count: 0,
              notes: []
            });
          }
          const extractValue = (value) => {
            if (!value) return "";
            if (typeof value === "string") {
              let clean = value.replace(/^"|"$/g, "").replace(/\\"/g, '"');
              const typeMatch = clean.match(/^(.+?)\^\^.+$/);
              if (typeMatch && typeMatch[1]) {
                clean = typeMatch[1].replace(/^"|"$/g, "");
              }
              return clean;
            }
            if (value.value) {
              return extractValue(value.value);
            }
            return String(value);
          };
          const notes = queryResult.data.map((note) => {
            const assetUri = note.asset?.value || note.asset;
            const ual = note.ual?.value || note.ual || assetUri;
            return {
              topicId: extractValue(note.topicId),
              trustScore: parseFloat(extractValue(note.trustScore)) || 0,
              summary: extractValue(note.summary),
              grokTitle: extractValue(note.grokTitle),
              wikiTitle: extractValue(note.wikiTitle),
              createdAt: extractValue(note.createdAt),
              ual: ual || null,
              asset: assetUri || null
            };
          });
          res.json({
            found: true,
            count: notes.length,
            notes
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          res.status(500).json({
            found: false,
            count: 0,
            notes: [],
            error: `Failed to search Community Notes: ${error}`
          });
        }
      }
    )
  );
  api.post(
    "/parallelpedia/community-notes",
    (0, import_plugin_swagger.openAPIRoute)(
      {
        tag: "Parallelpedia",
        summary: "Publish a Community Note to DKG",
        description: "Publish a Community Note comparing Grokipedia vs Wikipedia as a Knowledge Asset",
        body: import_plugin_swagger.z.object({
          topicId: import_plugin_swagger.z.string().openapi({ description: "Topic identifier" }),
          trustScore: import_plugin_swagger.z.number().min(0).max(100).openapi({ description: "Trust score (0-100)" }),
          summary: import_plugin_swagger.z.string().openapi({ description: "Summary of findings" }),
          labelsCount: import_plugin_swagger.z.record(import_plugin_swagger.z.string(), import_plugin_swagger.z.number()).openapi({ description: "Count of each label type" }),
          keyExamples: import_plugin_swagger.z.array(
            import_plugin_swagger.z.object({
              text: import_plugin_swagger.z.string(),
              label: import_plugin_swagger.z.string()
            })
          ).optional().openapi({ description: "Key examples of discrepancies" }),
          grokTitle: import_plugin_swagger.z.string().openapi({ description: "Grokipedia article title" }),
          wikiTitle: import_plugin_swagger.z.string().openapi({ description: "Wikipedia article title" }),
          provenance: import_plugin_swagger.z.object({
            inputHash: import_plugin_swagger.z.string().optional(),
            createdBy: import_plugin_swagger.z.string().optional(),
            version: import_plugin_swagger.z.string().optional(),
            sources: import_plugin_swagger.z.object({
              grokUrl: import_plugin_swagger.z.string().optional(),
              wikiUrl: import_plugin_swagger.z.string().optional(),
              grokUal: import_plugin_swagger.z.string().optional(),
              wikiUal: import_plugin_swagger.z.string().optional()
            }).optional()
          }).optional().openapi({ description: "Provenance metadata" })
        }),
        response: {
          description: "Published Community Note with UAL",
          schema: import_plugin_swagger.z.object({
            success: import_plugin_swagger.z.boolean(),
            ual: import_plugin_swagger.z.string().nullable(),
            asset_id: import_plugin_swagger.z.string().nullable().optional(),
            error: import_plugin_swagger.z.string().nullable(),
            verification_url: import_plugin_swagger.z.string().optional(),
            operation_id: import_plugin_swagger.z.string().optional(),
            transaction_hash: import_plugin_swagger.z.string().optional(),
            full_response: import_plugin_swagger.z.any().optional()
          })
        }
      },
      async (req, res) => {
        const {
          topicId,
          trustScore,
          summary,
          labelsCount,
          keyExamples = [],
          grokTitle,
          wikiTitle,
          provenance = {}
        } = req.body;
        try {
          const jsonld = {
            "@context": {
              "@vocab": "https://schema.org/",
              parallelpedia: "https://parallelpedia.org/schema/"
            },
            "@type": "CommunityNote",
            topicId,
            trustScore,
            summary,
            labelsCount,
            keyExamples,
            grokTitle,
            wikiTitle,
            dateCreated: (/* @__PURE__ */ new Date()).toISOString(),
            provenance
          };
          if (!ctx.dkg) {
            console.error("DKG context is missing");
            return res.status(500).json({
              success: false,
              ual: null,
              error: "DKG context not available. Check DKG node initialization."
            });
          }
          if (!ctx.dkg.asset) {
            console.error("DKG asset client is missing");
            return res.status(500).json({
              success: false,
              ual: null,
              error: "DKG asset client not initialized. Check DKG_PUBLISH_WALLET and DKG configuration."
            });
          }
          if (typeof ctx.dkg.asset.create !== "function") {
            console.error("DKG asset.create is not a function:", typeof ctx.dkg.asset.create);
            return res.status(500).json({
              success: false,
              ual: null,
              error: "DKG asset.create is not available. Check DKG node configuration."
            });
          }
          try {
            const dkgOtnodeUrl = process.env.DKG_OTNODE_URL;
            const dkgBlockchain = process.env.DKG_BLOCKCHAIN;
            const dkgPublishWallet = process.env.DKG_PUBLISH_WALLET;
            let endpoint = "NOT SET";
            let port = "NOT SET";
            if (dkgOtnodeUrl) {
              try {
                const url = new URL(dkgOtnodeUrl);
                endpoint = url.hostname;
                port = url.port || "8900";
              } catch (e) {
                endpoint = dkgOtnodeUrl;
              }
            }
            console.log("=== DKG Configuration Validation ===");
            console.log("DKG_OTNODE_URL:", dkgOtnodeUrl || "NOT SET");
            console.log("Endpoint:", endpoint);
            console.log("Port:", port);
            console.log("DKG_BLOCKCHAIN:", dkgBlockchain || "NOT SET");
            console.log("DKG_PUBLISH_WALLET:", dkgPublishWallet ? "SET (hidden)" : "NOT SET");
            console.log("Has private key:", !!dkgPublishWallet);
            if (!dkgOtnodeUrl) {
              console.error("DKG endpoint is not configured");
              return res.status(500).json({
                success: false,
                ual: null,
                error: "DKG endpoint not configured. Set DKG_OTNODE_URL environment variable. Example: https://v6-pegasus-node-02.origin-trail.network:8900"
              });
            }
            if (!dkgBlockchain) {
              console.error("DKG blockchain is not configured");
              return res.status(500).json({
                success: false,
                ual: null,
                error: "DKG blockchain not configured. Set DKG_BLOCKCHAIN environment variable. Example: otp:20430 (testnet) or otp:2043 (mainnet)"
              });
            }
            if (!dkgPublishWallet) {
              console.error("DKG wallet private key is not configured");
              return res.status(500).json({
                success: false,
                ual: null,
                error: "DKG wallet private key not configured. Set DKG_PUBLISH_WALLET environment variable with your wallet's private key."
              });
            }
            console.log("=== DKG Configuration Valid ===");
          } catch (configErr) {
            console.error("Error validating DKG configuration:", configErr);
            return res.status(500).json({
              success: false,
              ual: null,
              error: `Failed to validate DKG configuration: ${configErr instanceof Error ? configErr.message : String(configErr)}`
            });
          }
          const wrapped = { public: jsonld };
          console.log("Attempting to publish Community Note to DKG...");
          console.log("Payload:", JSON.stringify(jsonld, null, 2));
          if (ctx.dkg) {
            console.log("=== DKG Client Status ===");
            console.log("DKG client available:", !!ctx.dkg);
            console.log("Asset create available:", !!ctx.dkg.asset?.create);
            console.log("OT-Node URL:", process.env.DKG_OTNODE_URL || "NOT SET");
            console.log("Blockchain:", process.env.DKG_BLOCKCHAIN || "NOT SET");
            console.log("Wallet configured:", !!process.env.DKG_PUBLISH_WALLET);
            console.log("=== END DKG Client Status ===");
          } else {
            console.error("ERROR: ctx.dkg is not available!");
          }
          const otnodeUrl = process.env.DKG_OTNODE_URL;
          if (otnodeUrl && otnodeUrl.startsWith("http://localhost")) {
            console.log("\u26A0\uFE0F  WARNING: Using localhost OT-Node. Ensure OT-Node is running at", otnodeUrl);
            console.log("   If OT-Node is not running locally, use a remote testnet node:");
            console.log("   DKG_OTNODE_URL=https://v6-pegasus-node-02.origin-trail.network:8900");
            try {
              const testUrl = new URL(otnodeUrl);
              const http = require("http");
              const https = require("https");
              const client = testUrl.protocol === "https:" ? https : http;
              await new Promise((resolve, reject) => {
                const req2 = client.get(testUrl.toString(), { timeout: 3e3 }, (res2) => {
                  resolve();
                  res2.destroy();
                });
                req2.on("error", (err) => {
                  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
                    console.error("\u274C OT-Node connectivity test FAILED:", err.code);
                    console.error("   The OT-Node at", otnodeUrl, "is not accessible.");
                    console.error("   Please either:");
                    console.error("   1. Start a local OT-Node, OR");
                    console.error("   2. Update DKG_OTNODE_URL to use a remote testnet node");
                    reject(err);
                  } else {
                    resolve();
                  }
                });
                req2.on("timeout", () => {
                  req2.destroy();
                  console.error("\u274C OT-Node connectivity test TIMED OUT");
                  reject(new Error("Connection timeout"));
                });
              });
              console.log("\u2705 OT-Node connectivity test passed");
            } catch (connectErr) {
              console.warn("\u26A0\uFE0F  OT-Node connectivity test failed, but proceeding with publish attempt...");
            }
          }
          let createAsset;
          try {
            createAsset = await ctx.dkg.asset.create(wrapped, {
              epochsNum: 2,
              minimumNumberOfFinalizationConfirmations: 3,
              minimumNumberOfNodeReplications: 1
            });
            console.log("=== DKG asset.create() FULL RESPONSE ===");
            console.log(JSON.stringify(createAsset, null, 2));
            console.log("=== END DKG asset.create() RESPONSE ===");
            const ual2 = createAsset?.UAL || createAsset?.ual || createAsset?.asset_id || createAsset?.dataSetId || null;
            if (ual2) {
              console.log("\u2705 Community Note published successfully!");
              console.log(`\u{1F4CB} UAL (Unique Asset Locator): ${ual2}`);
              console.log(`\u{1F517} You can verify this asset using: GET /api/dkg/assets?ual=${ual2}`);
            } else {
              console.warn("\u26A0\uFE0F  WARNING: Asset created but no UAL found in response!");
              console.warn("Response structure:", Object.keys(createAsset || {}));
            }
            if (createAsset?.operation?.publish?.errorType || createAsset?.operation?.publish?.errorMessage) {
              const errorType = createAsset.operation.publish.errorType;
              const errorMessage = createAsset.operation.publish.errorMessage;
              const operationId = createAsset.operation.publish.operationId;
              const status = createAsset.operation.publish.status;
              console.error("=== DKG API ERROR IN RESULT ===");
              console.error("Error Type:", errorType);
              console.error("Error Message:", errorMessage);
              console.error("Operation ID:", operationId);
              console.error("Status:", status);
              console.error("Full result:", JSON.stringify(createAsset, null, 2));
              console.error("=== END ERROR ===");
              const errorStr = (errorType + " " + errorMessage).toLowerCase();
              const isInsufficientFunds = errorStr.includes("revert") || errorStr.includes("insufficient funds") || errorStr.includes("vm exception") || errorStr.includes("execution reverted") || errorStr.includes("gas") || errorStr.includes("balance");
              const finalMessage = isInsufficientFunds ? `Unable to publish: Blockchain transaction failed. Your wallet likely needs testnet tokens (NEURO) to pay for gas fees. Error: ${errorType} - ${errorMessage}. To fix: Get testnet tokens from OriginTrail community (Discord/Telegram) for your wallet address.` : `Unable to publish: ${errorType} - ${errorMessage}. Operation ID: ${operationId}, Status: ${status}. Check DKG node logs above for full details.`;
              return res.status(500).json({
                success: false,
                ual: null,
                error: finalMessage
              });
            }
          } catch (createErr) {
            console.error("=== DKG asset.create() ERROR ===");
            console.error("Raw error:", createErr);
            console.error("Error type:", typeof createErr);
            console.error("Error constructor:", createErr?.constructor?.name);
            let createError = "";
            let errorDetails = "";
            const err = createErr;
            if (err?.response) {
              console.error("=== HTTP RESPONSE ERROR ===");
              console.error("Status:", err.response.status);
              console.error("Status Text:", err.response.statusText);
              console.error("Headers:", JSON.stringify(err.response.headers || {}, null, 2));
              try {
                console.error("Response Data:", JSON.stringify(err.response.data || err.response.body || {}, null, 2));
              } catch (e) {
                console.error("Response Data (raw):", err.response.data || err.response.body);
              }
              console.error("=== END HTTP RESPONSE ERROR ===");
            }
            if (err?.request || err?.config) {
              console.error("=== HTTP REQUEST INFO ===");
              console.error("URL:", err.request?.url || err.config?.url);
              console.error("Method:", err.request?.method || err.config?.method);
              console.error("Base URL:", err.config?.baseURL);
              console.error("=== END HTTP REQUEST INFO ===");
            }
            console.error("=== ERROR OBJECT INSPECTION ===");
            console.error("Error keys:", Object.keys(err || {}));
            console.error("Error code:", err?.code);
            console.error("Error syscall:", err?.syscall);
            console.error("Error address:", err?.address);
            console.error("Error port:", err?.port);
            console.error("Error errno:", err?.errno);
            console.error("Error cause:", err?.cause);
            if (err?.cause) {
              console.error("=== ERROR CAUSE INSPECTION ===");
              const cause = err.cause;
              console.error("Cause type:", typeof cause);
              console.error("Cause keys:", Object.keys(cause || {}));
              console.error("Cause code:", cause?.code);
              console.error("Cause errno:", cause?.errno);
              console.error("Cause syscall:", cause?.syscall);
              console.error("Cause message:", cause?.message);
              console.error("Cause stack:", cause?.stack);
              console.error("=== END ERROR CAUSE INSPECTION ===");
            }
            if (err && typeof err === "object") {
              console.error("=== ALL ERROR PROPERTIES (including non-enumerable) ===");
              const allProps = Object.getOwnPropertyNames(err);
              allProps.forEach((prop) => {
                try {
                  const value = err[prop];
                  const valueType = typeof value;
                  if (valueType === "object" && value !== null) {
                    console.error(`${prop}:`, JSON.stringify(value, null, 2).substring(0, 500));
                  } else {
                    console.error(`${prop}:`, value);
                  }
                } catch (e) {
                  console.error(`${prop}: [unable to access]`);
                }
              });
              console.error("=== END ALL ERROR PROPERTIES ===");
            }
            console.error("=== END ERROR OBJECT INSPECTION ===");
            const possibleErrorFields = [
              err?.message,
              err?.error,
              err?.reason,
              err?.errorMessage,
              err?.errorType,
              err?.response?.status,
              err?.response?.statusText,
              err?.response?.data?.error,
              err?.response?.data?.message,
              err?.response?.data?.detail,
              err?.response?.error,
              err?.data?.error,
              err?.data?.message,
              err?.operation?.publish?.errorMessage,
              err?.operation?.publish?.errorType,
              err?.code,
              // HTTP error codes like ECONNREFUSED, ETIMEDOUT, etc.
              err?.errno ? `errno: ${err.errno}` : null,
              err?.syscall ? `syscall: ${err.syscall}` : null
            ].filter(Boolean);
            if (createErr instanceof Error) {
              createError = createErr.message || createErr.toString() || "";
              const allProps = Object.getOwnPropertyNames(createErr);
              const errorObj = {};
              allProps.forEach((prop) => {
                try {
                  errorObj[prop] = createErr[prop];
                } catch (e) {
                  errorObj[prop] = "[unable to access]";
                }
              });
              errorDetails = JSON.stringify(errorObj, null, 2);
              if (createErr.stack) {
                console.error("Stack trace:", createErr.stack);
              }
            } else if (typeof createErr === "string") {
              createError = createErr;
              errorDetails = createErr;
            } else if (createErr && typeof createErr === "object") {
              createError = possibleErrorFields[0] || JSON.stringify(createErr);
              errorDetails = JSON.stringify(createErr, null, 2);
            } else {
              createError = String(createErr);
              errorDetails = String(createErr);
            }
            if (!createError || createError === "Unable to publish:" || createError.trim() === "") {
              const stackStr = err?.stack || "";
              const stackMatch = stackStr.match(/Error:\s*(.+?)(?:\n|$)/);
              if (stackMatch && stackMatch[1] && stackMatch[1].trim() !== "") {
                createError = stackMatch[1].trim();
              }
              if ((!createError || createError.trim() === "") && (err?.code || err?.errno || err?.cause?.code || err?.cause?.errno)) {
                const errorCode = err.code || (err.errno ? `errno-${err.errno}` : "") || err?.cause?.code || (err?.cause?.errno ? `errno-${err.cause.errno}` : "");
                const cause = err?.cause;
                const networkErrors = {
                  ECONNREFUSED: `Cannot connect to OT-Node at ${process.env.DKG_OTNODE_URL}. The OT-Node is not running or not accessible. For testnet, use: https://v6-pegasus-node-02.origin-trail.network:8900`,
                  ETIMEDOUT: "Connection to DKG node timed out. Check network connectivity.",
                  ENOTFOUND: `DKG node hostname not found. Check DKG_OTNODE_URL: ${process.env.DKG_OTNODE_URL}`,
                  ECONNRESET: "Connection to DKG node was reset.",
                  "errno-61": `Connection refused to OT-Node at ${process.env.DKG_OTNODE_URL}. The OT-Node is not running.`,
                  "errno-111": `Connection refused to OT-Node at ${process.env.DKG_OTNODE_URL}. The OT-Node is not running.`
                };
                const networkError = networkErrors[errorCode] || (errorCode ? `Network error: ${errorCode}${err.syscall || cause?.syscall ? ` (${err.syscall || cause.syscall})` : ""}${err.address || cause?.address ? ` to ${err.address || cause.address}:${err.port || cause.port || ""}` : ""}` : "");
                if (networkError) {
                  createError = networkError;
                }
              }
              if (!createError || createError.trim() === "") {
                const dkgConfig = ctx.dkg.config || {};
                const blockchain = dkgConfig.blockchain || {};
                if (!blockchain.privateKey) {
                  createError = "DKG wallet private key not configured. Set DKG_PUBLISH_WALLET environment variable.";
                } else if (!dkgConfig.endpoint && !dkgConfig.hostname) {
                  createError = "DKG endpoint not configured. Set DKG_OTNODE_URL environment variable.";
                } else {
                  createError = "Unknown error from dkg.js. Check DKG node logs and ensure OT-Node is running and accessible.";
                }
              }
            }
            console.error("Possible error fields found:", possibleErrorFields);
            console.error("Extracted error message:", createError);
            console.error("Full error details:", errorDetails);
            console.error("=== END ERROR ===");
            const errorStr = (createError + " " + errorDetails + " " + possibleErrorFields.join(" ")).toLowerCase();
            const isInsufficientFunds = errorStr.includes("revert") || errorStr.includes("insufficient funds") || errorStr.includes("vm exception") || errorStr.includes("execution reverted") || errorStr.includes("gas") || errorStr.includes("balance");
            const errorMessage = createError || possibleErrorFields.join(", ") || errorDetails || "Unknown error from dkg.js HttpService.publish";
            let finalMessage = "";
            if (isInsufficientFunds) {
              finalMessage = `Unable to publish: Blockchain transaction failed. Your wallet likely needs testnet tokens (NEURO) to pay for gas fees. Error: ${errorMessage}. To fix: Get testnet tokens from OriginTrail community (Discord/Telegram) for your wallet address.`;
            } else if (!errorMessage || errorMessage.trim() === "" || errorMessage === "Unable to publish:") {
              const dkgOtnodeUrl = process.env.DKG_OTNODE_URL || "NOT SET";
              const dkgBlockchain = process.env.DKG_BLOCKCHAIN || "NOT SET";
              const hasWallet = !!process.env.DKG_PUBLISH_WALLET;
              finalMessage = `Unable to publish: Empty error message from dkg.js. This usually indicates one of the following issues:

1. **OT-Node Connection**: Cannot connect to OT-Node. Check:
   - Is DKG_OTNODE_URL set correctly? (Current: ${dkgOtnodeUrl})
   - Is the OT-Node running and accessible?
   - For testnet, use: https://v6-pegasus-node-02.origin-trail.network:8900

2. **Wallet Configuration**: Check if DKG_PUBLISH_WALLET is set: ${hasWallet ? "YES" : "NO"}

3. **Blockchain Configuration**: Check if DKG_BLOCKCHAIN is set: ${dkgBlockchain}

4. **Network Issues**: Check firewall/network connectivity to OT-Node

Check the DKG node logs above for more details. Full error object: ${errorDetails.substring(0, 500)}`;
            } else {
              finalMessage = `Unable to publish: ${errorMessage}. Check DKG node logs above for full details.`;
            }
            return res.status(500).json({
              success: false,
              ual: null,
              error: finalMessage
            });
          }
          const ual = createAsset?.UAL || createAsset?.ual || createAsset?.asset_id || createAsset?.dataSetId || createAsset?.operation?.publish?.ual || null;
          if (!ual) {
            console.error("\u274C Asset created but no UAL returned!");
            console.error("Response structure:", createAsset ? Object.keys(createAsset) : "null");
            console.error("Full response:", JSON.stringify(createAsset, null, 2));
            return res.status(500).json({
              success: false,
              ual: null,
              error: "Failed to create Knowledge Asset - no UAL returned. Check DKG node logs above for full response.",
              full_response: createAsset
              // Include full response for debugging
            });
          }
          console.log("\u2705 Successfully published Community Note!");
          console.log(`\u{1F4CB} UAL (Unique Asset Locator): ${ual}`);
          console.log(`\u{1F517} Verify asset: GET /api/dkg/assets?ual=${ual}`);
          res.json({
            success: true,
            ual,
            asset_id: ual,
            // Also include as asset_id for backward compatibility
            error: null,
            verification_url: `/api/dkg/assets?ual=${ual}`,
            // Include additional info from response if available
            operation_id: createAsset?.operation?.publish?.operationId,
            transaction_hash: createAsset?.operation?.mintKnowledgeCollection?.transactionHash
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : void 0;
          console.error("Error publishing Community Note:", error);
          if (stack) console.error("Stack:", stack);
          res.status(500).json({
            success: false,
            ual: null,
            error: `Failed to publish Community Note: ${error || "Unknown error. Check DKG node configuration and logs."}`
          });
        }
      }
    )
  );
});
