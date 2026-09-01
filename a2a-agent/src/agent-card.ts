import type { AgentCard } from "@a2a-js/sdk";

export function buildAgentCard(baseUrl: string): AgentCard {
  return {
    protocolVersion: "0.3.0",
    name: "Redshift Agent",
    description:
      "Answers natural-language questions about our Redshift warehouse by delegating to a Claude Code subprocess with access to the redshift-mcp-server tools.",
    url: baseUrl,
    preferredTransport: "JSONRPC",
    version: "0.1.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    securitySchemes: {},
    security: [],
    skills: [
      {
        id: "query-redshift",
        name: "Query Redshift",
        description:
          "Answer questions about the data warehouse: run read-only SQL, describe tables, find columns.",
        tags: ["sql", "redshift", "data"],
        examples: [
          "How many rows are in the orders table?",
          "What columns does the users table have?",
        ],
      },
    ],
  };
}
