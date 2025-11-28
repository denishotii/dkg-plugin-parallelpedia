import { defineDkgPlugin } from "@dkg/plugins";
import { openAPIRoute, z } from "@dkg/plugin-swagger";
import { withSourceKnowledgeAssets } from "@dkg/plugin-dkg-essentials/utils";

/**
 * Validates that the DKG is configured to use a remote OT-Node, not localhost.
 * This ensures community notes are queried from the remote DKG network.
 * 
 * @throws Error if localhost is detected or OT-Node URL is not configured
 */
function validateRemoteOtnode(): void {
  const otnodeUrl = process.env.DKG_OTNODE_URL;
  
  if (!otnodeUrl) {
    throw new Error(
      "DKG_OTNODE_URL is not configured. " +
      "Please set DKG_OTNODE_URL to a remote OT-Node (e.g., https://v6-pegasus-node-02.origin-trail.network:8900). " +
      "Community notes must be queried from the remote DKG network, not a local node."
    );
  }
  
  // Check if it's localhost or 127.0.0.1
  const urlLower = otnodeUrl.toLowerCase();
  if (
    urlLower.includes("localhost") ||
    urlLower.includes("127.0.0.1") ||
    urlLower.startsWith("http://localhost") ||
    urlLower.startsWith("http://127.0.0.1")
  ) {
    throw new Error(
      `DKG_OTNODE_URL is configured to use a local node (${otnodeUrl}). ` +
      "Community notes must be queried from a remote OT-Node connected to the DKG network. " +
      "Please set DKG_OTNODE_URL to a remote node, for example: " +
      "https://v6-pegasus-node-02.origin-trail.network:8900"
    );
  }
  
  // Ensure it's a remote URL (starts with https:// or http:// and has a domain)
  try {
    const url = new URL(otnodeUrl);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") {
      throw new Error(
        `DKG_OTNODE_URL points to a local address (${url.hostname}). ` +
        "Community notes must be queried from a remote OT-Node. " +
        "Please set DKG_OTNODE_URL to a remote node, for example: " +
        "https://v6-pegasus-node-02.origin-trail.network:8900"
      );
    }
  } catch (urlError) {
    // If URL parsing fails, it might be a malformed URL, but we already checked for localhost above
    // So we'll let it pass if it doesn't contain localhost
  }
}

/**
 * Parallelpedia Plugin
 * 
 * Provides MCP tools and API routes for:
 * - Querying Community Notes from DKG
 * - Getting trust scores and analysis for topics
 * - Publishing Community Notes to DKG
 */
