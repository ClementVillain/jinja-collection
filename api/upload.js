// POST /api/upload?shrine=w123456 (corps : image JPEG déjà redimensionnée par le navigateur,
// envoyée en application/octet-stream)
// Réservé aux comptes connectés : la photo est enregistrée dans le dossier du sanctuaire,
// avec à côté un petit fichier .json (prénom + photo de profil Google de l'auteur, sans e-mail).
const crypto = require('node:crypto');
const { put } = require('@vercel/blob');
const { PREFIX } = require('../lib/community');
const { verifyGoogleUser } = require('../lib/auth');

const MAX_BYTES = 3 * 1024 * 1024;

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error('Image trop lourde (3 Mo max)'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Stockage non configuré' });

  const shrine = String(req.query.shrine || '');
  if (!/^[nwr]\d{1,12}$/.test(shrine)) return res.status(400).json({ error: 'Sanctuaire inconnu' });

  try {
    const user = await verifyGoogleUser(req);
    const body = await readBody(req);
    if (body.length > MAX_BYTES) return res.status(413).json({ error: 'Image trop lourde (3 Mo max)' });
    // Signature JPEG : refuse tout ce qui n'est pas une image JPEG.
    if (body.length < 1000 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      return res.status(415).json({ error: 'Seules les images JPEG sont acceptées' });
    }
    const base = `${PREFIX}${shrine}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const by = {
      name: String(user.givenName || user.name || 'Visiteur').slice(0, 40),
      picture: /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(user.picture || '') ? user.picture : '',
    };
    // Les métadonnées d'abord : la photo n'apparaît dans la liste qu'une fois son auteur connu.
    const meta = await put(`${base}.json`, JSON.stringify({ ...by, at: new Date().toISOString() }), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false,
    });
    const blob = await put(`${base}.jpg`, body, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false });
    return res.status(200).json({ url: blob.url, meta: meta.url, by });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
