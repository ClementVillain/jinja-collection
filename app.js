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

  function popupHtml(s) {
    const done = isVisited(s.id);
    const latin = latinName(s) ? `<div class="popup-latin">${esc(latinName(s))}</div>` : '';
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${s.lat}%2C${s.lon}`;
    const wished = isWished(s.id);
    const status = done
      ? `<div class="popup-status done">✓ Visité le ${new Date(visits[s.id].date).toLocaleDateString('fr-FR')}</div>`
      : wished ? '<div class="popup-status wish">★ Dans ta liste « À visiter »</div>'
      : '<div class="popup-status">Pas encore visité</div>';
    const actions = done
      ? `<button class="primary" data-action="card" data-id="${s.id}">Voir ma carte</button>
         <button class="ghost small" data-action="unvisit" data-id="${s.id}">Retirer</button>`
      : `<button class="primary" data-action="visit" data-id="${s.id}">J'y suis allé ⛩</button>
         <button class="ghost small wish-btn${wished ? ' on' : ''}" data-action="wish" data-id="${s.id}">${wished ? '★ Retirer de la liste' : '☆ À visiter'}</button>`;
    return `<div class="popup">
      <div class="popup-cover" data-cover="${s.id}"><div class="popup-cover-loading"><span>Recherche d'une photo…</span></div></div>
      <div class="popup-name">${esc(s.name)}</div>${latin}${status}
      <div class="popup-actions">${actions}</div>
      ${!communityAvailable ? '' : googleToken ? `<label class="popup-upload">📷 Partager ma photo de ce sanctuaire
        <input type="file" accept="image/*" data-upload="${s.id}" hidden></label>
      <div class="popup-upload-status" data-upload-status></div>`
    : '<button type="button" class="popup-upload" data-action="login-hint">📷 Connecte-toi pour partager ta photo</button>'}
      <div class="popup-links">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat}%2C${s.lon}&travelmode=walking" target="_blank" rel="noopener">🧭 Itinéraire ↗</a>
        <a class="popup-link" href="${gmaps}" target="_blank" rel="noopener">Ouvrir dans Google Maps ↗</a>
      </div>
    </div>`;
  }

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
    const label = popup.querySelector('.popup-upload');
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
  }

  // Image de couverture retenue pour un sanctuaire : la même pour la popup et la carte postale.
  const coverPhoto = (s) => photoFor(s).catch(() => null).then((wiki) => chooseCover(s, wiki));

  function slideHtml(s, photo) {
    const credit = photo.credit || `${photo.nearby ? 'Photo prise à proximité · ' : ''}Wikimedia Commons ↗`;
    const avatar = photo.by?.picture;
    return `<div class="cover-slide">
      <img class="cover-img" src="${esc(photo.src)}" alt="${esc(s.name)}" referrerpolicy="no-referrer" draggable="false">
      <a class="popup-cover-credit${avatar ? ' with-avatar' : ''}" href="${esc(photo.href)}" target="_blank" rel="noopener">${credit}</a>
      ${avatar ? `<img class="popup-cover-avatar" src="${esc(avatar)}" alt="${esc(photo.by.name || '')}" title="Photo partagée par ${esc(photo.by.name || 'un visiteur')}" referrerpolicy="no-referrer" draggable="false">` : ''}
    </div>`;
  }

  // Carrousel : flèches, points, balayage au doigt. Une photo qui ne charge pas est retirée.
  function renderCarousel(s, el, slides, start = 0) {
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

  function focusShrine(id, zoom = 16) {
    const s = byId.get(id);
    const m = markers.get(id);
    if (!s || !m) return;
    if (window.matchMedia('(max-width: 760px)').matches) setCollapsed(true);
    if (isVisited(id) || isWished(id)) {
      // Déjà centrée dessus : la carte ne bougerait pas et « moveend » n'arriverait jamais.
      if (map.getZoom() >= zoom && map.getCenter().distanceTo([s.lat, s.lon]) < 20) { m.openPopup(); return; }
      map.once('moveend', () => m.openPopup());
      map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), zoom), { duration: 0.8 });
    } else {
      cluster.zoomToShowLayer(m, () => m.openPopup());
    }
  }

  // ---------- Actions ----------
  function markVisited(id) {
    const now = new Date().toISOString();
    visits[id] = { date: now, note: '', updatedAt: now };
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
    if (action === 'visit') markVisited(id);
    else if (action === 'unvisit') unmarkVisited(id);
    else if (action === 'card') openCard(id);
    else if (action === 'locate') focusShrine(id);
    else if (action === 'wish') toggleWish(id);
    else if (action === 'login-hint') showAccount();
  });

  // ---------- Panneau ----------
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
    if (document.body.classList.contains('panel-collapsed')) setCollapsed(false);
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
        <button class="ghost small" data-action="wish" data-id="${s.id}" title="Retirer de la liste">✕</button>
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
          <a class="primary route-gmaps" href="${googleRouteUrl(result.ordered.filter((p) => !p.me), result.fromMe, result.mode)}" target="_blank" rel="noopener">Ouvrir dans Google Maps ↗</a>
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
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 150); });

  function renderSearch() {
    const q = normalize($('#search').value.trim());
    const list = $('#search-results');
    $('#search-hint').hidden = !!q;
    if (!q) { list.innerHTML = ''; return; }
    const results = [];
    for (const s of shrines) {
      if (s.search.includes(q)) { results.push(s); if (results.length >= 60) break; }
    }
    list.innerHTML = results.length ? results.map((s) => `
      <li class="item ${isVisited(s.id) ? 'visited' : ''}">
        <button class="item-main" data-action="locate" data-id="${s.id}">
          <span class="item-icon">${isVisited(s.id) ? '⛩' : isWished(s.id) ? '★' : '◦'}</span>
          <span class="item-text">
            <span class="item-name">${esc(s.name)}</span>
            ${latinName(s) ? `<span class="item-romaji">${esc(latinName(s))}</span>` : ''}
            ${isVisited(s.id) ? '<span class="item-sub">visité ✓</span>' : ''}
          </span>
        </button>
      </li>`).join('') : '<li class="hint">Aucun sanctuaire trouvé.</li>';
  }

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
    $('#card-modal').hidden = false;
  }
  function closeCard() { $('#card-modal').hidden = true; modalId = null; }
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeCard));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#card-modal').hidden) closeCard(); });
  $('#modal-note').addEventListener('change', (e) => {
    if (!modalId) return;
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
  $('#import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
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

  function jwtPayload(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    } catch { return null; }
  }

  function setToken(token) {
    const payload = token && jwtPayload(token);
    const valid = payload && payload.exp * 1000 > Date.now() + 60 * 1000;
    googleToken = valid ? token : null;
    googleUser = valid ? { name: payload.name || payload.email, email: payload.email, picture: payload.picture } : null;
    // Connecté, la collection est synchronisée : Sauvegarder / Restaurer deviennent inutiles.
    document.body.classList.toggle('signed-in', !!valid);
    try {
      if (valid) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(LOGGED_KEY, '1'); }
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
    renderAccount();
  }

  async function syncApi(method, body) {
    const res = await fetch('/api/sync', {
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
      const merged = JinjaMerge.merge({ visits, deleted, wishlist, wishDeleted }, remote);
      applyMerged(merged);
      if (!JinjaMerge.same(merged, remote)) await syncApi('PUT', merged);
      setSyncStatus('Synchronisé ✓');
    })()
      .catch((err) => setSyncStatus('Synchro impossible : ' + err.message, true))
      .finally(() => {
        syncing = null;
        if (syncAgain) { syncAgain = false; scheduleSync(); }
      });
    return syncing;
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
          <span id="sync-status" class="account-status ${syncStatus.error ? 'error' : ''}">${esc(syncStatus.text)}</span>
        </div>
        <button id="logout-btn" class="ghost small" type="button">Déconnexion</button>`;
      $('#logout-btn').addEventListener('click', () => {
        try { google.accounts.id.disableAutoSelect(); localStorage.removeItem(LOGGED_KEY); } catch { /* ignore */ }
        setSyncStatus('');
        setToken(null);
      });
    } else {
      el.innerHTML = `<p class="account-pitch">Connecte-toi pour retrouver tes cartes sur tous tes appareils.</p><div id="google-btn"></div>`;
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
          callback: ({ credential }) => { setToken(credential); syncNow(); },
          auto_select: true,
          use_fedcm_for_prompt: true,
        });
        renderAccount();
        if (googleToken) syncNow(); else silentLogin();
      };
      document.head.append(script);
    })
    .catch(() => { /* serveur local sans /api : pas de compte */ });

  // Revenir sur l'appli (autre onglet, téléphone déverrouillé) récupère les cartes ajoutées ailleurs.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(); });

  // ---------- Mobile : réduire / déplier le panneau ----------
  // Sur mobile, le panneau est un volet : on le glisse vers le bas pour libérer la carte,
  // vers le haut pour le rouvrir, ou on tape sur sa barre pour basculer.
  const SHEET_KEY = 'jinja-collection:sheet-collapsed';
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
  const panel = $('.panel');
  function setCollapsed(collapsed) {
    document.body.classList.toggle('panel-collapsed', collapsed);
    $('.sheet-toggle').setAttribute('aria-label', collapsed ? 'Déplier le menu' : 'Replier le menu');
    try { localStorage.setItem(SHEET_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }
  try { if (isMobile() && localStorage.getItem(SHEET_KEY) === '1') setCollapsed(true); } catch { /* ignore */ }

  let drag = null;
  $('.sheet-grab').addEventListener('pointerdown', (e) => {
    if (!isMobile()) return;
    const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek'));
    const collapsedOffset = panel.offsetHeight - peek;
    const start = document.body.classList.contains('panel-collapsed') ? collapsedOffset : 0;
    drag = { y: e.clientY, start, max: collapsedOffset, dy: 0 };
    $('.sheet-grab').setPointerCapture(e.pointerId);
  });
  $('.sheet-grab').addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dy = e.clientY - drag.y;
    if (Math.abs(drag.dy) < 6) return;
    panel.classList.add('dragging');
    panel.style.transform = `translateY(${Math.min(drag.max, Math.max(0, drag.start + drag.dy))}px)`;
  });
  function endDrag() {
    if (!drag) return;
    const { dy } = drag;
    drag = null;
    panel.classList.remove('dragging');
    panel.style.transform = '';
    if (Math.abs(dy) < 6) setCollapsed(!document.body.classList.contains('panel-collapsed'));
    else if (dy > 50) setCollapsed(true);
    else if (dy < -50) setCollapsed(false);
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
