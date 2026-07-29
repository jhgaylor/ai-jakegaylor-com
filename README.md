# ai.jakegaylor.com

An Express + TypeScript server that makes Jake Gaylor legible to AI systems. One deployment serves four interfaces to the same underlying resume and bio:

- **A webpage** (`GET /`) for humans
- **Plain-text context** (`GET /llms.txt`) for LLMs and crawlers
- **An MCP server** (`/mcp`) for AI clients a human has configured
- **An A2A agent** (`/a2a` + agent card) for agents that discover the site on their own

The resume content is fetched from `jakegaylor.com/resume.json` at boot and rendered to markdown, so every interface stays current without hand-editing.

## Endpoints

| Endpoint | What it serves |
| --- | --- |
| `GET /` | Webpage |
| `GET /llms.txt` | Resume + core beliefs as plain text |
| `POST /mcp` (+ `GET`/`DELETE`) | MCP over Streamable HTTP |
| `GET /sse` + `POST /messages` | MCP over legacy SSE transport |
| `GET /.well-known/agent-card.json` | A2A agent card (v1.0, with v0.3 translation for legacy clients) |
| `POST /a2a` | A2A JSON-RPC endpoint (v1.0 + v0.3 compat) |

## MCP

Built on [`@jhgaylor/candidate-mcp-server`](https://github.com/jhgaylor/node-candidate-mcp-server). Tools exposed:

`get_resume_text`, `get_resume_url`, `get_linkedin_url`, `get_github_url`, `get_website_url`, `get_website_text`, `contact_candidate` (emails Jake), `generate_interview_questions`, `assess_role_fit`, `get_candidate_preferences` (structured screening data — see `src/preferences.ts`)

Connect a client to `https://ai.jakegaylor.com/mcp`, or run locally over stdio with `npx @jhgaylor/me-mcp`.

## A2A

An [A2A](https://a2a-protocol.org/) v1.0 agent built on [`@a2a-js/sdk`](https://github.com/a2aproject/a2a-js), with the v0.3 compatibility layer enabled — clients that send no `A2A-Version` header are treated as v0.3 by the protocol, and most deployed clients still speak it. The card advertises both versions on the same URL.

Skills:

- **`about-jake`** — answers questions about Jake's experience using a cheap LLM grounded in the resume, bio, and screening data. If no LLM key is configured or the call fails, it falls back to returning the complete resume as markdown, so the skill contract holds either way.
- **`candidate-preferences`** — structured screening data (role types, level, location, relocation, remote, work authorization, comp stance, availability, resume links) returned as a JSON data part plus markdown. Triggered by screening/logistics keywords or `metadata.skill`. Values live in `src/preferences.ts`.
- **`assess-role-fit`** — send a job description (`JD:` prefix, or any long JD-shaped text) and get an honest LLM-graded fit assessment: verdict, strengths with resume citations, gaps named plainly, logistics check, and suggested interview questions. Falls back to returning the resume when no LLM is available.
- **`schedule-intro-call`** — scheduling-intent messages return open slots from the self-hosted Cal.com (`cal.jakegaylor.com`, public booking endpoints — no licensed API needed); `BOOK: <slot> | <email> | <name> | <note>` creates a booking. Guardrails: bookings require Jake's confirmation (Cal.com-native), explicit `BOOK:` prefix for the side effect, and a daily attempt cap. Config via `CAL_*` env vars in `src/calcom.ts`.
- **`connect-via-mcp`** — messages mentioning MCP get connection instructions for the richer MCP interface.
- **`contact-jake`** — messages starting with `CONTACT:` are relayed to Jake by email. Only that explicit prefix (or `metadata.skill = "contact-jake"`) triggers mail.

Example:

```bash
curl -X POST https://ai.jakegaylor.com/a2a \
  -H "Content-Type: application/json" -H "A2A-Version: 1.0" \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{
        "messageId":"m1","role":"ROLE_USER",
        "parts":[{"text":"What is Jake's experience with Kubernetes?"}]}}}'
```

## Configuration

| Env var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `RESEND_API_KEY` | Email via Resend SMTP (preferred when set) |
| `EMAIL_FROM` | From-address for Resend (domain must be verified in Resend) |
| `MAILGUN_API_KEY` | Email via Mailgun (fallback when Resend is not configured) |
| `OPENROUTER_API_KEY` | LLM for `about-jake` via OpenRouter (preferred when set) |
| `OPENAI_API_KEY` | LLM for `about-jake` via OpenAI directly (fallback) |
| `LLM_MODEL` | Model override (default `openai/gpt-5.4-nano` on OpenRouter, `gpt-5.4-nano` on OpenAI) |
| `A2A_BASE_URL` | Public base URL baked into the agent card (default `https://ai.jakegaylor.com`) |
| `POSTHOG_API_KEY` | Server-side agent-traffic analytics (card fetches, MCP/A2A requests, skill routing); analytics are disabled without it |
| `POSTHOG_HOST` | PostHog endpoint (default `https://us.i.posthog.com`) |

With no email keys set, `contact_candidate`/`contact-jake` report failure gracefully. With no LLM keys set, `about-jake` is fully deterministic.

## Development

```bash
npm install
npm run build        # tsc
npm run dev          # stdio transport, auto-reload
npm run dev:web      # HTTP transport on :3000, auto-reload
```

```
src/
  ├── index.ts           # Entry point; picks stdio or HTTP transport
  ├── express.ts         # HTTP server: web, MCP, A2A mounting
  ├── a2a.ts             # A2A agent card, executor, skills
  ├── preferences.ts     # Structured screening data (edit values here)
  ├── stdio.ts           # STDIO transport for MCP
  ├── config.ts          # Server + candidate config; fetches resume at boot
  ├── resumeMarkdown.ts  # JSON Resume → markdown renderer
  └── types.ts           # Shared types
```

## Deployment

Pushes to `main` trigger a GitHub Actions build of a multi-arch Docker image (`jhgaylor/jake-gaylor-com-mcp-server`). The workflow then pins `k8s/kustomization.yaml` to the new `sha-<commit>` tag and commits it back; Flux watches the repo and rolls the deployment on the home-cloud k3s cluster. Runtime secrets come from Infisical via an `InfisicalSecret` (see `k8s/infisicalsecret.yaml`) and land in the pod through `envFrom`.

## License

[MIT](https://opensource.org/licenses/MIT)
