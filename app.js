(function () {
  const STORAGE_KEY = 'jinja-collection:visits';
  const DELETED_KEY = 'jinja-collection:deleted';
  const WISH_KEY = 'jinja-collection:wishlist';
  const WISH_DELETED_KEY = 'jinja-collection:wish-deleted';
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- État ----------
  let shrines = [];
  const byId = new Map();
  const markers = new Map();
  let visits = loadJson(STORAGE_KEY);
  // Sanctuaires retirés (date du retrait) : la synchronisation ne doit pas les faire revenir.
  let deleted = loadJson(DELETED_KEY);
  // Liste « À visiter » : { id: { addedAt } }, et dates de retrait pour la synchronisation.
  let wishlist = loadJson(WISH_KEY);
  let wishDeleted = loadJson(WISH_DELETED_KEY);
  // Passages récents (positions GPS des 48 dernières heures), gardés seulement dans le navigateur.
  const SIGHTINGS_KEY = 'jinja-collection:sightings';
  let sightings = (() => { try { return JSON.parse(localStorage.getItem(SIGHTINGS_KEY)) || []; } catch { return []; } })();

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch { return {}; }
  }
  function persistVisits() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visits));
      localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
      localStorage.setItem(WISH_KEY, JSON.stringify(wishlist));
      localStorage.setItem(WISH_DELETED_KEY, JSON.stringify(wishDeleted));
    } catch (err) { alert("Impossible d'enregistrer la visite : " + err.message); }
  }
  function saveVisits() {
    persistVisits();
    scheduleSync();
  }
  // Nom en lettres latines affiché sous les kanji : romaji, sinon nom anglais d'OSM.
  const latinName = (s) => s.romaji || (s.nameLatin !== s.name ? s.nameLatin : '');
  const isVisited = (id) => Object.prototype.hasOwnProperty.call(visits, id);
  const isWished = (id) => !isVisited(id) && Object.prototype.hasOwnProperty.call(wishlist, id);

  // Numéro de carte = ordre chronologique de visite.
  function visitedOrdered() {
    return Object.entries(visits)
      .filter(([id]) => byId.has(id))
      .sort((a, b) => a[1].date.localeCompare(b[1].date))
      .map(([id, visit], i) => ({ shrine: byId.get(id), visit, number: i + 1 }));
  }
  const cardNumber = (id) => visitedOrdered().find((v) => v.shrine.id === id)?.number;

  // ---------- Carte ----------
  const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([36.2, 138.2], 5);
  L.control.zoom({ position: 'topright' }).addTo(map);
  // Mention « © OpenStreetMap » obligatoire (licence ODbL) ; le préfixe « Leaflet » ne l'est pas.
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const btn = L.DomUtil.create('button', 'locate-btn');
      btn.type = 'button';
      btn.title = 'Me localiser';
      btn.textContent = '◎';
      L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.stop(e); map.locate({ setView: true, maxZoom: 15 }); });
      return btn;
    },
  });
  map.addControl(new LocateControl());
  let meMarker;
  map.on('locationfound', (e) => {
    if (meMarker) meMarker.setLatLng(e.latlng);
    else meMarker = L.circleMarker(e.latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f7cf6', fillOpacity: 1 }).addTo(map);
  });
  map.on('locationerror', () => alert("Localisation impossible. Autorise l'accès à ta position dans le navigateur."));

  const iconTodo = L.divIcon({ className: 'pin pin-todo', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8] });
  const iconWish = L.divIcon({ className: 'pin pin-wish', html: '<span>★</span>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -13] });
  const iconDone = L.divIcon({ className: 'pin pin-done', html: '<span>⛩</span>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -15] });

  const cluster = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 55,
    disableClusteringAtZoom: 15,
    iconCreateFunction(c) {
      const n = c.getChildCount();
      const size = n < 50 ? 34 : n < 500 ? 42 : 52;
      return L.divIcon({ className: 'cluster', html: `<span>${n >= 1000 ? Math.round(n / 100) / 10 + 'k' : n}</span>`, iconSize: [size, size] });
    },
  });
  // Les sanctuaires visités ne sont jamais regroupés : ils restent visibles à tout niveau de zoom.
  const visitedLayer = L.layerGroup();
  // Idem pour la liste « À visiter » : étoiles dorées toujours visibles.
  const wishLayer = L.layerGroup();
  map.addLayer(cluster);
  map.addLayer(wishLayer);
  map.addLayer(visitedLayer);

  function makeMarker(s) {
    const m = L.marker([s.lat, s.lon], { icon: isVisited(s.id) ? iconDone : isWished(s.id) ? iconWish : iconTodo, title: s.name });
    m.shrineId = s.id;
    m.bindPopup(() => popupHtml(s), { minWidth: 260, maxWidth: 260 });
    markers.set(s.id, m);
    return m;
  }

  function placeMarker(id) {
    const m = markers.get(id);
    if (!m) return;
    cluster.removeLayer(m);
    wishLayer.removeLayer(m);
    visitedLayer.removeLayer(m);
    if (isVisited(id)) visitedLayer.addLayer(m.setIcon(iconDone).setZIndexOffset(1000));
    else if (isWished(id)) wishLayer.addLayer(m.setIcon(iconWish).setZIndexOffset(500));
    else cluster.addLayer(m.setIcon(iconTodo).setZIndexOffset(0));
  }

  const CAMERA_PLUS = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-1.8h6.6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5z"/>
    <path d="M12 9.8v5.4M9.3 12.5h5.4"/></svg>`;

  function popupHtml(s) {
    const done = isVisited(s.id);
    const latin = latinName(s) ? `<div class="popup-latin">${esc(latinName(s))}</div>` : '';
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${s.lat}%2C${s.lon}`;
    const wished = isWished(s.id);
    const status = done
      ? `<div class="popup-status done">✓ Visité le ${new Date(visits[s.id].date).toLocaleDateString('fr-FR')}</div>${visits[s.id].verified === false
        ? '<div class="popup-unverified" title="Aucune position à moins de 1 km du sanctuaire dans les 48 h précédant la visite.">⚠ Visite non vérifiée (position non confirmée)</div>' : ''}`
      : wished ? '<div class="popup-status wish">★ Dans ta liste « À visiter »</div>'
      : '<div class="popup-status">Pas encore visité</div>';
    // Sans compte, on peut regarder mais pas collectionner : les boutons invitent à se connecter.
    const act = (action) => (googleToken ? action : 'login-hint');
    const actions = done
      ? `<button class="primary" data-action="card" data-id="${s.id}">Voir ma carte</button>
         <button class="ghost small" data-action="${act('unvisit')}" data-id="${s.id}">Retirer</button>`
      : `<button class="primary" data-action="${act('visit')}" data-id="${s.id}">J'y suis allé ⛩</button>
         <button class="ghost wish-btn${wished ? ' on' : ''}" data-action="${act('wish')}" data-id="${s.id}">${wished ? '★ Retirer' : '☆ À visiter'}</button>`;
    const loginNote = googleToken || !googleClientId ? ''
      : '<div class="popup-login">Connecte-toi avec Google pour collectionner ce sanctuaire.</div>';
    // Ajout de photo : icône en bas à droite de l'image (au centre quand il n'y a pas de photo).
    const addPhoto = !communityAvailable ? ''
      : googleToken
        ? `<label class="cover-add" title="Partager ma photo de ce sanctuaire">${CAMERA_PLUS}
            <input type="file" accept="image/*" data-upload="${s.id}" hidden></label>`
        : `<button type="button" class="cover-add" data-action="login-hint" title="Connecte-toi pour partager ta photo">${CAMERA_PLUS}</button>`;
    return `<div class="popup">
      <div class="popup-cover-wrap">
        <div class="popup-cover" data-cover="${s.id}"><div class="popup-cover-loading"><span>Recherche d'une photo…</span></div></div>
        ${addPhoto}
      </div>
      <div class="popup-name">${esc(s.name)}</div>${latin}${discoveredHtml(s.id)}${status}
      <div class="popup-actions">${actions}</div>${loginNote}
      <div class="popup-upload-status" data-upload-status></div>
      <div class="popup-route-row">
        <button type="button" class="popup-route popup-go" data-action="navigate" data-id="${s.id}">➤ Y aller</button>
      </div>
      <a class="popup-link" href="${gmaps}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>
    </div>`;
  }

  // ---------- « Découvert par » : premier visiteur vérifié de chaque sanctuaire ----------
  let discoveries = {};
  const DISCOVERER_ICON = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function discoveredHtml(id) {
    const name = discoveries[id];
    return name ? `<div class="popup-discoverer" title="Premier visiteur de ce sanctuaire (visite vérifiée)">${DISCOVERER_ICON} Découvert par <b>${esc(name)}</b></div>` : '';
  }
  function loadDiscoveries() {
    fetch('/api/discoveries')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) discoveries = data; })
      .catch(() => { /* serveur local sans /api */ });
  }
  loadDiscoveries();

  // ---------- Photos de couverture ----------
  // Ordre de recherche : Google Maps (si la clé est configurée sur Vercel), photo liée dans
  // OpenStreetMap (Commons, Wikidata P18, URL), photo Commons géolocalisée à moins de 500 m
  // dont le titre évoque le sanctuaire, recherche Commons par nom à moins de 1,5 km,
  // sinon l'illustration générée de la carte postale.
  // Les résultats sont gardés dans le navigateur : chaque sanctuaire n'est cherché qu'une fois.
  const photoCache = new Map();
  const PHOTO_STORE_KEY = 'jinja-collection:photos';
  const PHOTO_TTL = 30 * 24 * 3600 * 1000;
  // Wikimedia ne sert plus que des largeurs de miniature standard (500, 960…) : 520 renvoie une erreur 400.
  const THUMB_WIDTH = 500;
  const COMMONS_API = 'https://commons.wikimedia.org/w/api.php?format=json&origin=*';
  const IMAGE_INFO = `prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_WIDTH}`;
  const SHRINE_WORDS = /神社|神宮|大社|宮|社|鳥居|稲荷|八幡|天満|天神|権現|jinja|jingu|jingū|shrine|taisha|torii|inari|hachiman|tenmang|tenjin|gongen/i;
  const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

  let photoStore = {};
  try { photoStore = JSON.parse(localStorage.getItem(PHOTO_STORE_KEY)) || {}; } catch { photoStore = {}; }
  function rememberPhoto(id, photo) {
    photoStore[id] = { photo, t: Date.now() };
    try { localStorage.setItem(PHOTO_STORE_KEY, JSON.stringify(photoStore)); } catch { /* stockage plein : tant pis */ }
  }
  function forgetPhoto(id) {
    photoCache.delete(id);
    delete photoStore[id];
    try { localStorage.setItem(PHOTO_STORE_KEY, JSON.stringify(photoStore)); } catch { /* ignore */ }
  }

  // Wikimedia limite le nombre de requêtes : en cas de 429, on attend puis on réessaie.
  async function getJson(url, tries = 3) {
    for (let i = 0; i < tries; i++) {
      const res = await fetch(url);
      if (res.ok) return res.json();
      if (res.status !== 429 || i === tries - 1) throw new Error(`HTTP ${res.status}`);
      const wait = Number(res.headers.get('Retry-After')) * 1000 || 1500 * (i + 1) ** 2;
      await new Promise((r) => setTimeout(r, Math.min(wait, 8000)));
    }
  }

  const fromPage = (p, nearby) => ({ src: p.imageinfo[0].thumburl || p.imageinfo[0].url, href: p.imageinfo[0].descriptionurl, nearby });

  async function commonsFile(title) {
    const page = Object.values((await getJson(`${COMMONS_API}&action=query&${IMAGE_INFO}&titles=${encodeURIComponent(title)}`)).query?.pages || {})[0];
    return page?.imageinfo?.[0] ? fromPage(page, false) : null;
  }

  async function wikidataImage(qid) {
    const url = `https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbgetclaims&property=P18&entity=${qid}`;
    const file = (await getJson(url)).claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    return file ? commonsFile('File:' + file) : null;
  }

  async function nearbyImage(s) {
    const url = `${COMMONS_API}&action=query&generator=geosearch&ggsnamespace=6&ggsradius=500&ggslimit=40`
      + `&ggscoord=${s.lat}|${s.lon}&${IMAGE_INFO}`;
    const pages = Object.values((await getJson(url)).query?.pages || {});
    const core = s.name.replace(/(神社|神宮|大社|天満宮|社|宮)$/, '');
    const latin = normalize(s.nameLatin || '');
    const scored = pages
      .filter((p) => p.imageinfo?.[0] && IMAGE_FILE.test(p.title))
      .map((p) => {
        const t = p.title;
        let score = SHRINE_WORDS.test(t) ? 1 : 0;
        if (core.length >= 2 && t.includes(core)) score += 3;
        if (latin.length >= 4 && normalize(t).includes(latin)) score += 3;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.index - b.p.index);
    return scored[0] ? fromPage(scored[0].p, scored[0].score < 3) : null;
  }

  // Recherche plein texte Commons : fichiers dont le titre ou la description cite le nom,
  // géolocalisés à moins de 1,5 km (attrape les photos mal placées sur la carte).
  async function namedImage(s) {
    const query = `${s.name} nearcoord:1500m,${s.lat},${s.lon}`;
    const url = `${COMMONS_API}&action=query&generator=search&gsrnamespace=6&gsrlimit=5`
      + `&gsrsearch=${encodeURIComponent(query)}&${IMAGE_INFO}`;
    const pages = Object.values((await getJson(url)).query?.pages || {})
      .filter((p) => p.imageinfo?.[0] && IMAGE_FILE.test(p.title))
      .sort((a, b) => a.index - b.index);
    return pages[0] ? fromPage(pages[0], false) : null;
  }

  // Photo Google Maps via la fonction serveur /api/photo (clé API cachée côté Vercel).
  // Si la fonction n'existe pas (serveur local simple) ou n'a pas de clé, on n'insiste pas.
  let googleAvailable = true;
  async function googlePhoto(s) {
    if (!googleAvailable) return null;
    const res = await fetch(`/api/photo?name=${encodeURIComponent(s.name)}&lat=${s.lat}&lon=${s.lon}`);
    if (res.status === 404 || res.status === 503) { googleAvailable = false; return null; }
    if (!res.ok) return null;
    const { photo } = await res.json();
    if (!photo) return null;
    return {
      src: photo.src,
      href: photo.authorUri || photo.mapsUri,
      credit: `${photo.author ? esc(photo.author) + ' · ' : ''}Google Maps ↗`,
      mapsUri: photo.mapsUri,
    };
  }

  async function findPhoto(s) {
    const google = await googlePhoto(s).catch(() => null);
    if (google) return google;
    const ref = s.photo || '';
    let photo = null;
    if (ref.startsWith('File:')) photo = await commonsFile(ref);
    else if (/^Q\d+$/.test(ref)) photo = await wikidataImage(ref);
    else if (ref.startsWith('https://')) photo = { src: ref, href: ref, nearby: false };
    return photo || (await nearbyImage(s)) || namedImage(s);
  }

  function photoFor(s) {
    if (!photoCache.has(s.id)) {
      const saved = photoStore[s.id];
      // Les photos Google ne sont pas gardées : leurs URL expirent.
      const promise = saved && Date.now() - saved.t < PHOTO_TTL
        ? Promise.resolve(saved.photo)
        : findPhoto(s).then((photo) => {
          if (!photo?.mapsUri) rememberPhoto(s.id, photo);
          return photo;
        });
      // Échec réseau ou limite Wikimedia : on ne mémorise rien, on réessaiera à la prochaine ouverture.
      photoCache.set(s.id, promise.catch((err) => { photoCache.delete(s.id); throw err; }));
    }
    return photoCache.get(s.id);
  }

  // ---------- Photos de la communauté ----------
  // Photos envoyées par les visiteurs (Vercel Blob). Elles servent de couverture quand
  // Wikimedia n'a pas de photo certaine du sanctuaire.
  let communityPhotos = {};
  let communityAvailable = false;
  // no-cache : le navigateur revalide toujours (la liste change dès qu'un visiteur partage une photo).
  fetch('/api/community', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
    .then((photos) => { communityPhotos = photos; communityAvailable = true; })
    .catch(() => { /* serveur local sans /api : pas de partage de photos */ });

  // Auteur d'une photo partagée (prénom + photo de profil), lu une fois par photo.
  const authorCache = new Map();
  function photoAuthor(metaUrl) {
    if (!metaUrl) return Promise.resolve(null);
    if (!authorCache.has(metaUrl)) {
      authorCache.set(metaUrl, fetch(metaUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    return authorCache.get(metaUrl);
  }

  // Photos partagées d'un sanctuaire, de la plus récente à la plus ancienne.
  // (Accepte aussi l'ancien format de l'API : une seule photo, en chaîne ou en objet.)
  function communityEntries(s) {
    const entry = communityPhotos[s.id];
    if (!entry) return [];
    if (typeof entry === 'string') return [{ url: entry, meta: null }];
    return Array.isArray(entry) ? entry : [entry];
  }

  function communitySlides(s) {
    return Promise.all(communityEntries(s).map(async ({ url, meta }) => {
      const by = await photoAuthor(meta);
      return { src: url, href: url, credit: by?.name ? `Photo de ${esc(by.name)}` : 'Photo partagée par un visiteur ↗', by };
    }));
  }

  // Photos du carrousel : photo Wikimedia sûre en premier, puis celles des visiteurs.
  // Une photo Wikimedia « à proximité » ne sert que s'il n'y a rien d'autre.
  async function coverSlides(s, wiki) {
    const community = await communitySlides(s);
    if (wiki && !wiki.nearby) return [wiki, ...community];
    if (community.length) return community;
    return wiki ? [wiki] : [];
  }

  const chooseCover = async (s, wiki) => (await coverSlides(s, wiki))[0] || null;

  // Redimensionne à 1600 px max et réencode en JPEG : fichier léger, et les métadonnées
  // EXIF (dont la position GPS du téléphone) disparaissent au passage.
  async function toJpeg(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  }

  document.addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-upload]');
    if (!input || !input.files[0]) return;
    const s = byId.get(input.dataset.upload);
    const popup = input.closest('.popup');
    const status = popup.querySelector('[data-upload-status]');
    const label = popup.querySelector('.cover-add');
    label.classList.add('busy');
    status.className = 'popup-upload-status';
    status.textContent = 'Envoi de la photo…';
    try {
      const jpeg = await toJpeg(input.files[0]);
      const res = await fetch(`/api/upload?shrine=${encodeURIComponent(s.id)}`, {
        // octet-stream : Vercel transmet alors le corps tel quel (Buffer) à la fonction.
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${googleToken}` },
        body: jpeg,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Erreur ${res.status}`);
      communityPhotos[s.id] = [{ url: body.url, meta: body.meta }, ...communityEntries(s)];
      authorCache.set(body.meta, Promise.resolve(body.by));
      const wiki = await photoFor(s).catch(() => null);
      const withWiki = wiki && !wiki.nearby;
      // Affiche directement la nouvelle photo dans le carrousel.
      loadCover(s, popup.querySelector('[data-cover]'), withWiki ? 1 : 0);
      status.classList.add('ok');
      status.textContent = withWiki
        ? 'Merci ! Ta photo est ajoutée au carrousel (la photo Wikimedia reste en premier).'
        : 'Merci ! Ta photo est maintenant la couverture de ce sanctuaire.';
    } catch (err) {
      status.classList.add('error');
      status.textContent = "La photo n'a pas pu être envoyée : " + err.message;
    } finally {
      label.classList.remove('busy');
      input.value = '';
    }
  });

  function showIllustration(s, el, label) {
    el.innerHTML = ShrineCard.renderScene(s) + `<span class="popup-cover-credit">${label}</span>`;
    el.parentElement?.classList.add('no-photo');
  }

  // Image de couverture retenue pour un sanctuaire : la même pour la popup et la carte postale.
  const coverPhoto = (s) => photoFor(s).catch(() => null).then((wiki) => chooseCover(s, wiki));

  function slideHtml(s, photo) {
    const credit = photo.credit || `${photo.nearby ? 'Photo prise à proximité · ' : ''}Wikimedia Commons ↗`;
    const avatar = photo.by?.picture;
    return `<div class="cover-slide">
      <img class="cover-img" src="${esc(photo.src)}" alt="${esc(s.name)}" referrerpolicy="no-referrer" draggable="false">
      <a class="popup-cover-credit${avatar ? ' with-avatar' : ''}" href="${esc(photo.href)}" target="_blank" rel="noopener">${avatar
        ? `<img class="popup-cover-avatar" src="${esc(avatar)}" alt="" referrerpolicy="no-referrer" draggable="false">` : ''}${credit}</a>
    </div>`;
  }

  // Carrousel : flèches, points, balayage au doigt. Une photo qui ne charge pas est retirée.
  function renderCarousel(s, el, slides, start = 0) {
    el.parentElement?.classList.remove('no-photo');
    let index = Math.min(start, slides.length - 1);
    const many = slides.length > 1;
    el.innerHTML = `<div class="cover-track">${slides.map((p) => slideHtml(s, p)).join('')}</div>`
      + (many ? `<button type="button" class="cover-nav prev" aria-label="Photo précédente">‹</button>
        <button type="button" class="cover-nav next" aria-label="Photo suivante">›</button>
        <div class="cover-dots">${slides.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Photo ${i + 1}"></button>`).join('')}</div>` : '');
    const track = el.querySelector('.cover-track');
    const go = (i) => {
      index = (i + slides.length) % slides.length;
      track.style.transform = `translateX(${-index * 100}%)`;
      el.querySelectorAll('.cover-dots button').forEach((d, j) => d.classList.toggle('on', j === index));
    };
    go(index);
    el.querySelectorAll('.cover-img').forEach((img, i) => {
      img.onerror = () => {
        if (!slides[i].credit) forgetPhoto(s.id);
        const rest = slides.filter((_, j) => j !== i);
        if (!el.isConnected) return;
        if (rest.length) renderCarousel(s, el, rest, index > i ? index - 1 : index);
        else showIllustration(s, el, 'Photo indisponible pour le moment');
      };
    });
    if (!many) return;
    el.querySelector('.prev').onclick = () => go(index - 1);
    el.querySelector('.next').onclick = () => go(index + 1);
    el.querySelectorAll('.cover-dots button').forEach((d) => { d.onclick = () => go(Number(d.dataset.slide)); });
    let startX = null;
    el.onpointerdown = (e) => { if (!e.target.closest('button, a')) startX = e.clientX; };
    el.onpointerup = (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    };
  }

  function loadCover(s, el, start = 0) {
    photoFor(s).catch(() => null).then((wiki) => coverSlides(s, wiki)).then((slides) => {
      if (!el.isConnected) return;
      if (!slides.length) return showIllustration(s, el, 'Pas encore de photo · illustration');
      // Lien direct vers la fiche Google Maps du sanctuaire quand Google l'a trouvé.
      const mapsUri = slides.find((p) => p.mapsUri)?.mapsUri;
      const link = el.closest('.popup')?.querySelector('.popup-link');
      if (link && mapsUri) link.href = mapsUri;
      // On attend la première photo pour ne pas afficher un cadre vide.
      const first = new Image();
      first.referrerPolicy = 'no-referrer';
      first.onload = () => { if (el.isConnected) renderCarousel(s, el, slides, start); };
      first.onerror = () => { if (el.isConnected) renderCarousel(s, el, slides, start); };
      first.src = slides[Math.min(start, slides.length - 1)].src;
    }).catch(() => {
      if (el.isConnected) showIllustration(s, el, 'Photo indisponible pour le moment · réessaie plus tard');
    });
  }

  map.on('popupopen', (e) => {
    const el = e.popup.getElement()?.querySelector('[data-cover]');
    if (el) loadCover(byId.get(el.dataset.cover), el);
  });

  // Rouvrir une popup déjà ouverte redessine son contenu sans relancer le chargement
  // de la photo (pas de « popupopen ») : on la laisse telle quelle.
  function openShrinePopup(m) {
    if (!m.isPopupOpen()) m.openPopup();
  }

  function focusShrine(id, zoom = 16) {
    const s = byId.get(id);
    const m = markers.get(id);
    if (!s || !m) return;
    if (window.matchMedia('(max-width: 760px)').matches) setCollapsed(true);
    if (isVisited(id) || isWished(id)) {
      // Déjà centrée dessus : la carte ne bougerait pas et « moveend » n'arriverait jamais.
      if (map.getZoom() >= zoom && map.getCenter().distanceTo([s.lat, s.lon]) < 20) { openShrinePopup(m); return; }
      map.once('moveend', () => openShrinePopup(m));
      map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), zoom), { duration: 0.8 });
    } else {
      cluster.zoomToShowLayer(m, () => openShrinePopup(m));
    }
  }

  // ---------- Actions ----------
  // ---------- Proximité : 1 km dans les 48 h (proximity.js, vérifié aussi par le serveur) ----------
  function recordSighting(pos) {
    sightings = JinjaProximity.addSighting(sightings, pos);
    try { localStorage.setItem(SIGHTINGS_KEY, JSON.stringify(sightings)); } catch { /* ignore */ }
  }
  function gpsPosition(timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('localisation non disponible'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy }),
        reject,
        { enableHighAccuracy: true, timeout, maximumAge: 60000 },
      );
    });
  }
  // À l'ouverture puis toutes les 3 min (page visible, connecté) : position enregistrée si la
  // localisation est déjà autorisée. Sinon, l'autorisation n'est demandée qu'au moment de
  // « J'y suis allé ».
  async function sampleGps() {
    if (!googleToken || document.hidden) return;
    try {
      const perm = await navigator.permissions?.query({ name: 'geolocation' });
      if (perm?.state !== 'granted') return;
      recordSighting(await gpsPosition());
    } catch { /* pas de position : tant pis */ }
  }
  setInterval(sampleGps, 3 * 60 * 1000);
  map.on('locationfound', (e) => recordSighting({ lat: e.latlng.lat, lon: e.latlng.lng, acc: e.accuracy }));

  async function tryVisit(id) {
    if (!googleToken) { showAccount(); return; }
    const s = byId.get(id);
    let proof = JinjaProximity.findProof(sightings, s);
    if (!proof) {
      try { recordSighting(await gpsPosition(15000)); } catch { /* traité plus bas */ }
      proof = JinjaProximity.findProof(sightings, s);
    }
    if (!proof) {
      alert(`Pour collectionner « ${s.name} », il faut être passé à moins de 1 km du sanctuaire dans les 48 dernières heures.\n\n`
        + "Ta position n'a pas été enregistrée près d'ici. Autorise la localisation et réessaie sur place.");
      return;
    }
    markVisited(id, proof);
  }

  function markVisited(id, proof) {
    if (!googleToken) { showAccount(); return; }
    const now = new Date().toISOString();
    visits[id] = { date: now, note: '', updatedAt: now, proof };
    delete deleted[id];
    // Visité : il sort de la liste « À visiter ».
    if (wishlist[id]) { delete wishlist[id]; wishDeleted[id] = now; }
    saveVisits();
    map.closePopup();
    placeMarker(id);
    refreshPanels();
    openCard(id, true);
  }

  function unmarkVisited(id) {
    if (!googleToken) { showAccount(); return; }
    const s = byId.get(id);
    if (!confirm(`Retirer « ${s.name} » de tes visites ? La carte postale sera perdue.`)) return;
    delete visits[id];
    deleted[id] = new Date().toISOString();
    saveVisits();
    map.closePopup();
    placeMarker(id);
    refreshPanels();
  }

  function toggleWish(id) {
    if (!googleToken) { showAccount(); return; }
    const now = new Date().toISOString();
    if (wishlist[id]) { delete wishlist[id]; wishDeleted[id] = now; }
    else { wishlist[id] = { addedAt: now }; delete wishDeleted[id]; }
    // Changer de couche ferme la popup du marqueur : on la rouvre, à jour.
    const m = markers.get(id);
    const wasOpen = m?.isPopupOpen();
    saveVisits();
    placeMarker(id);
    refreshPanels();
    if (wasOpen) m.openPopup();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'visit') tryVisit(id);
    else if (action === 'unvisit') unmarkVisited(id);
    else if (action === 'card') openCard(id);
    else if (action === 'locate') focusShrine(id);
    else if (action === 'wish') toggleWish(id);
    else if (action === 'login-hint') { map.closePopup(); showAccount(); }
    else if (action === 'navigate') JinjaNav.start({ stops: [byId.get(id)], mode: routeMode });
  });

  // ---------- Panneau ----------
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
    if (document.body.classList.contains('panel-collapsed')) setCollapsed(false);
    if (tab.dataset.tab === 'friends') loadFriends();
  }));

  function refreshPanels() {
    const ordered = visitedOrdered();
    const n = ordered.length;
    $('#visited-count').textContent = n;
    renderWishlist();
    $('#progress').textContent = `${n.toLocaleString('fr-FR')} / ${shrines.length.toLocaleString('fr-FR')} sanctuaires visités`;
    $('#progress-fill').style.width = shrines.length ? Math.max(n ? 1.5 : 0, (n / shrines.length) * 100) + '%' : '0';

    const recent = [...ordered].reverse();
    $('#visited-empty').hidden = n > 0;
    $('#collection-empty').hidden = n > 0;
    $('#visited-list').innerHTML = recent.map(({ shrine: s, visit, number }) => `
      <li class="item visited">
        <button class="item-main" data-action="locate" data-id="${s.id}">
          <span class="item-icon">⛩</span>
          <span class="item-text">
            <span class="item-name">${esc(s.name)}</span>
            ${latinName(s) ? `<span class="item-romaji">${esc(latinName(s))}</span>` : ''}
            <span class="item-sub">No. ${String(number).padStart(4, '0')} · ${new Date(visit.date).toLocaleDateString('fr-FR')}${visit.note ? ' · ' + esc(visit.note) : ''}</span>
          </span>
        </button>
        <button class="ghost small" data-action="card" data-id="${s.id}">Carte</button>
      </li>`).join('');

    $('#card-grid').innerHTML = recent.map(({ shrine: s, visit, number }) => `
      <button class="card-thumb rarity-${ShrineCard.rarityOf(s.id).key}" data-action="card" data-id="${s.id}" title="${esc(s.name)}">
        ${ShrineCard.render(s, visit, number)}
      </button>`).join('');
    hydrateGrid(recent);

    renderSearch();
  }

  // ---------- Liste « À visiter » ----------
  function renderWishlist() {
    const items = Object.entries(wishlist)
      .filter(([id]) => byId.has(id) && !isVisited(id))
      .sort((a, b) => b[1].addedAt.localeCompare(a[1].addedAt))
      .map(([id, w]) => ({ s: byId.get(id), w }));
    $('#wish-count').textContent = items.length;
    $('#wish-empty').hidden = items.length > 0;
    renderRouteBox(items);
    $('#wish-list').innerHTML = items.map(({ s, w }) => `
      <li class="item wished">
        ${items.length > 1 ? `<input type="checkbox" class="route-check" data-route-id="${s.id}" title="Inclure dans le circuit" ${routeExcluded.has(s.id) ? '' : 'checked'}>` : ''}
        <button class="item-main" data-action="locate" data-id="${s.id}">
          <span class="item-icon">★</span>
          <span class="item-text">
            <span class="item-name">${esc(s.name)}</span>
            ${latinName(s) ? `<span class="item-romaji">${esc(latinName(s))}</span>` : ''}
            <span class="item-sub">Ajouté le ${new Date(w.addedAt).toLocaleDateString('fr-FR')}</span>
          </span>
        </button>
        <button class="ghost small" data-action="${googleToken ? 'wish' : 'login-hint'}" data-id="${s.id}" title="Retirer de la liste">✕</button>
      </li>`).join('');
  }

  // ---------- Circuit (itinéraire à plusieurs étapes) ----------
  // Les sanctuaires cochés de la liste « À visiter » sont ordonnés au mieux (route.js),
  // le parcours est tracé sur la carte et peut être ouvert dans Google Maps.
  const MAX_ROUTE_STOPS = 25;
  const routeExcluded = new Set();
  let routeMode = 'foot';
  let routeFromMe = false;
  let routeState = { busy: false, error: '', result: null };
  const routeLayer = L.layerGroup().addTo(map);

  const fmtDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);
  function fmtDuration(sec) {
    const min = Math.max(1, Math.round(sec / 60));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  function routeStops(items) {
    return items.filter(({ s }) => !routeExcluded.has(s.id)).map(({ s }) => s);
  }

  function googleRouteUrl(stops, fromMe, mode) {
    // Google Maps accepte un départ, une arrivée et 9 étapes intermédiaires au maximum.
    const list = stops.slice(0, fromMe ? 10 : 11).map((s) => `${s.lat},${s.lon}`);
    const params = new URLSearchParams({ api: '1', travelmode: mode === 'car' ? 'driving' : 'walking' });
    if (!fromMe) params.set('origin', list.shift());
    params.set('destination', list.pop());
    if (list.length) params.set('waypoints', list.join('|'));
    return `https://www.google.com/maps/dir/?${params}`;
  }

  function renderRouteBox(items) {
    const box = $('#route-box');
    const stops = routeStops(items);
    const enough = stops.length + (routeFromMe ? 1 : 0) >= 2;
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false;
    const { busy, error, result } = routeState;
    let resultHtml = '';
    if (result) {
      const labels = result.ordered.map((p) => (p.me ? 'Ma position' : p.name));
      const truncated = result.ordered.filter((p) => !p.me).length > (result.fromMe ? 10 : 11);
      resultHtml = `
        <div class="route-summary">${result.ordered.filter((p) => !p.me).length} étapes · ${fmtDistance(result.distance)} · ${fmtDuration(result.duration)} ${result.mode === 'car' ? 'en voiture' : 'à pied'}</div>
        <ol class="route-steps">${labels.map((label, i) => `
          <li><span class="route-num">${result.ordered[i].me ? '◎' : i + (result.fromMe ? 0 : 1)}</span>
            <span class="route-step-name">${esc(label)}</span>
            ${i < result.legs.length ? `<span class="route-leg">↓ ${fmtDuration(result.legs[i].duration)} · ${fmtDistance(result.legs[i].distance)}</span>` : ''}</li>`).join('')}
        </ol>
        <div class="route-actions">
          <button type="button" class="primary" data-route="start">▶ Démarrer</button>
          <a class="ghost small route-gmaps" href="${googleRouteUrl(result.ordered.filter((p) => !p.me), result.fromMe, result.mode)}" target="_blank" rel="noopener">Ouvrir dans Google Maps ↗</a>
          <button type="button" class="ghost small" data-route="clear">Effacer</button>
        </div>
        ${truncated ? '<p class="hint">Google Maps n\'accepte que 10 étapes : le lien couvre les premières.</p>' : ''}`;
    }
    box.innerHTML = `
      <div class="route-head">
        <strong>Circuit</strong>
        <div class="route-modes">
          <button type="button" data-route-mode="foot" class="${routeMode === 'foot' ? 'on' : ''}">🚶 À pied</button>
          <button type="button" data-route-mode="car" class="${routeMode === 'car' ? 'on' : ''}">🚗 Voiture</button>
        </div>
      </div>
      <label class="route-option"><input type="checkbox" data-route="from-me" ${routeFromMe ? 'checked' : ''}> Partir de ma position</label>
      <button type="button" class="primary route-go" data-route="go" ${busy || !enough ? 'disabled' : ''}>
        ${busy ? 'Calcul du circuit…' : enough ? `Tracer le circuit (${stops.length} sanctuaire${stops.length > 1 ? 's' : ''})` : 'Coche au moins 2 sanctuaires'}
      </button>
      ${stops.length > MAX_ROUTE_STOPS ? `<p class="hint">Seuls les ${MAX_ROUTE_STOPS} premiers sanctuaires cochés seront pris en compte.</p>` : ''}
      ${error ? `<p class="route-error">${esc(error)}</p>` : ''}
      ${resultHtml}`;
  }

  function drawRoute(result) {
    routeLayer.clearLayers();
    L.geoJSON(result.geometry, { style: { color: '#d63b23', weight: 5, opacity: 0.8, dashArray: result.mode === 'foot' ? '2 9' : null, lineCap: 'round' } }).addTo(routeLayer);
    let n = 0;
    for (const p of result.ordered) {
      const icon = L.divIcon({ className: 'route-pin', html: `<span>${p.me ? '◎' : ++n}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      const marker = L.marker([p.lat, p.lon], { icon, zIndexOffset: 2000, title: p.me ? 'Ma position' : p.name }).addTo(routeLayer);
      if (!p.me) marker.on('click', () => focusShrine(p.id));
    }
    map.fitBounds(L.geoJSON(result.geometry).getBounds(), { padding: [40, 40] });
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('localisation non disponible'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ me: true, lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => reject(new Error("impossible d'obtenir ta position (autorise la localisation)")),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  }

  async function computeRoute() {
    const items = Object.keys(wishlist).filter((id) => byId.has(id) && !isVisited(id)).map((id) => ({ s: byId.get(id) }));
    const stops = routeStops(items).slice(0, MAX_ROUTE_STOPS);
    routeState = { busy: true, error: '', result: null };
    routeLayer.clearLayers();
    renderWishlist();
    try {
      const points = routeFromMe ? [await currentPosition(), ...stops] : stops;
      const result = await JinjaRoute.plan(points, { mode: routeMode, fixedStart: routeFromMe });
      routeState = { busy: false, error: '', result: { ...result, mode: routeMode, fromMe: routeFromMe } };
      drawRoute(routeState.result);
      if (isMobile()) setCollapsed(true);
    } catch (err) {
      routeState = { busy: false, error: 'Circuit impossible : ' + err.message, result: null };
    }
    renderWishlist();
  }

  // Navigation étape par étape sur le circuit tracé (sanctuaires pas encore visités).
  function startCircuit() {
    const result = routeState.result;
    if (!result) return;
    const stops = result.ordered.filter((p) => !p.me && !isVisited(p.id));
    if (!stops.length) { alert('Tous les sanctuaires de ce circuit sont déjà visités.'); return; }
    JinjaNav.start({ stops, mode: result.mode, circuit: stops.length > 1 });
  }

  // ---------- Navigation (navigation.js) ----------
  // Pendant la navigation : panneau replié, popup fermée, tracé du circuit masqué.
  let navRestore = null;
  JinjaNav.setup({
    map,
    isVisited,
    markVisited: tryVisit,
    onGps: recordSighting,
    onStart() {
      if (!navRestore) {
        navRestore = { sheet: sheetState(), hidden: document.body.classList.contains('panel-hidden') };
      }
      map.closePopup();
      map.removeLayer(routeLayer);
      if (isMobile()) setCollapsed(true); else setPanelHidden(true);
    },
    onStop() {
      map.addLayer(routeLayer);
      if (navRestore) {
        if (isMobile()) setSheet(navRestore.sheet); else setPanelHidden(navRestore.hidden);
        navRestore = null;
      }
    },
  });

  function clearRoute() {
    routeLayer.clearLayers();
    routeState = { busy: false, error: '', result: null };
    renderWishlist();
  }

  $('#tab-wish').addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-route-mode]');
    if (modeBtn) { routeMode = modeBtn.dataset.routeMode; renderWishlist(); return; }
    const action = e.target.closest('[data-route]')?.dataset.route;
    if (action === 'go') computeRoute();
    else if (action === 'clear') clearRoute();
    else if (action === 'start') startCircuit();
  });
  $('#tab-wish').addEventListener('change', (e) => {
    if (e.target.matches('[data-route="from-me"]')) routeFromMe = e.target.checked;
    else if (e.target.matches('.route-check')) {
      if (e.target.checked) routeExcluded.delete(e.target.dataset.routeId); else routeExcluded.add(e.target.dataset.routeId);
    } else return;
    renderWishlist();
  });

  // ---------- Recherche ----------
  // Ignore casse, accents, espaces et tirets : « fushimi inari taisha » trouve « Fushimi Inari-taisha ».
  const normalize = (str) => str.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\s\-_'’.・]/g, '');
  let searchTimer;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 150);
    if (cityView) closeCity();
    scheduleCitySearch();
  });

  const shrineItemHtml = (s) => `
      <li class="item ${isVisited(s.id) ? 'visited' : isWished(s.id) ? 'wished' : ''}">
        <button class="item-main" data-action="locate" data-id="${s.id}">
          <span class="item-icon">${isVisited(s.id) ? '⛩' : isWished(s.id) ? '★' : '◦'}</span>
          <span class="item-text">
            <span class="item-name">${esc(s.name)}</span>
            ${latinName(s) ? `<span class="item-romaji">${esc(latinName(s))}</span>` : ''}
            ${isVisited(s.id) ? '<span class="item-sub">visité ✓</span>' : ''}
          </span>
        </button>
      </li>`;

  function renderSearch() {
    const q = normalize($('#search').value.trim());
    const list = $('#search-results');
    $('#search-hint').hidden = !!q || !!cityView;
    if (cityView) renderCityView();
    if (!q) { list.innerHTML = ''; return; }
    const results = [];
    for (const s of shrines) {
      if (s.search.includes(q)) { results.push(s); if (results.length >= 60) break; }
    }
    list.innerHTML = results.length ? results.map(shrineItemHtml).join('') : '<li class="hint">Aucun sanctuaire de ce nom.</li>';
  }

  // ---------- Recherche par ville (geo.js : Nominatim, puis sanctuaires dans le contour) ----------
  // Nominatim demande au plus 1 requête par seconde : on attend une pause de saisie.
  let cityTimer;
  let cityState = { query: '', status: 'idle', places: [], error: '' };
  let cityView = null; // ville ouverte (liste de ses sanctuaires)
  let citySort = 'todo'; // 'todo' : non visités d'abord ; 'name' : par nom
  const placeShrines = new WeakMap();
  function shrinesOfPlace(place) {
    if (!placeShrines.has(place)) placeShrines.set(place, JinjaGeo.shrinesIn(place, shrines));
    return placeShrines.get(place);
  }

  function scheduleCitySearch() {
    clearTimeout(cityTimer);
    const query = $('#search').value.trim();
    if (!JinjaGeo.isCityQuery(query)) { cityState = { query, status: 'idle', places: [], error: '' }; renderCities(); return; }
    const cached = JinjaGeo.cached(query);
    if (cached) { showPlaces(query, cached); return; }
    cityTimer = setTimeout(async () => {
      cityState = { query, status: 'loading', places: [], error: '' };
      renderCities();
      try {
        showPlaces(query, await JinjaGeo.findPlaces(query));
      } catch (err) {
        if ($('#search').value.trim() !== query) return;
        cityState = { query, status: 'error', places: [], error: err.message };
        renderCities();
      }
    }, 600);
  }

  function showPlaces(query, places) {
    if ($('#search').value.trim() !== query) return; // saisie modifiée entre-temps
    cityState = { query, status: 'done', places: places.filter((p) => shrinesOfPlace(p).length), error: '' };
    renderCities();
  }

  function renderCities() {
    const { status, places, error } = cityState;
    const count = (n) => `${n.toLocaleString('fr-FR')} sanctuaire${n > 1 ? 's' : ''}`;
    $('#city-results').innerHTML = status === 'loading' ? '<li class="hint city-status">Recherche de villes…</li>'
      : status === 'error' ? `<li class="hint city-error">Recherche par ville impossible : ${esc(error)}. Vérifie ta connexion et réessaie.</li>`
        : places.map((p, i) => `
      <li class="item city">
        <button class="item-main" data-city="${i}">
          <span class="item-icon">🏙</span>
          <span class="item-text">
            <span class="item-name">${esc(p.label)} — ${count(shrinesOfPlace(p).length)}</span>
            ${p.region ? `<span class="item-sub">${esc(p.region)}</span>` : ''}
          </span>
        </button>
      </li>`).join('');
  }

  function openCity(place) {
    if (!place) return;
    cityView = place;
    renderCityView();
    $('#tab-explore').scrollTop = 0;
    const [w, s, e, n] = place.bbox;
    const cover = sheetCover();
    map.fitBounds([[s, w], [n, e]], { paddingTopLeft: [20, 20], paddingBottomRight: [20, 20 + cover] });
  }

  function closeCity() {
    cityView = null;
    renderCityView();
    $('#search-hint').hidden = !!$('#search').value.trim();
  }

  function renderCityView() {
    const view = $('#city-view');
    view.hidden = !cityView;
    $('#city-results').hidden = $('#search-results').hidden = !!cityView;
    if (!cityView) { view.innerHTML = ''; return; }
    $('#search-hint').hidden = true;
    const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
    const list = [...shrinesOfPlace(cityView)]
      .sort(citySort === 'name' ? byName : (a, b) => isVisited(a.id) - isVisited(b.id) || byName(a, b));
    const done = list.filter((s) => isVisited(s.id)).length;
    view.innerHTML = `
      <button type="button" class="link-btn city-back" data-city-back>← Retour à la recherche</button>
      <h2 class="city-title">🏙 ${esc(cityView.label)}</h2>
      <p class="city-meta">${cityView.region ? esc(cityView.region) + ' · ' : ''}${list.length.toLocaleString('fr-FR')} sanctuaire${list.length > 1 ? 's' : ''} · ${done} visité${done > 1 ? 's' : ''}</p>
      <div class="route-modes city-sort">
        <button type="button" data-city-sort="todo" class="${citySort === 'todo' ? 'on' : ''}">Non visités d'abord</button>
        <button type="button" data-city-sort="name" class="${citySort === 'name' ? 'on' : ''}">Par nom</button>
      </div>
      <ul class="list">${list.map(shrineItemHtml).join('')}</ul>`;
  }

  $('#tab-explore').addEventListener('click', (e) => {
    const city = e.target.closest('[data-city]');
    if (city) openCity(cityState.places[+city.dataset.city]);
    else if (e.target.closest('[data-city-back]')) closeCity();
    else if (e.target.closest('[data-city-sort]')) { citySort = e.target.closest('[data-city-sort]').dataset.citySort; renderCityView(); }
  });

  // ---------- Carte postale ----------
  // Crédit affiché sur la carte, en texte simple.
  const cardCredit = (photo) => (photo.credit || 'Wikimedia Commons').replace(/\s*↗$/, '').replace(/^Photo de /, '').replace(/&amp;/g, '&');

  // Remplace l'illustration par la photo de couverture une fois celle-ci chargée.
  function withCoverPhoto(container, s, visit, number) {
    return coverPhoto(s).then((photo) => {
      if (!photo || !container.isConnected) return;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      return new Promise((resolve) => {
        img.onload = () => {
          if (container.isConnected) container.innerHTML = ShrineCard.render(s, visit, number, { src: photo.src, credit: cardCredit(photo) });
          resolve();
        };
        img.onerror = resolve;
        img.src = photo.src;
      });
    });
  }

  // Une carte après l'autre : évite de bombarder Wikimedia quand la collection est grande.
  let gridRun = 0;
  async function hydrateGrid(items) {
    const run = ++gridRun;
    for (const { shrine: s, visit, number } of items) {
      if (run !== gridRun) return;
      const thumb = document.querySelector(`#card-grid .card-thumb[data-id="${s.id}"]`);
      if (thumb) await withCoverPhoto(thumb, s, visit, number);
    }
  }

  let modalId = null;
  function openCard(id, isNew = false) {
    const s = byId.get(id);
    const visit = visits[id];
    if (!s || !visit) return;
    modalId = id;
    $('#modal-title').textContent = isNew ? '✨ Nouvelle carte obtenue !' : s.name;
    $('#modal-card').innerHTML = ShrineCard.render(s, visit, cardNumber(id));
    withCoverPhoto($('#modal-card'), s, visit, cardNumber(id));
    $('#modal-card').className = isNew ? 'reveal' : '';
    $('#modal-note').value = visit.note || '';
    $('#modal-note').disabled = !googleToken;
    $('#modal-note').placeholder = googleToken ? 'Un souvenir, un omamori acheté, la météo…' : 'Connecte-toi pour écrire une note de visite.';
    $('#card-modal').hidden = false;
  }
  function closeCard() { $('#card-modal').hidden = true; modalId = null; }
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeCard));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#card-modal').hidden) closeCard(); });
  $('#modal-note').addEventListener('change', (e) => {
    if (!modalId || !googleToken) return;
    visits[modalId].note = e.target.value.trim();
    visits[modalId].updatedAt = new Date().toISOString();
    saveVisits();
    refreshPanels();
  });

  // Une image SVG dessinée dans un canvas ne charge pas les images externes :
  // on intègre la photo en data URL avant l'export. En cas d'échec, export avec l'illustration.
  async function exportableSvg(svg, s) {
    const photo = svg.querySelector('image[data-photo]');
    if (!photo) return svg;
    try {
      const blob = await (await fetch(photo.getAttribute('href'))).blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const clone = svg.cloneNode(true);
      clone.querySelector('image[data-photo]').setAttribute('href', dataUrl);
      return clone;
    } catch {
      const tmp = document.createElement('div');
      tmp.innerHTML = ShrineCard.render(s, visits[s.id], cardNumber(s.id));
      return tmp.firstElementChild;
    }
  }

  $('#modal-download').addEventListener('click', async () => {
    const s = byId.get(modalId);
    const svg = await exportableSvg($('#modal-card svg'), s);
    const vb = svg.viewBox.baseVal;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = vb.width * 2; canvas.height = vb.height * 2;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => download(blob, `jinja-${s.name}.png`), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  });

  // ---------- Sauvegarde ----------
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('#export-btn').addEventListener('click', () => {
    const data = { app: 'jinja-collection', exportedAt: new Date().toISOString(), visits, wishlist };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `jinja-collection-${new Date().toISOString().slice(0, 10)}.json`);
  });
  // Restaurer une sauvegarde ajoute des visites : réservé aux comptes connectés, et le serveur
  // applique ses règles (voir api/sync.js).
  $('.file-btn').addEventListener('click', (e) => {
    if (!googleToken) { e.preventDefault(); showAccount(); }
  });
  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !googleToken) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = data.visits || {};
      let added = 0;
      for (const [id, v] of Object.entries(incoming)) {
        if (!v || typeof v.date !== 'string' || isVisited(id)) continue;
        visits[id] = { date: v.date, note: typeof v.note === 'string' ? v.note : '', updatedAt: new Date().toISOString() };
        delete deleted[id];
        added++;
        if (markers.has(id)) placeMarker(id);
      }
      let wished = 0;
      for (const [id, w] of Object.entries(data.wishlist || {})) {
        if (!w || typeof w.addedAt !== 'string' || wishlist[id] || isVisited(id)) continue;
        wishlist[id] = { addedAt: w.addedAt };
        delete wishDeleted[id];
        wished++;
        if (markers.has(id)) placeMarker(id);
      }
      saveVisits();
      refreshPanels();
      alert(`${added} visite(s) et ${wished} sanctuaire(s) « À visiter » restauré(s).`);
    } catch (err) {
      alert('Fichier de sauvegarde invalide : ' + err.message);
    }
    e.target.value = '';
  });

  // ---------- Ordinateur : replier le panneau vers la gauche ----------
  const SIDE_KEY = 'jinja-collection:panel-hidden';
  function setPanelHidden(hidden) {
    document.body.classList.toggle('panel-hidden', hidden);
    const label = hidden ? 'Afficher le menu' : 'Masquer le menu';
    $('.panel-edge').setAttribute('aria-label', label);
    $('.panel-edge').title = label;
    try { localStorage.setItem(SIDE_KEY, hidden ? '1' : '0'); } catch { /* ignore */ }
  }
  try {
    if (localStorage.getItem(SIDE_KEY) === '1') {
      setPanelHidden(true);
      setTimeout(() => map.invalidateSize(), 400);
    }
  } catch { /* ignore */ }
  $('.panel-edge').addEventListener('click', () => setPanelHidden(!document.body.classList.contains('panel-hidden')));
  // La carte change de largeur : Leaflet doit recalculer sa taille à la fin de l'animation.
  $('.panel').addEventListener('transitionend', (e) => {
    if (e.target === e.currentTarget && e.propertyName === 'margin-left') map.invalidateSize();
  });

  // ---------- Compte Google et synchronisation ----------
  // « Se connecter avec Google » donne un jeton d'identité (valable 1 h) que le serveur vérifie.
  // Les visites restent aussi dans le navigateur : la synchro fusionne les deux (voir merge.js).
  const TOKEN_KEY = 'jinja-collection:google-token';
  const LOGGED_KEY = 'jinja-collection:logged-in';
  let googleClientId = null;
  let googleToken = null;
  let googleUser = null;
  let syncTimer = null;
  let syncing = null;
  let syncAgain = false;
  let syncStatus = { text: '', error: false };
  // Nom d'utilisateur public (undefined : pas encore lu ; null : pas encore choisi).
  let username;
  let editingName = false;

  function jwtPayload(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    } catch { return null; }
  }

  function setToken(token) {
    const payload = token && jwtPayload(token);
    const valid = payload && payload.exp * 1000 > Date.now() + 60 * 1000;
    if (!valid || googleToken !== token) { username = undefined; friends = null; friendView = null; }
    googleToken = valid ? token : null;
    googleUser = valid ? { name: payload.name || payload.email, email: payload.email, picture: payload.picture } : null;
    // Connecté, la collection est synchronisée : Sauvegarder / Restaurer deviennent inutiles.
    document.body.classList.toggle('signed-in', !!valid);
    try {
      if (valid) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(LOGGED_KEY, '1'); }
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
    renderAccount();
    if (shrines.length) refreshPanels();
    renderFriends();
  }

  const syncApi = (method, body) => syncApiAt('/api/sync', method, body);
  async function syncApiAt(path, method, body) {
    const res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${googleToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      setToken(null);
      silentLogin();
      throw new Error('session expirée, reconnexion…');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `erreur ${res.status}`);
    return data;
  }

  function applyMerged(merged) {
    const changed = new Set([
      ...[...Object.keys(visits), ...Object.keys(merged.visits)].filter((id) => !!visits[id] !== !!merged.visits[id]),
      ...[...Object.keys(wishlist), ...Object.keys(merged.wishlist)].filter((id) => !!wishlist[id] !== !!merged.wishlist[id]),
    ]);
    visits = merged.visits;
    deleted = merged.deleted;
    wishlist = merged.wishlist;
    wishDeleted = merged.wishDeleted;
    persistVisits();
    changed.forEach((id) => { if (markers.has(id)) placeMarker(id); });
    refreshPanels();
  }

  function setSyncStatus(text, error = false) {
    syncStatus = { text, error };
    const el = $('#sync-status');
    if (el) { el.textContent = text; el.classList.toggle('error', error); }
  }

  // Lit le compte, fusionne avec le navigateur, puis renvoie le résultat si quelque chose a changé.
  function syncNow() {
    if (!googleToken) return Promise.resolve();
    if (syncing) { syncAgain = true; return syncing; }
    setSyncStatus('Synchronisation…');
    syncing = (async () => {
      const { state: remote } = await syncApi('GET');
      // Le compte d'abord : à égalité, la version du serveur (avec le statut de vérification) l'emporte.
      const merged = JinjaMerge.merge(remote, { visits, deleted, wishlist, wishDeleted });
      applyMerged(merged);
      if (!JinjaMerge.same(merged, remote)) {
        const { state: saved } = await syncApi('PUT', merged);
        if (saved) applyMerged(JinjaMerge.merge(saved, { visits, deleted, wishlist, wishDeleted }));
        loadDiscoveries();
      }
      setSyncStatus('Synchronisé ✓');
      loadProfile();
    })()
      .catch((err) => setSyncStatus('Synchro impossible : ' + err.message, true))
      .finally(() => {
        syncing = null;
        if (syncAgain) { syncAgain = false; scheduleSync(); }
      });
    return syncing;
  }

  // ---------- Amis (api/friends.js) ----------
  // friends : null tant que la liste n'est pas chargée ; friendView : collection d'un ami ouverte.
  let friends = null;
  let friendView = null;
  let friendsError = '';
  const friendsApi = (method, body, query = '') => syncApiAt(`/api/friends${query}`, method, body);

  async function loadFriends() {
    if (!googleToken || !username) { renderFriends(); return; }
    try { friends = await friendsApi('GET'); friendsError = ''; } catch (err) { friendsError = err.message; }
    renderFriends();
  }

  async function friendAction(action, name) {
    try { await friendsApi('POST', { action, username: name }); friendsError = ''; } catch (err) { friendsError = err.message; }
    await loadFriends();
  }

  async function openFriend(name) {
    friendView = { username: name, visits: null };
    renderFriends();
    try { friendView = await friendsApi('GET', null, `?user=${encodeURIComponent(name)}`); } catch (err) { friendView = null; friendsError = err.message; }
    renderFriends();
  }

  function shrineLink(id) {
    const s = byId.get(id);
    return s ? `<button class="link-btn" data-action="locate" data-id="${s.id}">${esc(s.name)}</button>` : 'sanctuaire inconnu';
  }

  function renderFriends() {
    const box = $('#friends-box');
    const n = friends?.incoming.length || 0;
    $('#friends-count').textContent = n;
    $('#friends-count').hidden = !n;
    if (!googleToken) {
      box.innerHTML = `<p class="hint">Connecte-toi avec Google pour ajouter des amis et voir leurs collections.</p>
        <button class="primary" data-action="login-hint">Se connecter</button>`;
      return;
    }
    if (!username) {
      box.innerHTML = `<p class="hint">Choisis d'abord ton nom d'utilisateur public (encart du compte, en haut) : c'est par ce nom que tes amis te trouvent.</p>`;
      return;
    }
    const error = friendsError ? `<p class="friends-error">${esc(friendsError)}</p>` : '';
    if (friendView) {
      const ordered = Object.entries(friendView.visits || {})
        .filter(([id]) => byId.has(id))
        .sort((a, b) => a[1].date.localeCompare(b[1].date))
        .map(([id, visit], i) => ({ shrine: byId.get(id), visit, number: i + 1 }));
      box.innerHTML = `${error}
        <button class="ghost small" data-friends="back">← Amis</button>
        <h3 class="friends-title">Collection de @${esc(friendView.username)}${friendView.visits ? ` · ${ordered.length} carte${ordered.length > 1 ? 's' : ''}` : ''}</h3>
        ${!friendView.visits ? '<p class="hint">Chargement…</p>' : ordered.length ? `<div class="card-grid">${[...ordered].reverse().map(({ shrine: s, visit, number }) => `
          <button class="card-thumb rarity-${ShrineCard.rarityOf(s.id).key}" data-action="locate" data-id="${s.id}" title="${esc(s.name)} — ${new Date(visit.date).toLocaleDateString('fr-FR')}">
            ${ShrineCard.render(s, visit, number)}
          </button>`).join('')}</div>` : '<p class="hint">Sa collection est encore vide.</p>'}`;
      return;
    }
    const item = (name, sub, buttons) => `<li class="item friend">
        <span class="item-main"><span class="item-icon">${esc(name[0].toUpperCase())}</span>
        <span class="item-text"><span class="item-name">@${esc(name)}</span>${sub ? `<span class="item-sub">${sub}</span>` : ''}</span></span>${buttons}</li>`;
    box.innerHTML = `${error}
      <form class="friend-add">
        <input name="username" placeholder="Nom d'utilisateur d'un ami" required minlength="3" maxlength="20" autocomplete="off">
        <button class="primary small" type="submit">Ajouter</button>
      </form>
      <p class="hint">Tu es <b>@${esc(username)}</b>. Tes amis voient tes cartes postales (sanctuaires et dates), jamais tes notes ni ta position.</p>
      ${!friends ? '<p class="hint">Chargement…</p>' : `
        ${friends.incoming.length ? `<h3 class="friends-title">Demandes reçues</h3><ul class="list">${friends.incoming.map((name) => item(name, 'veut être ton ami',
          `<button class="primary small" data-friends="add" data-name="${esc(name)}">Accepter</button><button class="ghost small" data-friends="remove" data-name="${esc(name)}">Refuser</button>`)).join('')}</ul>` : ''}
        <h3 class="friends-title">Mes amis</h3>
        ${friends.friends.length ? `<ul class="list">${friends.friends.map((f) => item(f.username,
          `${f.count} carte${f.count > 1 ? 's' : ''}${f.last ? ` · dernier : ${shrineLink(f.last.id)} (${new Date(f.last.date).toLocaleDateString('fr-FR')})` : ''}`,
          `<button class="ghost small" data-friends="view" data-name="${esc(f.username)}">Collection</button><button class="ghost small" data-friends="remove" data-name="${esc(f.username)}" title="Retirer de mes amis">✕</button>`)).join('')}</ul>`
          : '<p class="hint">Pas encore d\'amis. Ajoute-les par leur nom d\'utilisateur.</p>'}
        ${friends.outgoing.length ? `<h3 class="friends-title">Demandes envoyées</h3><ul class="list">${friends.outgoing.map((name) => item(name, 'en attente',
          `<button class="ghost small" data-friends="remove" data-name="${esc(name)}">Annuler</button>`)).join('')}</ul>` : ''}`}`;
  }

  $('#tab-friends').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-friends]');
    if (!btn) return;
    const { friends: action, name } = btn.dataset;
    if (action === 'back') { friendView = null; renderFriends(); }
    else if (action === 'view') openFriend(name);
    else if (action === 'remove' && !confirm(`Retirer @${name} ?`)) return;
    else if (action === 'add' || action === 'remove') friendAction(action, name);
  });
  $('#tab-friends').addEventListener('submit', (e) => {
    if (!e.target.matches('.friend-add')) return;
    e.preventDefault();
    friendAction('add', e.target.elements.username.value.trim());
  });

  async function loadProfile() {
    if (!googleToken || username !== undefined) return;
    try {
      ({ username } = await syncApiAt('/api/profile', 'GET'));
      renderAccount();
      loadFriends();
    } catch { /* réessayé à la prochaine synchro */ }
  }

  function scheduleSync() {
    if (!googleToken) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1200);
  }

  // Reconnexion silencieuse des habitués (auto_select) quand le jeton a expiré.
  function silentLogin() {
    try { if (googleClientId && window.google && localStorage.getItem(LOGGED_KEY)) google.accounts.id.prompt(); } catch { /* ignore */ }
  }

  // Ouvre le menu et met en évidence l'encart de connexion.
  function showAccount() {
    if (isMobile()) setCollapsed(false); else setPanelHidden(false);
    const el = $('#account');
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  function renderAccount() {
    const el = $('#account');
    if (!googleClientId) { el.hidden = true; return; }
    el.hidden = false;
    if (googleUser) {
      el.innerHTML = `
        ${googleUser.picture ? `<img class="account-avatar" src="${esc(googleUser.picture)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="account-text">
          <span class="account-name">${esc(googleUser.name)}</span>
          ${username ? `<span class="account-username">@${esc(username)} · <button type="button" class="link-btn" data-edit-name>modifier</button></span>` : ''}
          <span id="sync-status" class="account-status ${syncStatus.error ? 'error' : ''}">${esc(syncStatus.text)}</span>
        </div>
        <button id="logout-btn" class="ghost small" type="button">Déconnexion</button>
        ${username === null || editingName ? `
          <form class="username-form">
            <label>${username ? 'Nouveau nom d’utilisateur' : 'Choisis ton nom d’utilisateur public'} <small>(visible par les autres : amis, « Découvert par »)</small>
              <span class="username-row"><input name="username" required minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]{3,20}" placeholder="ex : kitsune_77" value="${esc(username || '')}" autocomplete="off">
              <button class="primary small" type="submit">OK</button></span>
            </label>
            <span class="username-error" data-name-error></span>
          </form>` : ''}`;
      el.querySelector('[data-edit-name]')?.addEventListener('click', () => { editingName = true; renderAccount(); });
      el.querySelector('.username-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = e.target.elements.username;
        try {
          ({ username } = await syncApiAt('/api/profile', 'PUT', { username: input.value }));
          editingName = false;
          renderAccount();
          loadFriends();
          loadDiscoveries();
        } catch (err) {
          el.querySelector('[data-name-error]').textContent = err.message;
        }
      });
      $('#logout-btn').addEventListener('click', () => {
        try { google.accounts.id.disableAutoSelect(); localStorage.removeItem(LOGGED_KEY); } catch { /* ignore */ }
        setSyncStatus('');
        setToken(null);
      });
    } else {
      el.innerHTML = `<p class="account-pitch">Connecte-toi pour collectionner les sanctuaires et retrouver tes cartes partout.</p><div id="google-btn"></div>`;
      if (window.google?.accounts?.id) {
        google.accounts.id.renderButton($('#google-btn'), { theme: 'outline', size: 'medium', shape: 'pill', text: 'signin_with', locale: 'fr' });
      }
    }
  }

  try { setToken(localStorage.getItem(TOKEN_KEY)); } catch { setToken(null); }
  fetch('/api/config')
    .then((res) => (res.ok ? res.json() : null))
    .then((config) => {
      if (!config?.googleClientId) return;
      googleClientId = config.googleClientId;
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => { setToken(credential); syncNow(); sampleGps(); },
          auto_select: true,
          use_fedcm_for_prompt: true,
        });
        renderAccount();
        if (googleToken) { syncNow(); sampleGps(); } else silentLogin();
      };
      document.head.append(script);
    })
    .catch(() => { /* serveur local sans /api : pas de compte */ });

  // Revenir sur l'appli (autre onglet, téléphone déverrouillé) récupère les cartes ajoutées ailleurs.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(); });

  // ---------- Mobile : volet à trois positions ----------
  // Replié (barre seule, carte en plein écran), moitié, ou plein écran (collection, listes).
  // On glisse la barre du haut entre ces positions. Un tap sur la flèche replie / déplie ;
  // un tap ailleurs sur la barre passe de moitié à plein écran et inversement.
  const SHEET_KEY = 'jinja-collection:sheet';
  const SHEET_STATES = ['collapsed', 'half', 'full'];
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
  const panel = $('.panel');
  const sheetState = () => (document.body.classList.contains('panel-collapsed') ? 'collapsed'
    : document.body.classList.contains('panel-full') ? 'full' : 'half');

  function setSheet(state) {
    document.body.classList.toggle('panel-collapsed', state === 'collapsed');
    document.body.classList.toggle('panel-full', state === 'full');
    $('.sheet-toggle').setAttribute('aria-label', state === 'collapsed' ? 'Déplier le menu' : 'Replier le menu');
    try { localStorage.setItem(SHEET_KEY, state); } catch { /* ignore */ }
  }
  // Compatibilité : replier / déplier sans perdre le plein écran déjà choisi.
  function setCollapsed(collapsed) {
    if (collapsed) setSheet('collapsed');
    else if (sheetState() === 'collapsed') setSheet('half');
  }
  // Au chargement, on ne rouvre pas en plein écran : la carte doit rester visible.
  try { if (isMobile() && localStorage.getItem(SHEET_KEY) === 'collapsed') setSheet('collapsed'); } catch { /* ignore */ }

  function sheetHeights() {
    const vh = window.visualViewport?.height || window.innerHeight;
    const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek'));
    return { collapsed: peek, half: vh * 0.64, full: vh - 10 };
  }

  // Hauteur de carte cachée par le volet (mobile) ; en plein écran, il repasse à moitié pour la montrer.
  function sheetCover() {
    if (!isMobile()) return 0;
    if (sheetState() === 'full') setSheet('half');
    return sheetHeights()[sheetState()];
  }

  let drag = null;
  $('.sheet-grab').addEventListener('pointerdown', (e) => {
    if (!isMobile()) return;
    drag = { y: e.clientY, dy: 0, startH: panel.offsetHeight, state: sheetState(), onToggle: !!e.target.closest('.sheet-toggle') };
    $('.sheet-grab').setPointerCapture(e.pointerId);
  });
  $('.sheet-grab').addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dy = e.clientY - drag.y;
    if (Math.abs(drag.dy) < 6) return;
    const h = sheetHeights();
    panel.classList.add('dragging');
    panel.style.height = `${Math.min(h.full, Math.max(h.collapsed, drag.startH - drag.dy))}px`;
  });
  function endDrag() {
    if (!drag) return;
    const { dy, startH, state, onToggle } = drag;
    drag = null;
    panel.classList.remove('dragging');
    panel.style.height = '';
    if (Math.abs(dy) < 6) {
      if (onToggle) setSheet(state === 'collapsed' ? 'half' : 'collapsed');
      else setSheet(state === 'half' ? 'full' : 'half');
      return;
    }
    // Position la plus proche de la hauteur atteinte ; un geste net change au moins d'un cran.
    const h = sheetHeights();
    const target = startH - dy;
    let next = SHEET_STATES.reduce((a, b) => (Math.abs(h[b] - target) < Math.abs(h[a] - target) ? b : a));
    const i = SHEET_STATES.indexOf(state);
    if (next === state && Math.abs(dy) > 50) next = SHEET_STATES[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))];
    setSheet(next);
  }
  $('.sheet-grab').addEventListener('pointerup', endDrag);
  $('.sheet-grab').addEventListener('pointercancel', endDrag);


  // ---------- Chargement ----------
  fetch('data/shrines.json?v=3') // version à changer quand les données sont régénérées
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      shrines = data.shrines.map(([id, name, nameLatin, lat, lon, photo, romaji = '']) => ({
        id, name, nameLatin, lat, lon, photo, romaji, search: normalize(`${name} ${nameLatin} ${romaji}`),
      }));
      shrines.forEach((s) => byId.set(s.id, s));
      const todo = [];
      for (const s of shrines) {
        const m = makeMarker(s);
        if (isVisited(s.id)) visitedLayer.addLayer(m.setZIndexOffset(1000));
        else if (isWished(s.id)) wishLayer.addLayer(m.setZIndexOffset(500));
        else todo.push(m);
      }
      cluster.addLayers(todo);
      refreshPanels();
    })
    .catch((err) => {
      $('#progress').textContent = 'Erreur de chargement des sanctuaires (' + err.message + '). Lance un serveur local : voir README.';
    });
})();
