// Fonction Vercel : trouve un sanctuaire sur Google Maps (Places API New) et renvoie
// l'URL de sa première photo. La clé reste côté serveur (variable GOOGLE_MAPS_API_KEY).
// GET /api/photo?name=明治神宮&lat=35.675&lon=139.699
const PLACES = 'https://places.googleapis.com/v1';
const MAX_DISTANCE_M = 400;

function distance(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

module.exports = async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY non configurée' });

  const name = String(req.query.name || '').slice(0, 100);
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  // Uniquement des sanctuaires au Japon : limite les appels abusifs à la clé.
  if (!name || !(lat > 20 && lat < 46 && lon > 122 && lon < 154)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }

  try {
    const search = await fetch(`${PLACES}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.location,places.photos,places.googleMapsUri',
      },
      body: JSON.stringify({
        textQuery: name,
        languageCode: 'ja',
        maxResultCount: 3,
        locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 500 } },
      }),
    });
    if (!search.ok) return res.status(502).json({ error: `Places searchText : ${search.status}` });

    // Le bon lieu est celui qui a des photos et se trouve tout près des coordonnées OSM :
    // évite d'afficher un homonyme (il y a des centaines de 八幡神社) situé ailleurs.
    const place = ((await search.json()).places || [])
      .filter((p) => p.photos?.length && p.location)
      .map((p) => ({ ...p, d: distance(lat, lon, p.location.latitude, p.location.longitude) }))
      .filter((p) => p.d <= MAX_DISTANCE_M)
      .sort((a, b) => a.d - b.d)[0];

    res.setHeader('Cache-Control', 'no-store');
    if (!place) return res.status(200).json({ photo: null });

    const photo = place.photos[0];
    const media = await fetch(`${PLACES}/${photo.name}/media?maxWidthPx=640&skipHttpRedirect=true&key=${key}`);
    if (!media.ok) return res.status(502).json({ error: `Places photo : ${media.status}` });
    const { photoUri } = await media.json();

    const author = photo.authorAttributions?.[0];
    return res.status(200).json({
      photo: {
        src: photoUri,
        author: author?.displayName || '',
        authorUri: author?.uri || '',
        mapsUri: place.googleMapsUri || '',
      },
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
