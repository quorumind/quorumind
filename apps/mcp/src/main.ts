#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer, optionsFromEnv } from "./server.ts";

// Stdout carries the protocol: anything for a human goes to stderr.
const options = optionsFromEnv(process.env);
serveStdio(() => createMcpServer(options), {
  onerror: (error) => console.error("quorumind-mcp:", error.message),
});
console.error(`quorumind-mcp: talking to Quorumind at ${options.client.baseUrl}${options.demo ? " (demo mode)" : ""}.`);
