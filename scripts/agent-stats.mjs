#!/usr/bin/env node
// Agent-traffic report for ai.jakegaylor.com, printed to the terminal.
// Deliberately NOT an MCP tool — this is the operator's view, not the
// agent's. Data lives in PostHog project 86394 ("ai.jakegaylor.com"),
// fed by the server-side capture in src/express.ts and src/a2a.ts.
//
// Usage:
//   POSTHOG_QUERY_KEY=phx_... npm run stats
//
// The key is a read/query-scoped PostHog personal API key. Never commit it.

const KEY = process.env.POSTHOG_QUERY_KEY;
if (!KEY) {
  console.error('Set POSTHOG_QUERY_KEY to a query-scoped PostHog personal API key (phx_...).');
  process.exit(1);
}

const PROJECT = '86394';

async function q(query) {
  const res = await fetch(`https://us.posthog.com/api/projects/${PROJECT}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) throw new Error(`PostHog query failed: ${res.status} ${await res.text()}`);
  return (await res.json()).results ?? [];
}

const EVENTS = "('agent_card_fetched','mcp_request','llms_txt_fetched','a2a_request','a2a_skill','caller_identified')";

const [totals, tools, callers, ips, firstSeen] = await Promise.all([
  q(`select event, countIf(timestamp > now() - interval 7 day) as last7d, count() as all_time
     from events where event in ${EVENTS} group by event order by all_time desc`),
  q(`select properties.tool_name as tool, count() as calls, max(timestamp) as latest
     from events where event = 'mcp_request' and properties.tool_name is not null
     and timestamp > now() - interval 30 day group by tool order by calls desc`),
  q(`select timestamp, properties.tool_name as tool, properties.caller_context as caller
     from events where event = 'caller_identified' order by timestamp desc limit 15`),
  q(`select count(distinct distinct_id) from events where event in ${EVENTS}
     and timestamp > now() - interval 30 day`),
  q(`select min(timestamp) from events where event in ${EVENTS}`),
]);

const since = firstSeen[0]?.[0]?.slice(0, 10) ?? 'unknown';
const days = Math.max(1, Math.round((Date.now() - new Date(since)) / 86400000));

console.log(`\nAgent traffic on ai.jakegaylor.com — collecting since ${since} (${days} days)\n`);

console.log('Event                     last 7d   all time');
for (const [event, last7d, allTime] of totals) {
  console.log(`${event.padEnd(24)} ${String(last7d).padStart(8)} ${String(allTime).padStart(10)}`);
}

console.log(`\nDistinct callers (by IP), last 30 days: ${ips[0]?.[0] ?? 0}`);

if (tools.length) {
  console.log('\nMCP tool calls, last 30 days:');
  for (const [tool, calls, latest] of tools) {
    console.log(`  ${String(tool).padEnd(28)} ${String(calls).padStart(4)}   latest ${latest?.slice(0, 16)}`);
  }
}

if (callers.length) {
  console.log('\nIdentified callers (caller_context), most recent first:');
  for (const [ts, tool, caller] of callers) {
    console.log(`  ${ts.slice(0, 16)}  [${tool ?? '-'}]  ${String(caller).slice(0, 120)}`);
  }
} else {
  console.log('\nNo identified callers yet — the caller_context field shipped 2026-08-14.');
}
console.log();
