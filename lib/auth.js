// Vérifie le jeton d'identité Google (« Se connecter avec Google ») envoyé par le navigateur
// dans l'en-tête Authorization: Bearer <jeton>. Signature contrôlée avec les clés publiques Google.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
let jwks;

async function verifyGoogleUser(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw Object.assign(new Error('Connexion Google non configurée'), { status: 503 });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Non connecté'), { status: 401 });

  const { jwtVerify, createRemoteJWKSet } = await import('jose');
  jwks ||= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: GOOGLE_ISSUERS, audience: clientId });
    return { sub: payload.sub, email: payload.email, name: payload.name };
  } catch {
    throw Object.assign(new Error('Session expirée, reconnecte-toi'), { status: 401 });
  }
}

module.exports = { verifyGoogleUser };
