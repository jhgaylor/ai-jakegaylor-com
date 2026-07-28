import express from 'express';
import fs from 'fs';
import path from 'path';
import * as nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { AgentCard, Message, Part, Role, AGENT_CARD_PATH } from '@a2a-js/sdk';
import {
  AgentEvent,
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
} from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { duplicateInterfacesForLegacy } from '@a2a-js/sdk/compat/v0_3';
import { CandidateConfig, ServerConfig } from '@jhgaylor/candidate-mcp-server';

// The A2A endpoint is deterministic — no LLM behind it. Each skill maps a
// message to a fixed behavior: the resume/bio for questions, static
// instructions for MCP onboarding, and an email relay for contact. The
// contact skill only fires on an explicit "CONTACT:" prefix (or
// metadata.skill === 'contact-jake') so a stray question can never
// trigger an outbound email.
const CONTACT_PREFIX = /^\s*contact:/i;

function getBaseUrl(): string {
  return process.env.A2A_BASE_URL || 'https://ai.jakegaylor.com';
}

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function textPart(value: string, mediaType: string): Part {
  return {
    content: { $case: 'text', value },
    metadata: undefined,
    filename: '',
    mediaType,
  };
}

function buildAgentCard(candidateConfig: CandidateConfig): AgentCard {
  const baseUrl = getBaseUrl();
  const name = candidateConfig.name || 'Jake Gaylor';
  return {
    name,
    description:
      `Agent representing ${name}, a software engineer (platform engineering, Kubernetes, developer tooling). ` +
      `Answers deterministically from his published resume and bio — no generative model behind this endpoint. ` +
      `It can also deliver a message to ${name} by email, and explains how to connect to the richer MCP interface at ${baseUrl}/mcp.`,
    // v1.0 is barely out, so most A2A clients in the wild still speak
    // v0.3 (and clients sending no A2A-Version header are treated as
    // v0.3). Advertise both and enable legacyCompat on the handlers.
    supportedInterfaces: duplicateInterfacesForLegacy(
      [
        {
          url: `${baseUrl}/a2a`,
          protocolBinding: 'JSONRPC',
          tenant: '',
          protocolVersion: '1.0',
        },
      ],
      ['JSONRPC'],
    ),
    provider: {
      organization: name,
      url: candidateConfig.websiteUrl || baseUrl,
    },
    version: getPackageVersion(),
    documentationUrl: baseUrl,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/markdown', 'text/plain'],
    skills: [
      {
        id: 'about-jake',
        name: `About ${name}`,
        description:
          `Answers any question about ${name}'s experience, skills, and background by returning his complete ` +
          `resume and bio as markdown, letting the calling agent extract what it needs.`,
        tags: ['resume', 'hiring', 'background', 'software-engineer'],
        examples: [
          `Tell me about ${name}'s work experience`,
          `What is ${name}'s background with Kubernetes?`,
        ],
        inputModes: ['text/plain'],
        outputModes: ['text/markdown'],
        securityRequirements: [],
      },
      {
        id: 'connect-via-mcp',
        name: 'Connect via MCP',
        description:
          `Returns instructions for connecting to ${name}'s Model Context Protocol server, which exposes ` +
          `his resume, links, and contact tools to MCP-capable clients. Triggered by any message mentioning MCP.`,
        tags: ['mcp', 'integration', 'model-context-protocol'],
        examples: [`How do I connect to ${name}'s MCP server?`],
        inputModes: ['text/plain'],
        outputModes: ['text/markdown'],
        securityRequirements: [],
      },
      {
        id: 'contact-jake',
        name: `Contact ${name}`,
        description:
          `Delivers a message to ${name} by email. Start the message text with "CONTACT:" and include the ` +
          `opportunity details plus a reply address so ${name} can respond.`,
        tags: ['contact', 'email', 'hiring'],
        examples: [
          `CONTACT: We're hiring a staff platform engineer at Acme. Reach me at recruiter@acme.com`,
        ],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };
}

class CandidateAgentExecutor implements AgentExecutor {
  constructor(
    private candidateConfig: CandidateConfig,
    private serverConfig: ServerConfig,
  ) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const incoming = requestContext.userMessage;
    const text = (incoming?.parts || [])
      .map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
      .filter(Boolean)
      .join('\n');

    let replyText: string;
    let mediaType = 'text/markdown';
    if (CONTACT_PREFIX.test(text) || incoming?.metadata?.skill === 'contact-jake') {
      replyText = await this.deliverContactMessage(text);
      mediaType = 'text/plain';
    } else if (/\bmcp\b/i.test(text) || incoming?.metadata?.skill === 'connect-via-mcp') {
      replyText = this.mcpInstructions();
    } else {
      replyText = this.aboutJake();
    }

    const reply: Message = {
      messageId: uuidv4(),
      contextId: requestContext.contextId,
      taskId: '',
      role: Role.ROLE_AGENT,
      parts: [textPart(replyText, mediaType)],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    };
    eventBus.publish(AgentEvent.message(reply));
    eventBus.finished();
  }

  // Every request completes inline as a bare message, so no task ever
  // exists for the server to cancel; DefaultRequestHandler answers
  // CancelTask with TaskNotFoundError before this could be reached.
  async cancelTask(_taskId: string, _eventBus: ExecutionEventBus): Promise<void> {}

  private aboutJake(): string {
    const name = this.candidateConfig.name || 'Jake Gaylor';
    const links = [
      this.candidateConfig.websiteUrl && `- Website: ${this.candidateConfig.websiteUrl}`,
      this.candidateConfig.resumeUrl && `- Resume: ${this.candidateConfig.resumeUrl}`,
      this.candidateConfig.githubUrl && `- GitHub: ${this.candidateConfig.githubUrl}`,
      this.candidateConfig.linkedinUrl && `- LinkedIn: ${this.candidateConfig.linkedinUrl}`,
    ].filter(Boolean).join('\n');

    return [
      `# ${name}`,
      `This is ${name}'s complete resume and bio. Extract whatever your task needs.`,
      links,
      '',
      this.candidateConfig.resumeText || 'Resume not available right now.',
      '',
      `---`,
      `To deliver a message to ${name}, send a message starting with "CONTACT:" including a reply address.`,
      `For a richer tool interface (structured resume, links, contact tool), ask about MCP or see ${getBaseUrl()}/mcp.`,
    ].join('\n');
  }

  private mcpInstructions(): string {
    const name = this.candidateConfig.name || 'Jake Gaylor';
    const baseUrl = getBaseUrl();
    return [
      `# Connecting to ${name}'s MCP server`,
      '',
      `${name} also runs a Model Context Protocol server with structured tools (resume text, links, contact-by-email).`,
      '',
      `- **Streamable HTTP endpoint:** \`${baseUrl}/mcp\``,
      `- **Legacy SSE endpoint:** \`${baseUrl}/sse\` (messages POST to \`${baseUrl}/messages\`)`,
      `- **Local stdio:** \`npx @jhgaylor/me-mcp\``,
      '',
      'Example client config:',
      '```json',
      JSON.stringify({ mcpServers: { 'jake-gaylor': { url: `${baseUrl}/mcp` } } }, null, 2),
      '```',
      '',
      `Plain-text context is also available at ${baseUrl}/llms.txt.`,
    ].join('\n');
  }

  private async deliverContactMessage(text: string): Promise<string> {
    const name = this.candidateConfig.name || 'Jake Gaylor';
    const body = text.replace(CONTACT_PREFIX, '').trim();
    if (!body) {
      return `Nothing to deliver: the message after "CONTACT:" was empty. Include the opportunity details and a reply address.`;
    }
    try {
      const transporter = this.serverConfig.smtpHost
        ? nodemailer.createTransport({
            host: this.serverConfig.smtpHost,
            port: this.serverConfig.smtpPort ?? 465,
            secure: (this.serverConfig.smtpPort ?? 465) === 465,
            auth: this.serverConfig.smtpUser
              ? { user: this.serverConfig.smtpUser, pass: this.serverConfig.smtpPass }
              : undefined,
          })
        : nodemailer.createTransport({
            host: 'smtp.mailgun.org',
            port: 587,
            auth: {
              user: `postmaster@${this.serverConfig.mailgunDomain}`,
              pass: this.serverConfig.mailgunApiKey,
            },
          });
      await transporter.sendMail({
        from: this.serverConfig.fromAddress || `AI Assistant <ai-assistant@${this.serverConfig.mailgunDomain}>`,
        to: this.serverConfig.contactEmail,
        subject: `A2A contact message for ${name}`,
        text: body,
      });
      return `Message delivered to ${name} by email. Include a reply address in your message if you have not already — that is how ${name} will respond.`;
    } catch (error) {
      console.error('A2A contact email failed:', error);
      return `Failed to deliver the message: ${error instanceof Error ? error.message : String(error)}. You can reach ${name} via the links on ${this.candidateConfig.websiteUrl || getBaseUrl()} instead.`;
    }
  }
}

function mountA2A(app: express.Express, candidateConfig: CandidateConfig, serverConfig: ServerConfig) {
  const agentCard = buildAgentCard(candidateConfig);
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new CandidateAgentExecutor(candidateConfig, serverConfig),
  );

  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({
    agentCardProvider: requestHandler,
    legacyCompat: { enabled: true },
  }));
  app.use('/a2a', jsonRpcHandler({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
    legacyCompat: { enabled: true },
  }));
}

export { mountA2A, buildAgentCard };
