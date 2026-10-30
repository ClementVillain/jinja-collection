// Vérifie le jeton d'identité envoyé dans l'en-tête Authorization: Bearer <jeton> :
// « Se connecter avec Google » ou « Se connecter avec Apple ». La signature est contrôlée avec
// les clés publiques du fournisseur, et l'audience avec nos identifiants d'application.
// Un compte Apple a un identifiant préfixé « apple: » : il ne peut pas se confondre avec un
// compte Google (les dossiers users/ et les empreintes publiques en dérivent).
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_ISSUER = 'https://appleid.apple.com';
// Identifiants acceptés pour Apple : l'app iOS (bundle id) et, plus tard, le « Services ID » du site.
const APPLE_AUDIENCES = (process.env.APPLE_CLIENT_IDS || 'com.villainclement.jinjacollection').split(',').map((s) => s.trim()).filter(Boolean);
const keys = {};

// Émetteur lu sans vérifier (pour choisir les clés) ; la vérification complète suit.
function issuerOf(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).iss || '';
  } catch { return ''; }
}

async function verifyUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Non connecté'), { status: 401 });
  const { jwtVerify, createRemoteJWKSet } = await import('jose');
  const apple = issuerOf(token) === APPLE_ISSUER;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!apple && !clientId) throw Object.assign(new Error('Connexion Google non configurée'), { status: 503 });
  try {
    if (apple) {
      keys.apple ||= createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
      const { payload } = await jwtVerify(token, keys.apple, { issuer: APPLE_ISSUER, audience: APPLE_AUDIENCES });
      return { sub: `apple:${payload.sub}`, email: payload.email, provider: 'apple' };
    }
    keys.google ||= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const { payload } = await jwtVerify(token, keys.google, { issuer: GOOGLE_ISSUERS, audience: clientId });
    return { sub: payload.sub, email: payload.email, name: payload.name, givenName: payload.given_name, picture: payload.picture, provider: 'google' };
  } catch {
    throw Object.assign(new Error('Session expirée, reconnecte-toi'), { status: 401 });
  }
}

// Ancien nom, gardé pour les fonctions qui l'utilisent.
module.exports = { verifyUser, verifyGoogleUser: verifyUser };
