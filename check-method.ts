#!/usr/bin/env node
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

console.log("Schema shape:", ListToolsRequestSchema.shape);
if (ListToolsRequestSchema.shape && ListToolsRequestSchema.shape.method) {
  console.log("Method:", ListToolsRequestSchema.shape.method);
  if (ListToolsRequestSchema.shape.method._def) {
    console.log("Method def:", ListToolsRequestSchema.shape.method._def);
  }
}
