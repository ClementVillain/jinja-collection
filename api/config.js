// GET /api/config : réglages publics dont le navigateur a besoin (l'ID client Google n'est pas secret).
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.status(200).json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
};
