// Environnement simulé pour tester les fonctions Vercel sans réseau : Vercel Blob en mémoire,
// fetch() des URL de blobs, et connexion Google remplacée par « Authorization: Bearer test:<sub> ».
const crypto = require('node:crypto');
const path = require('node:path');

const blobs = new Map(); // pathname → { pathname, url, uploadedAt, body }
let clock = Date.parse('2026-11-01T00:00:00Z');

const blobApi = {
  async put(pathname, body, opts = {}) {
    if (opts.addRandomSuffix) pathname = pathname.replace(/(\.[a-z]+)?$/, (ext) => `-${crypto.randomBytes(4).toString('hex')}${ext}`);
    if (blobs.has(pathname) && !opts.allowOverwrite) throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true`.');
    clock += 1000; // chaque écriture est horodatée après la précédente
    const blob = { pathname, url: `https://blob.test/${pathname}`, uploadedAt: new Date(clock).toISOString(), body: String(body) };
    blobs.set(pathname, blob);
    return { url: blob.url, pathname, uploadedAt: blob.uploadedAt };
  },
  async list({ prefix = '', cursor, limit = 1000 } = {}) {
    const all = [...blobs.values()].filter((b) => b.pathname.startsWith(prefix)).sort((a, b) => a.pathname.localeCompare(b.pathname));
    const start = Number(cursor || 0);
    const page = all.slice(start, start + limit).map(({ body, ...b }) => ({ ...b, uploadedAt: new Date(b.uploadedAt) }));
    const hasMore = start + limit < all.length;
    return { blobs: page, hasMore, cursor: hasMore ? String(start + limit) : undefined };
  },
  async del(urls) {
    for (const url of [].concat(urls)) for (const [p, b] of blobs) if (b.url === url) blobs.delete(p);
  },
};

function install(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
install('@vercel/blob', blobApi);
install(path.join(__dirname, '../../lib/auth.js'), {
  async verifyGoogleUser(req) {
    const m = /^Bearer test:(.+)$/.exec(req.headers.authorization || '');
    if (!m) throw Object.assign(new Error('Non connecté'), { status: 401 });
    return { sub: m[1], email: `${m[1]}@example.com`, name: `Nom ${m[1]}`, givenName: m[1], picture: '' };
  },
});
global.fetch = async (url) => {
  const blob = [...blobs.values()].find((b) => b.url === url);
  return { ok: !!blob, status: blob ? 200 : 404, json: async () => JSON.parse(blob.body) };
};
process.env.BLOB_READ_WRITE_TOKEN ||= 'test';

// Appelle une fonction Vercel avec une requête minimale, renvoie { status, body }.
async function call(handler, { method = 'GET', user, query = {}, body } = {}) {
  const req = { method, query, body, headers: user ? { authorization: `Bearer test:${user}` } : {} };
  let status = 200, out;
  const res = {
    setHeader() {},
    status(s) { status = s; return res; },
    json(b) { out = b; return res; },
  };
  await handler(req, res);
  return { status, body: out };
}

module.exports = { blobs, call, setClock: (iso) => { clock = Date.parse(iso); } };
