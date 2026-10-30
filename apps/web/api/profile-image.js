// POST   /api/profile-image?kind=avatar|banner  (corps : JPEG redimensionné par l'app, en
//        application/octet-stream) → { url } : nouvelle photo de profil ou bannière
// DELETE /api/profile-image?kind=avatar|banner  → retour à la photo Google / bannière par défaut
const { verifyUser } = require('../lib/auth');
const { publicId, setProfileImage, removeProfileImage } = require('../lib/profiles');

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
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Stockage non configuré' });
  const kind = String(req.query.kind || '');
  try {
    const user = await verifyUser(req);
    const uid = publicId(user.sub);
    if (req.method === 'DELETE') {
      await removeProfileImage(uid, kind);
      return res.status(200).json({ url: null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST ou DELETE uniquement' });
    const body = await readBody(req);
    if (body.length > MAX_BYTES) return res.status(413).json({ error: 'Image trop lourde (3 Mo max)' });
    // Signature JPEG : refuse tout ce qui n'est pas une image JPEG.
    if (body.length < 1000 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      return res.status(415).json({ error: 'Seules les images JPEG sont acceptées' });
    }
    return res.status(200).json({ url: await setProfileImage(uid, kind, body) });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
