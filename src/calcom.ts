// Scheduling backend: the self-hosted Cal.com at cal.jakegaylor.com.
// Speaks the same public, unauthenticated endpoints the booking page
// uses (the licensed REST API isn't part of the self-host web image):
//   GET  /api/trpc/slots/getSchedule  — availability
//   POST /api/book/event              — create a booking
// The quick-call event type requires confirmation, so every booking
// lands as PENDING until Jake approves it — that's the hold-then-
// confirm guardrail, enforced server-side by Cal.com itself.
// Wire formats verified against calcom/cal.com:v6.1.5-arm; the image
// tag is pinned in home-cloud, so this surface only changes when we
// deliberately upgrade.

const CAL_BASE = process.env.CAL_BASE_URL || 'https://cal.jakegaylor.com';
const CAL_USER = process.env.CAL_USERNAME || 'jhgaylor';
const CAL_SLUG = process.env.CAL_EVENT_SLUG || 'quick-call';
const CAL_EVENT_TYPE_ID = parseInt(process.env.CAL_EVENT_TYPE_ID || '2', 10);
const CAL_EVENT_MINUTES = parseInt(process.env.CAL_EVENT_MINUTES || '30', 10);
const CAL_TZ = process.env.CAL_TIMEZONE || 'America/New_York';

const BOOKING_PAGE = `${CAL_BASE}/${CAL_USER}/${CAL_SLUG}`;

// In-process abuse brake: attempts, not successes, so a failing agent
// can't retry forever either. Resets on pod restart, which is fine —
// Cal.com's pending-confirmation state is the real gate.
const MAX_BOOKINGS_PER_DAY = 5;
const bookingAttempts = new Map<string, number>();

function underDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const count = bookingAttempts.get(today) || 0;
  if (count >= MAX_BOOKINGS_PER_DAY) return false;
  bookingAttempts.set(today, count + 1);
  // keep the map from growing forever
  for (const key of bookingAttempts.keys()) if (key !== today) bookingAttempts.delete(key);
  return true;
}

async function getAvailableSlots(days: number): Promise<Record<string, string[]>> {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 3600 * 1000);
  const input = {
    json: {
      isTeamEvent: false,
      usernameList: [CAL_USER],
      eventTypeSlug: CAL_SLUG,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timeZone: CAL_TZ,
      duration: null,
      rescheduleUid: null,
      orgSlug: null,
      teamMemberEmail: null,
      routedTeamMemberIds: null,
      skipContactOwner: false,
      routingFormResponseId: null,
      email: null,
      embedConnectVersion: '0',
      _isDryRun: false,
    },
    meta: {
      values: {
        duration: ['undefined'],
        orgSlug: ['undefined'],
        teamMemberEmail: ['undefined'],
        routingFormResponseId: ['undefined'],
      },
    },
  };
  const url = `${CAL_BASE}/api/trpc/slots/getSchedule?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`slots query failed: ${response.status}`);
  const data = await response.json() as any;
  const slots = data?.result?.data?.json?.slots || {};
  const out: Record<string, string[]> = {};
  for (const day of Object.keys(slots).sort()) {
    out[day] = slots[day].map((s: any) => s.time);
  }
  return out;
}

interface BookingRequest {
  start: string;      // ISO 8601 UTC
  email: string;
  name: string;
  notes?: string;
}

async function createBooking(req: BookingRequest): Promise<{ uid: string; status: string }> {
  const startDate = new Date(req.start);
  const end = new Date(startDate.getTime() + CAL_EVENT_MINUTES * 60 * 1000);
  const body = {
    responses: {
      name: req.name,
      email: req.email,
      notes: req.notes || 'Booked via the ai.jakegaylor.com A2A agent.',
      guests: [],
    },
    user: CAL_USER,
    start: startDate.toISOString(),
    end: end.toISOString(),
    eventTypeId: CAL_EVENT_TYPE_ID,
    eventTypeSlug: CAL_SLUG,
    timeZone: CAL_TZ,
    language: 'en',
    metadata: { source: 'a2a-agent' },
    hasHashedBookingLink: false,
  };
  const response = await fetch(`${CAL_BASE}/api/book/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(data?.message || `booking failed: HTTP ${response.status}`);
  }
  return { uid: data.uid, status: data.status };
}

export { getAvailableSlots, createBooking, underDailyCap, BOOKING_PAGE, CAL_TZ, CAL_EVENT_MINUTES, MAX_BOOKINGS_PER_DAY };