export default defineDkgPlugin((ctx, mcp, api) => {
  /**
   * MCP Tool: Get Community Note for a topic
   * Allows AI agents to query Community Notes from the DKG
   */
  mcp.registerTool(
    "parallelpedia-get-community-note",
    {
      title: "Get Community Note",
      description:
        "Retrieve a Community Note for a specific topic comparing Grokipedia vs Wikipedia. " +
        "Returns trust score, summary, and key discrepancies found.",
      inputSchema: {
        topicId: z
          .string()
          .describe("Topic identifier (e.g., 'Climate_change', 'Artificial_intelligence')"),
      },
    },
    async ({ topicId }) => {
      try {
        // Validate that we're using a remote OT-Node, not localhost
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
                    error: errorMessage,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        
        // Query DKG for Community Notes with this topic_id
        // Note: SPARQL query structure may need adjustment based on actual DKG data structure
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
          // If SPARQL query fails, try alternative approach: search all assets and filter
          // This is a fallback - in production, you'd want proper SPARQL support
          console.warn("SPARQL query failed, trying alternative approach:", queryError);
          queryResult = null;
        }

        if (
          !queryResult ||
          !queryResult.data ||
          queryResult.data.length === 0
        ) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    topicId,
                    found: false,
                    message:
                      "No Community Note found for this topic. You may want to create one first.",
                  },
                  null,
                  2,
                ),
              },
            ],
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
                    message: "No Community Note found for this topic.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        
        // Helper function to extract clean value from SPARQL result
        const extractValue = (value: any): string => {
          if (!value) return "";
          if (typeof value === 'string') {
            // Remove quotes and type annotations (e.g., "value"^^type -> value)
            let clean = value.replace(/^"|"$/g, '').replace(/\\"/g, '"');
            // Remove type annotation if present
            const typeMatch = clean.match(/^(.+?)\^\^.+$/);
            if (typeMatch && typeMatch[1]) {
              clean = typeMatch[1].replace(/^"|"$/g, '');
            }
            return clean;
          }
          if (value.value) {
            return extractValue(value.value);
          }
          return String(value);
        };

        const ual = note.ual?.value || note.ual || note.asset?.value || note.asset;
        
        // Get full asset details if UAL is available
        let assetDetails = null;
        
        if (ual) {
          try {
            assetDetails = await ctx.dkg.asset.get(ual, {
              includeMetadata: true,
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
          assetDetails: assetDetails || null,
        };

        return withSourceKnowledgeAssets(
          {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, 2),
              },
            ],
          },
          ual
            ? [
                {
                  title: `Community Note: ${topicId}`,
                  issuer: "Parallelpedia",
                  ual: ual,
                },
              ]
            : [],
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
                  error: `Failed to query Community Note: ${error}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  /**
   * MCP Tool: Search Community Notes
   * Allows AI agents to search for Community Notes by keywords or trust score range
   */
  mcp.registerTool(
    "parallelpedia-search-community-notes",
    {
      title: "Search Community Notes",
      description:
        "Search for Community Notes by topic keywords or filter by trust score range. " +
        "Returns a list of matching Community Notes.",
      inputSchema: {
        keyword: z
          .string()
          .optional()
          .describe("Search keyword to match against topic IDs or titles"),
        minTrustScore: z
          .number()
          .optional()
          .describe("Minimum trust score (0-100)"),
        maxTrustScore: z
          .number()
          .optional()
          .describe("Maximum trust score (0-100)"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of results to return"),
      },
    },
    async ({ keyword, minTrustScore, maxTrustScore, limit = 10 }) => {
      try {
        // Validate that we're using a remote OT-Node, not localhost
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
                    error: errorMessage,
                  },
                  null,
                  2,
                ),
              },
            ],
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

        if (minTrustScore !== undefined) {
          query += `FILTER (?trustScore >= ${minTrustScore})`;
        }

        if (maxTrustScore !== undefined) {
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
          // Return empty results if query fails (e.g., no data in DKG yet)
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    found: false,
                    count: 0,
                    notes: [],
                    message: "No Community Notes found matching the criteria.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (
          !queryResult ||
          !queryResult.data ||
          queryResult.data.length === 0
        ) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    found: false,
                    count: 0,
                    notes: [],
                    message: "No Community Notes found matching the criteria.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // Helper function to extract clean value from SPARQL result
        const extractValue = (value: any): string => {
          if (!value) return "";
          if (typeof value === 'string') {
            // Remove quotes and type annotations (e.g., "value"^^type -> value)
            let clean = value.replace(/^"|"$/g, '').replace(/\\"/g, '"');
            // Remove type annotation if present
            const typeMatch = clean.match(/^(.+?)\^\^.+$/);
            if (typeMatch && typeMatch[1]) {
              clean = typeMatch[1].replace(/^"|"$/g, '');
            }
            return clean;
          }
          if (value.value) {
            return extractValue(value.value);
          }
          return String(value);
        };

        // Extract clean values from SPARQL results
        const notes = queryResult.data.map((note: any) => {
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
                  notes,
                },
                null,
                2,
              ),
            },
          ],
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
                  error: `Failed to search Community Notes: ${error}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  /**
   * API Route: Get Community Note
   * REST endpoint for fetching Community Notes
   */
  api.get(
    "/parallelpedia/community-notes/:topicId",
    openAPIRoute(
      {
        tag: "Parallelpedia",
        summary: "Get Community Note for a topic",
        description:
          "Retrieve a Community Note comparing Grokipedia vs Wikipedia for a specific topic",
        params: z.object({
          topicId: z.string().openapi({
            description: "Topic identifier",
            example: "Climate_change",
          }),
        }),
        response: {
          description: "Community Note data",
          schema: z.object({
            topicId: z.string(),
            found: z.boolean(),
            trustScore: z.number().optional(),
            summary: z.string().optional(),
            grokTitle: z.string().optional(),
            wikiTitle: z.string().optional(),
            createdAt: z.string().optional(),
            ual: z.string().nullable().optional(),
          }),
        },
      },
      async (req, res) => {
        const { topicId } = req.params;

        try {
          // Validate that we're using a remote OT-Node, not localhost
          try {
            validateRemoteOtnode();
          } catch (validationError) {
            const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
            console.error("[Community Note Query] Remote OT-Node validation failed:", errorMessage);
            return res.status(400).json({
              topicId,
              found: false,
              error: errorMessage,
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
              resultKeys: queryResult ? Object.keys(queryResult) : [],
            });
          } catch (queryError) {
            console.error("[Community Note Query] SPARQL query error:", queryError);
            const errorMessage = queryError instanceof Error ? queryError.message : String(queryError);
            const errorDetails: any = {
              message: errorMessage,
              stack: queryError instanceof Error ? queryError.stack : undefined,
            };
            
            // Check if it's a 500 error from OT-Node
            if (errorMessage.includes("500") || errorMessage.includes("status code 500")) {
              console.error("[Community Note Query] OT-Node returned 500 error. This is common with remote testnet nodes.");
              console.error("[Community Note Query] Remote OT-Nodes may not support SPARQL queries immediately, or the data may not be indexed yet.");
              console.error("[Community Note Query] To retrieve your published asset, use the UAL from the publish response:");
              console.error("[Community Note Query]   GET /api/dkg/assets?ual=YOUR_UAL_HERE");
            }
            
            console.error("[Community Note Query] Error details:", errorDetails);
            
            // Return 404 if query fails (e.g., no data in DKG yet)
            return res.status(404).json({
              topicId,
              found: false,
              error: errorMessage.includes("500") 
                ? ""
                : "SPARQL query failed. The data may not be indexed yet, or the query syntax may need adjustment.",
            });
          }

          if (
            !queryResult ||
            !queryResult.data ||
            queryResult.data.length === 0
          ) {
            return res.status(404).json({
              topicId,
              found: false,
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
                    message: "No Community Note found for this topic.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
          
          // Helper function to extract clean value from SPARQL result
          const extractValue = (value: any): string => {
            if (!value) return "";
            if (typeof value === 'string') {
              // Remove quotes and type annotations (e.g., "value"^^type -> value)
              let clean = value.replace(/^"|"$/g, '').replace(/\\"/g, '"');
              // Remove type annotation if present
              const typeMatch = clean.match(/^(.+?)\^\^.+$/);
              if (typeMatch && typeMatch[1]) {
                clean = typeMatch[1].replace(/^"|"$/g, '');
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
            ual: ual || null,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          res.status(500).json({
            topicId,
            found: false,
            error: `Failed to query Community Note: ${error}`,
          });
        }
      },
    ),
  );

  /**
   * API Route: Search Community Notes
   * REST endpoint for searching Community Notes
   */
  api.get(
    "/parallelpedia/community-notes",
    openAPIRoute(
      {
        tag: "Parallelpedia",
        summary: "Search Community Notes",
        description: "Search for Community Notes by keyword or trust score",
        query: z.object({
          keyword: z.string().optional(),
          minTrustScore: z
            .number({ coerce: true })
            .optional()
            .openapi({ description: "Minimum trust score (0-100)" }),
          maxTrustScore: z
            .number({ coerce: true })
            .optional()
            .openapi({ description: "Maximum trust score (0-100)" }),
          limit: z
            .number({ coerce: true })
            .optional()
            .default(10)
            .openapi({ description: "Maximum results" }),
        }),
        response: {
          description: "List of Community Notes",
          schema: z.object({
            found: z.boolean(),
            count: z.number(),
            notes: z.array(
              z.object({
                topicId: z.string(),
                trustScore: z.number(),
                summary: z.string(),
                grokTitle: z.string(),
                wikiTitle: z.string(),
                createdAt: z.string(),
                ual: z.string().nullable(),
              }),
            ),
          }),
        },
      },
      async (req, res) => {
        const { keyword, minTrustScore, maxTrustScore, limit = 10 } =
          req.query;

        try {
          // Validate that we're using a remote OT-Node, not localhost
          try {
            validateRemoteOtnode();
          } catch (validationError) {
            const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
            console.error("[Community Note Search] Remote OT-Node validation failed:", errorMessage);
            return res.status(400).json({
              found: false,
              count: 0,
              notes: [],
              error: errorMessage,
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

          if (minTrustScore !== undefined) {
            query += `FILTER (?trustScore >= ${minTrustScore})`;
          }

          if (maxTrustScore !== undefined) {
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
              limit,
            });
            queryResult = await ctx.dkg.graph.query(query, "SELECT");
            console.log(`[Community Note Search] Query result:`, {
              hasData: !!queryResult?.data,
              dataLength: queryResult?.data?.length || 0,
            });
            
            // If no results and no filters, try alternative query pattern
            if ((!queryResult?.data || queryResult.data.length === 0) && !keyword && minTrustScore === undefined && maxTrustScore === undefined) {
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
            
            // Check if it's a 500 error from OT-Node
            if (errorMessage.includes("500") || errorMessage.includes("status code 500")) {
              console.error("[Community Note Search] OT-Node returned 500 error. Remote testnet nodes may not support SPARQL queries.");
            }
            
            console.error("[Community Note Search] Error details:", {
              message: errorMessage,
            });
            
            // Return empty results if query fails (e.g., no data in DKG yet)
            return res.json({
              found: false,
              count: 0,
              notes: [],
              error: errorMessage.includes("500")
                ? ""
                : "SPARQL query failed. The data may not be indexed yet.",
            });
          }

          if (
            !queryResult ||
            !queryResult.data ||
            queryResult.data.length === 0
          ) {
            return res.json({
              found: false,
              count: 0,
              notes: [],
            });
          }

          // Helper function to extract clean value from SPARQL result
          const extractValue = (value: any): string => {
            if (!value) return "";
            if (typeof value === 'string') {
              // Remove quotes and type annotations (e.g., "value"^^type -> value)
              let clean = value.replace(/^"|"$/g, '').replace(/\\"/g, '"');
              // Remove type annotation if present
              const typeMatch = clean.match(/^(.+?)\^\^.+$/);
              if (typeMatch && typeMatch[1]) {
                clean = typeMatch[1].replace(/^"|"$/g, '');
              }
              return clean;
            }
            if (value.value) {
              return extractValue(value.value);
            }
            return String(value);
          };

          // Extract clean values from SPARQL results
          const notes = queryResult.data.map((note: any) => {
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
              asset: assetUri || null,
            };
          });

          res.json({
            found: true,
            count: notes.length,
            notes,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          res.status(500).json({
            found: false,
            count: 0,
            notes: [],
            error: `Failed to search Community Notes: ${error}`,
          });
        }
      },
    ),
  );

  /**
   * API Route: Publish Community Note
   * REST endpoint for publishing Community Notes to DKG
   */
  api.post(
    "/parallelpedia/community-notes",
    openAPIRoute(
      {
        tag: "Parallelpedia",
        summary: "Publish a Community Note to DKG",
        description:
          "Publish a Community Note comparing Grokipedia vs Wikipedia as a Knowledge Asset",
        body: z.object({
          topicId: z.string().openapi({ description: "Topic identifier" }),
          trustScore: z
            .number()
            .min(0)
            .max(100)
            .openapi({ description: "Trust score (0-100)" }),
          summary: z.string().openapi({ description: "Summary of findings" }),
          labelsCount: z
            .record(z.string(), z.number())
            .openapi({ description: "Count of each label type" }),
          keyExamples: z
            .array(
              z.object({
                text: z.string(),
                label: z.string(),
              }),
            )
            .optional()
            .openapi({ description: "Key examples of discrepancies" }),
          grokTitle: z.string().openapi({ description: "Grokipedia article title" }),
          wikiTitle: z.string().openapi({ description: "Wikipedia article title" }),
          provenance: z
            .object({
              inputHash: z.string().optional(),
              createdBy: z.string().optional(),
              version: z.string().optional(),
              sources: z
                .object({
                  grokUrl: z.string().optional(),
                  wikiUrl: z.string().optional(),
                  grokUal: z.string().optional(),
                  wikiUal: z.string().optional(),
                })
                .optional(),
            })
            .optional()
            .openapi({ description: "Provenance metadata" }),
        }),
        response: {
          description: "Published Community Note with UAL",
          schema: z.object({
            success: z.boolean(),
            ual: z.string().nullable(),
            asset_id: z.string().nullable().optional(),
            error: z.string().nullable(),
            verification_url: z.string().optional(),
            operation_id: z.string().optional(),
            transaction_hash: z.string().optional(),
            full_response: z.any().optional(),
          }),
        },
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
          provenance = {},
        } = req.body;

        try {
          // Create JSON-LD structure
          const jsonld = {
            "@context": {
              "@vocab": "https://schema.org/",
              parallelpedia: "https://parallelpedia.org/schema/",
            },
            "@type": "CommunityNote",
            topicId,
            trustScore,
            summary,
            labelsCount,
            keyExamples,
            grokTitle,
            wikiTitle,
            dateCreated: new Date().toISOString(),
            provenance,
          };

          // Check if DKG client is available
          if (!ctx.dkg) {
            console.error("DKG context is missing");
            return res.status(500).json({
              success: false,
              ual: null,
              error: "DKG context not available. Check DKG node initialization.",
            });
          }

          if (!ctx.dkg.asset) {
            console.error("DKG asset client is missing");
            return res.status(500).json({
              success: false,
              ual: null,
              error: "DKG asset client not initialized. Check DKG_PUBLISH_WALLET and DKG configuration.",
            });
          }

          if (typeof ctx.dkg.asset.create !== "function") {
            console.error("DKG asset.create is not a function:", typeof ctx.dkg.asset.create);
            return res.status(500).json({
              success: false,
              ual: null,
              error: "DKG asset.create is not available. Check DKG node configuration.",
            });
          }

          // Validate DKG configuration before attempting to publish
          // Read from environment variables (same as server initialization)
          try {
            const dkgOtnodeUrl = process.env.DKG_OTNODE_URL;
            const dkgBlockchain = process.env.DKG_BLOCKCHAIN;
            const dkgPublishWallet = process.env.DKG_PUBLISH_WALLET;
            
            // Parse endpoint from URL if provided
            let endpoint = "NOT SET";
            let port = "NOT SET";
            if (dkgOtnodeUrl) {
              try {
                const url = new URL(dkgOtnodeUrl);
                endpoint = url.hostname;
                port = url.port || "8900";
              } catch (e) {
                endpoint = dkgOtnodeUrl; // Use as-is if not a valid URL
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
                error: "DKG endpoint not configured. Set DKG_OTNODE_URL environment variable. Example: https://v6-pegasus-node-02.origin-trail.network:8900",
              });
            }
            
            if (!dkgBlockchain) {
              console.error("DKG blockchain is not configured");
              return res.status(500).json({
                success: false,
                ual: null,
                error: "DKG blockchain not configured. Set DKG_BLOCKCHAIN environment variable. Example: otp:20430 (testnet) or otp:2043 (mainnet)",
              });
            }
            
            if (!dkgPublishWallet) {
              console.error("DKG wallet private key is not configured");
              return res.status(500).json({
                success: false,
                ual: null,
                error: "DKG wallet private key not configured. Set DKG_PUBLISH_WALLET environment variable with your wallet's private key.",
              });
            }
            
            console.log("=== DKG Configuration Valid ===");
          } catch (configErr) {
            console.error("Error validating DKG configuration:", configErr);
            return res.status(500).json({
              success: false,
              ual: null,
              error: `Failed to validate DKG configuration: ${configErr instanceof Error ? configErr.message : String(configErr)}`,
            });
          }

          // Publish to DKG using the same method as dkg-create tool
          const wrapped = { public: jsonld };
          console.log("Attempting to publish Community Note to DKG...");
          console.log("Payload:", JSON.stringify(jsonld, null, 2));
          
          // Log DKG configuration for debugging
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
          
          // Test OT-Node connectivity before attempting to publish
          const otnodeUrl = process.env.DKG_OTNODE_URL;
          if (otnodeUrl && otnodeUrl.startsWith("http://localhost")) {
            console.log("⚠️  WARNING: Using localhost OT-Node. Ensure OT-Node is running at", otnodeUrl);
            console.log("   If OT-Node is not running locally, use a remote testnet node:");
            console.log("   DKG_OTNODE_URL=https://v6-pegasus-node-02.origin-trail.network:8900");
            
            // Try a quick connectivity test
            try {
              const testUrl = new URL(otnodeUrl);
              const http = require("http");
              const https = require("https");
              const client = testUrl.protocol === "https:" ? https : http;
              
              await new Promise<void>((resolve, reject) => {
                const req = client.get(testUrl.toString(), { timeout: 3000 }, (res: any) => {
                  resolve();
                  res.destroy();
                });
                req.on("error", (err: any) => {
                  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
                    console.error("❌ OT-Node connectivity test FAILED:", err.code);
                    console.error("   The OT-Node at", otnodeUrl, "is not accessible.");
                    console.error("   Please either:");
                    console.error("   1. Start a local OT-Node, OR");
                    console.error("   2. Update DKG_OTNODE_URL to use a remote testnet node");
                    reject(err);
                  } else {
                    resolve(); // Other errors might be OK (like 404)
                  }
                });
                req.on("timeout", () => {
                  req.destroy();
                  console.error("❌ OT-Node connectivity test TIMED OUT");
                  reject(new Error("Connection timeout"));
                });
              });
              console.log("✅ OT-Node connectivity test passed");
            } catch (connectErr: any) {
              // If connectivity test fails, we'll still try to publish but log the issue
              console.warn("⚠️  OT-Node connectivity test failed, but proceeding with publish attempt...");
            }
          }
          
          let createAsset;
          try {
            createAsset = await ctx.dkg.asset.create(wrapped, {
              epochsNum: 2,
              minimumNumberOfFinalizationConfirmations: 3,
              minimumNumberOfNodeReplications: 1,
            });
            
            // Log the full response from DKG
            console.log("=== DKG asset.create() FULL RESPONSE ===");
            console.log(JSON.stringify(createAsset, null, 2));
            console.log("=== END DKG asset.create() RESPONSE ===");
            
            // Extract and log UAL in various possible formats
            const ual = createAsset?.UAL || createAsset?.ual || createAsset?.asset_id || createAsset?.dataSetId || null;
            if (ual) {
              console.log("✅ Community Note published successfully!");
              console.log(`📋 UAL (Unique Asset Locator): ${ual}`);
              console.log(`🔗 You can verify this asset using: GET /api/dkg/assets?ual=${ual}`);
            } else {
              console.warn("⚠️  WARNING: Asset created but no UAL found in response!");
              console.warn("Response structure:", Object.keys(createAsset || {}));
            }
            
            // Check for DKG API errors in the result (dkg.js may return errors in result instead of throwing)
            if (
              createAsset?.operation?.publish?.errorType ||
              createAsset?.operation?.publish?.errorMessage
            ) {
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
              const isInsufficientFunds = 
                errorStr.includes("revert") || 
                errorStr.includes("insufficient funds") ||
                errorStr.includes("vm exception") ||
                errorStr.includes("execution reverted") ||
                errorStr.includes("gas") ||
                errorStr.includes("balance");
              
              const finalMessage = isInsufficientFunds
                ? `Unable to publish: Blockchain transaction failed. Your wallet likely needs testnet tokens (NEURO) to pay for gas fees. Error: ${errorType} - ${errorMessage}. To fix: Get testnet tokens from OriginTrail community (Discord/Telegram) for your wallet address.`
                : `Unable to publish: ${errorType} - ${errorMessage}. Operation ID: ${operationId}, Status: ${status}. Check DKG node logs above for full details.`;
              
              return res.status(500).json({
                success: false,
                ual: null,
                error: finalMessage,
              });
            }
          } catch (createErr) {
            // Log the full error object with all possible properties
            console.error("=== DKG asset.create() ERROR ===");
            console.error("Raw error:", createErr);
            console.error("Error type:", typeof createErr);
            console.error("Error constructor:", createErr?.constructor?.name);
            
            // Try multiple ways to extract error message
            let createError = "";
            let errorDetails = "";
            
            // Check for dkg.js specific error properties
            const err = createErr as any;
            
            // Deep inspection of HTTP response if available
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
            
            // Check for request info
            if (err?.request || err?.config) {
              console.error("=== HTTP REQUEST INFO ===");
              console.error("URL:", err.request?.url || err.config?.url);
              console.error("Method:", err.request?.method || err.config?.method);
              console.error("Base URL:", err.config?.baseURL);
              console.error("=== END HTTP REQUEST INFO ===");
            }
            
            // Log all error properties for debugging
            console.error("=== ERROR OBJECT INSPECTION ===");
            console.error("Error keys:", Object.keys(err || {}));
            console.error("Error code:", err?.code);
            console.error("Error syscall:", err?.syscall);
            console.error("Error address:", err?.address);
            console.error("Error port:", err?.port);
            console.error("Error errno:", err?.errno);
            console.error("Error cause:", err?.cause);
            
            // Deep inspection - check if error has nested properties
            if (err?.cause) {
              console.error("=== ERROR CAUSE INSPECTION ===");
              const cause = err.cause as any;
              console.error("Cause type:", typeof cause);
              console.error("Cause keys:", Object.keys(cause || {}));
              console.error("Cause code:", cause?.code);
              console.error("Cause errno:", cause?.errno);
              console.error("Cause syscall:", cause?.syscall);
              console.error("Cause message:", cause?.message);
              console.error("Cause stack:", cause?.stack);
              console.error("=== END ERROR CAUSE INSPECTION ===");
            }
            
            // Try to get all properties including non-enumerable ones
            if (err && typeof err === "object") {
              console.error("=== ALL ERROR PROPERTIES (including non-enumerable) ===");
              const allProps = Object.getOwnPropertyNames(err);
              allProps.forEach(prop => {
                try {
                  const value = (err as any)[prop];
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
              err?.code, // HTTP error codes like ECONNREFUSED, ETIMEDOUT, etc.
              err?.errno ? `errno: ${err.errno}` : null,
              err?.syscall ? `syscall: ${err.syscall}` : null,
            ].filter(Boolean);
            
            if (createErr instanceof Error) {
              createError = createErr.message || createErr.toString() || "";
              // Try to get all enumerable and non-enumerable properties
              const allProps = Object.getOwnPropertyNames(createErr);
              const errorObj: any = {};
              allProps.forEach(prop => {
                try {
                  errorObj[prop] = (createErr as any)[prop];
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
              // Try all possible error fields
              createError = possibleErrorFields[0] || JSON.stringify(createErr);
              errorDetails = JSON.stringify(createErr, null, 2);
            } else {
              createError = String(createErr);
              errorDetails = String(createErr);
            }
            
            // If we still don't have a message, try to extract from stack
            if (!createError || createError === "Unable to publish:" || createError.trim() === "") {
              const stackStr = err?.stack || "";
              // Look for error patterns in stack
              const stackMatch = stackStr.match(/Error:\s*(.+?)(?:\n|$)/);
              if (stackMatch && stackMatch[1] && stackMatch[1].trim() !== "") {
                createError = stackMatch[1].trim();
              }
              
              // If still empty, check for network errors (including in cause chain)
              if ((!createError || createError.trim() === "") && (err?.code || err?.errno || (err?.cause as any)?.code || (err?.cause as any)?.errno)) {
                const errorCode = err.code || (err.errno ? `errno-${err.errno}` : "") || 
                                  ((err?.cause as any)?.code) || 
                                  (((err?.cause as any)?.errno) ? `errno-${(err.cause as any).errno}` : "");
                const cause = err?.cause as any;
                const networkErrors: Record<string, string> = {
                  ECONNREFUSED: `Cannot connect to OT-Node at ${process.env.DKG_OTNODE_URL}. The OT-Node is not running or not accessible. For testnet, use: https://v6-pegasus-node-02.origin-trail.network:8900`,
                  ETIMEDOUT: "Connection to DKG node timed out. Check network connectivity.",
                  ENOTFOUND: `DKG node hostname not found. Check DKG_OTNODE_URL: ${process.env.DKG_OTNODE_URL}`,
                  ECONNRESET: "Connection to DKG node was reset.",
                  "errno-61": `Connection refused to OT-Node at ${process.env.DKG_OTNODE_URL}. The OT-Node is not running.`,
                  "errno-111": `Connection refused to OT-Node at ${process.env.DKG_OTNODE_URL}. The OT-Node is not running.`,
                };
                const networkError = networkErrors[errorCode] || 
                  (errorCode ? `Network error: ${errorCode}${(err.syscall || cause?.syscall) ? ` (${err.syscall || cause.syscall})` : ""}${(err.address || cause?.address) ? ` to ${err.address || cause.address}:${err.port || cause.port || ""}` : ""}` : "");
                if (networkError) {
                  createError = networkError;
                }
              }
              
              // If still empty, provide a generic message based on what we know
              if (!createError || createError.trim() === "") {
                const dkgConfig = (ctx.dkg as any).config || {};
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
            
            // Check if error is related to insufficient funds or blockchain issues
            const errorStr = (createError + " " + errorDetails + " " + possibleErrorFields.join(" ")).toLowerCase();
            const isInsufficientFunds = 
              errorStr.includes("revert") || 
              errorStr.includes("insufficient funds") ||
              errorStr.includes("vm exception") ||
              errorStr.includes("execution reverted") ||
              errorStr.includes("gas") ||
              errorStr.includes("balance");
            
            const errorMessage = createError || possibleErrorFields.join(", ") || errorDetails || "Unknown error from dkg.js HttpService.publish";
            
            // Build comprehensive error message with troubleshooting steps
            let finalMessage = "";
            if (isInsufficientFunds) {
              finalMessage = `Unable to publish: Blockchain transaction failed. Your wallet likely needs testnet tokens (NEURO) to pay for gas fees. Error: ${errorMessage}. To fix: Get testnet tokens from OriginTrail community (Discord/Telegram) for your wallet address.`;
            } else if (!errorMessage || errorMessage.trim() === "" || errorMessage === "Unable to publish:") {
              // Empty error message - provide comprehensive troubleshooting
              const dkgOtnodeUrl = process.env.DKG_OTNODE_URL || "NOT SET";
              const dkgBlockchain = process.env.DKG_BLOCKCHAIN || "NOT SET";
              const hasWallet = !!process.env.DKG_PUBLISH_WALLET;
              
              finalMessage = `Unable to publish: Empty error message from dkg.js. This usually indicates one of the following issues:\n\n` +
                `1. **OT-Node Connection**: Cannot connect to OT-Node. Check:\n` +
                `   - Is DKG_OTNODE_URL set correctly? (Current: ${dkgOtnodeUrl})\n` +
                `   - Is the OT-Node running and accessible?\n` +
                `   - For testnet, use: https://v6-pegasus-node-02.origin-trail.network:8900\n\n` +
                `2. **Wallet Configuration**: Check if DKG_PUBLISH_WALLET is set: ${hasWallet ? "YES" : "NO"}\n\n` +
                `3. **Blockchain Configuration**: Check if DKG_BLOCKCHAIN is set: ${dkgBlockchain}\n\n` +
                `4. **Network Issues**: Check firewall/network connectivity to OT-Node\n\n` +
                `Check the DKG node logs above for more details. Full error object: ${errorDetails.substring(0, 500)}`;
            } else {
              finalMessage = `Unable to publish: ${errorMessage}. Check DKG node logs above for full details.`;
            }
            
            return res.status(500).json({
              success: false,
              ual: null,
              error: finalMessage,
            });
          }

          // Extract UAL from response (check multiple possible fields)
          const ual = createAsset?.UAL || 
                      createAsset?.ual || 
                      createAsset?.asset_id || 
                      createAsset?.dataSetId || 
                      createAsset?.operation?.publish?.ual ||
                      null;

          if (!ual) {
            console.error("❌ Asset created but no UAL returned!");
            console.error("Response structure:", createAsset ? Object.keys(createAsset) : "null");
            console.error("Full response:", JSON.stringify(createAsset, null, 2));
            return res.status(500).json({
              success: false,
              ual: null,
              error: "Failed to create Knowledge Asset - no UAL returned. Check DKG node logs above for full response.",
              full_response: createAsset,  // Include full response for debugging
            });
          }

          console.log("✅ Successfully published Community Note!");
          console.log(`📋 UAL (Unique Asset Locator): ${ual}`);
          console.log(`🔗 Verify asset: GET /api/dkg/assets?ual=${ual}`);
          
          res.json({
            success: true,
            ual: ual,
            asset_id: ual,  // Also include as asset_id for backward compatibility
            error: null,
            verification_url: `/api/dkg/assets?ual=${ual}`,
            // Include additional info from response if available
            operation_id: createAsset?.operation?.publish?.operationId,
            transaction_hash: createAsset?.operation?.mintKnowledgeCollection?.transactionHash,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          console.error("Error publishing Community Note:", error);
          if (stack) console.error("Stack:", stack);
          res.status(500).json({
            success: false,
            ual: null,
            error: `Failed to publish Community Note: ${error || "Unknown error. Check DKG node configuration and logs."}`,
          });
        }
      },
    ),
  );
});

