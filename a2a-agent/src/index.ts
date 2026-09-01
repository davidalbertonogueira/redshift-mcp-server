import express from "express";
import { InMemoryTaskStore, DefaultRequestHandler } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { buildAgentCard } from "./agent-card.js";
import { RedshiftAgentExecutor } from "./executor.js";

const port = Number(process.env.PORT ?? 4000);
const baseUrl = process.env.AGENT_BASE_URL ?? `http://localhost:${port}`;

const agentCard = buildAgentCard(baseUrl);
const taskStore = new InMemoryTaskStore();
const requestHandler = new DefaultRequestHandler(agentCard, taskStore, new RedshiftAgentExecutor());

const app = express();
app.use(express.json());
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use(jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

// Local pet project only — no auth, bind to localhost, don't expose PORT beyond this machine.
app.listen(port, "localhost", () => {
  console.log(`Redshift A2A agent listening on ${baseUrl}`);
  console.log(`Agent card: ${baseUrl}/${AGENT_CARD_PATH}`);
});
