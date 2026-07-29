#!/usr/bin/env node

import { createServer } from '@jhgaylor/candidate-mcp-server';
import { getServerConfig, getCandidateConfig } from "./config";
import { startHTTPServer } from "./express";
import { startStdioServer } from "./stdio";
import { z } from "zod";
import { candidatePreferences } from "./preferences";
import { getAvailableSlots, createBooking, underDailyCap, BOOKING_PAGE, CAL_EVENT_MINUTES, MAX_BOOKINGS_PER_DAY } from "./calcom";

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
    // Scheduling tools, backed by the same self-hosted Cal.com the A2A
    // schedule-intro-call skill uses. Same guardrails: every booking is
    // pending until Jake confirms it, and attempts are capped per day.
    server.tool(
      'get_availability',
      `Get ${candidateConfig.name}'s open intro-call slots for the next two weeks (${CAL_EVENT_MINUTES}-minute meetings). Returns JSON of ISO 8601 UTC start times grouped by day, plus the human booking page URL. Use book_intro_call to book one.`,
      async () => {
        try {
          const slots = await getAvailableSlots(14);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ duration_minutes: CAL_EVENT_MINUTES, booking_page: BOOKING_PAGE, slots }, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `Slot lookup is temporarily unavailable. Book directly at ${BOOKING_PAGE}.` }],
          };
        }
      },
    );
    server.tool(
      'book_intro_call',
      `Book a ${CAL_EVENT_MINUTES}-minute intro call with ${candidateConfig.name}. Use a start time from get_availability. The booking is pending until ${candidateConfig.name} confirms or declines it; the attendee email receives the outcome.`,
      {
        start: z.string().describe('Slot start time in ISO 8601 (from get_availability)'),
        email: z.string().describe('Attendee email address — receives confirmation or decline'),
        name: z.string().describe('Attendee name'),
        notes: z.string().optional().describe('Optional context: role, company, what to discuss'),
      },
      async (args) => {
        const start = new Date(args.start);
        if (isNaN(start.getTime()) || start.getTime() < Date.now()) {
          return { content: [{ type: 'text' as const, text: 'Invalid or past start time. Call get_availability for current slots.' }] };
        }
        if (!underDailyCap()) {
          return { content: [{ type: 'text' as const, text: `Daily booking limit reached (${MAX_BOOKINGS_PER_DAY}/day through this server). Book directly at ${BOOKING_PAGE} or try again tomorrow.` }] };
        }
        try {
          const booking = await createBooking({
            start: start.toISOString(),
            email: args.email,
            name: args.name.slice(0, 120),
            notes: args.notes?.slice(0, 1000),
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ uid: booking.uid, status: booking.status, start: start.toISOString(), duration_minutes: CAL_EVENT_MINUTES, note: `Pending until ${candidateConfig.name} confirms; outcome goes to ${args.email}.` }, null, 2) }],
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: `Booking failed: ${msg.slice(0, 200)}. The slot may have been taken — call get_availability for fresh slots, or book at ${BOOKING_PAGE}.` }] };
        }
      },
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