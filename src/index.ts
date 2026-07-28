#!/usr/bin/env node

import { createServer } from '@jhgaylor/candidate-mcp-server';
import { getServerConfig, getCandidateConfig } from "./config";
import { startHTTPServer } from "./express";
import { startStdioServer } from "./stdio";
import { candidatePreferences } from "./preferences";

async function main() {
  const args = process.argv.slice(2);
  const transportArg = args.find(arg => arg.startsWith('--transport='));
  const selectedTransport = transportArg ? transportArg.split('=')[1] : 'stdio';

  const serverConfig = getServerConfig();
  const candidateConfig = await getCandidateConfig();

  const serverFactory = () => {
    const server = createServer(serverConfig, candidateConfig);
    // Structured screening data (location, relocation, remote, level,
    // comp, availability) so recruiter-side agents skip a screening
    // round-trip. Lives here rather than in candidate-mcp-server until
    // the library grows a preferences concept upstream.
    server.tool(
      'get_candidate_preferences',
      `Structured screening and logistics data for ${candidateConfig.name}: role types, level, location, relocation, remote preference, work authorization, compensation stance, availability, and machine-readable resume links. Returns JSON.`,
      async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify(candidatePreferences, null, 2) }],
      }),
    );
    return server;
  };

  // Start servers based on transport argument
  if (selectedTransport === 'http') {
    console.log('Starting HTTP server...');
    const port = process.env.PORT || "3000";
    startHTTPServer(candidateConfig, serverConfig, serverFactory, parseInt(port));
  } else {
    // NOTE: this must not log to stdout, otherwise it will break the MCP protocol. console.error is correct.
    console.error('Starting STDIO server...');
    startStdioServer(serverFactory);
  }
}

main();