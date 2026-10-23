// POST /api/upload?shrine=w123456 (corps : image JPEG déjà redimensionnée par le navigateur,
// envoyée en application/octet-stream)
// Enregistre la photo dans Vercel Blob, dans le dossier du sanctuaire.
const { put } = require('@vercel/blob');
const { PREFIX } = require('../lib/community');

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
    const body = await readBody(req);
    if (body.length > MAX_BYTES) return res.status(413).json({ error: 'Image trop lourde (3 Mo max)' });
    // Signature JPEG : refuse tout ce qui n'est pas une image JPEG.
    if (body.length < 1000 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      return res.status(415).json({ error: 'Seules les images JPEG sont acceptées' });
    }
    const blob = await put(`${PREFIX}${shrine}/${Date.now()}.jpg`, body, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: true,
    });
    return res.status(200).json({ url: blob.url });
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
};
