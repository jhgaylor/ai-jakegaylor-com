import { PostHog } from 'posthog-node';

// Server-side analytics for agent traffic — the signal for when recruiter
// and sourcing agents actually start showing up, and what they ask for.
// Sends to the same PostHog project as the site's frontend snippet so web
// and agent traffic live together. No-ops entirely without POSTHOG_API_KEY;
// capture failures must never affect a request.
let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    client = null;
    return client;
  }
  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    flushAt: 1,
    flushInterval: 5000,
  });
  return client;
}

function capture(distinctId: string, event: string, properties: Record<string, unknown>) {
  try {
    getClient()?.capture({ distinctId, event, properties });
  } catch (error) {
    console.error('analytics capture failed:', error);
  }
}

async function shutdownAnalytics() {
  try {
    await getClient()?.shutdown();
  } catch {
    // best effort — losing buffered events on shutdown is acceptable
  }
}

export { capture, shutdownAnalytics };
