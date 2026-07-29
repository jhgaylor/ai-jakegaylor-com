import type { JWK } from 'jose';
import { generateAgentCardSignature } from '@a2a-js/sdk';
import type { AgentCardSignatureGenerator } from '@a2a-js/sdk';

// Agent-card signing (A2A spec §8.4): JWS over the JCS-canonicalized
// card, so any cached or redistributed copy of the card — including the
// static mirror on jakegaylor.com — is verifiable against the JWKS at
// /.well-known/jwks.json. The private ES256 JWK arrives via Infisical
// as A2A_SIGNING_KEY_JWK; without it the card is served unsigned, which
// remains spec-valid.
function loadPrivateJwk(): JWK | null {
  const raw = process.env.A2A_SIGNING_KEY_JWK;
  if (!raw) return null;
  try {
    const jwk = JSON.parse(raw) as JWK;
    if (!jwk.kid || !jwk.d) throw new Error('JWK must be a private key with a kid');
    return jwk;
  } catch (error) {
    console.error('A2A_SIGNING_KEY_JWK is set but unusable — serving an unsigned card:', error);
    return null;
  }
}

const privateJwk = loadPrivateJwk();

function getSignatureGenerator(baseUrl: string): AgentCardSignatureGenerator | undefined {
  if (!privateJwk) return undefined;
  return generateAgentCardSignature(privateJwk, {
    alg: privateJwk.alg || 'ES256',
    kid: privateJwk.kid,
    typ: 'JOSE',
    jku: `${baseUrl}/.well-known/jwks.json`,
  });
}

// Public JWKS: the private JWK minus its private scalar. Safe to serve;
// this is what verifiers resolve the signature's kid/jku against.
function getPublicJwks(): { keys: JWK[] } | null {
  if (!privateJwk) return null;
  const { d, ...publicJwk } = privateJwk;
  return { keys: [{ ...publicJwk, use: 'sig' }] };
}

export { getSignatureGenerator, getPublicJwks };
