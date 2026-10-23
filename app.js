(function () {
  const STORAGE_KEY = 'jinja-collection:visits';
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- État ----------
  let shrines = [];
  const byId = new Map();
  const markers = new Map();
  let visits = loadVisits();

  function loadVisits() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }
  function saveVisits() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visits)); }
    catch (err) { alert("Impossible d'enregistrer la visite : " + err.message); }
  }
  const isVisited = (id) => Object.prototype.hasOwnProperty.call(visits, id);

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
  map.addLayer(cluster);
  map.addLayer(visitedLayer);

  function makeMarker(s) {
    const m = L.marker([s.lat, s.lon], { icon: isVisited(s.id) ? iconDone : iconTodo, title: s.name });
    m.shrineId = s.id;
    m.bindPopup(() => popupHtml(s), { minWidth: 260, maxWidth: 260 });
    markers.set(s.id, m);
    return m;
  }

  function placeMarker(id) {
    const m = markers.get(id);
    if (isVisited(id)) {
      cluster.removeLayer(m);
      m.setIcon(iconDone).setZIndexOffset(1000);
      visitedLayer.addLayer(m);
    } else {
      visitedLayer.removeLayer(m);
      m.setIcon(iconTodo).setZIndexOffset(0);
      cluster.addLayer(m);
    }
  }

  function popupHtml(s) {
    const done = isVisited(s.id);
    const latin = s.nameLatin && s.nameLatin !== s.name ? `<div class="popup-latin">${esc(s.nameLatin)}</div>` : '';
    const gmaps = `https://www.google.com/maps/search/?api=1&query=${s.lat}%2C${s.lon}`;
    const status = done
      ? `<div class="popup-status done">✓ Visité le ${new Date(visits[s.id].date).toLocaleDateString('fr-FR')}</div>`
      : '<div class="popup-status">Pas encore visité</div>';
    const actions = done
      ? `<button class="primary" data-action="card" data-id="${s.id}">Voir ma carte</button>
         <button class="ghost small" data-action="unvisit" data-id="${s.id}">Retirer</button>`
      : `<button class="primary" data-action="visit" data-id="${s.id}">J'y suis allé ⛩</button>`;
    return `<div class="popup">
      <div class="popup-cover" data-cover="${s.id}"><div class="popup-cover-loading"><span>Recherche d'une photo…</span></div></div>
      <div class="popup-name">${esc(s.name)}</div>${latin}${status}
      <div class="popup-actions">${actions}</div>
      <a class="popup-link" href="${gmaps}" target="_blank" rel="noopener">Ouvrir dans Google Maps ↗</a>
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

  function showIllustration(s, el, label) {
    el.innerHTML = ShrineCard.renderScene(s) + `<span class="popup-cover-credit">${label}</span>`;
  }

  function loadCover(s, el) {
    photoFor(s).then((photo) => {
      if (!el.isConnected) return;
      if (!photo) return showIllustration(s, el, 'Pas encore de photo · illustration');
      const img = new Image();
      img.alt = s.name;
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        el.innerHTML = '';
        el.append(img);
        const credit = photo.credit || `${photo.nearby ? 'Photo prise à proximité · ' : ''}Wikimedia Commons ↗`;
        el.insertAdjacentHTML('beforeend', `<a class="popup-cover-credit" href="${esc(photo.href)}" target="_blank" rel="noopener">${credit}</a>`);
        // Lien direct vers la fiche Google Maps du sanctuaire quand Google l'a trouvé.
        const link = el.closest('.popup')?.querySelector('.popup-link');
        if (link && photo.mapsUri) link.href = photo.mapsUri;
      };
      img.onerror = () => {
        forgetPhoto(s.id);
        if (el.isConnected) showIllustration(s, el, 'Photo indisponible pour le moment');
      };
      img.src = photo.src;
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
    if (window.matchMedia('(max-width: 760px)').matches) document.body.classList.add('panel-collapsed');
    if (isVisited(id)) {
      map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), zoom), { duration: 0.8 });
      map.once('moveend', () => m.openPopup());
    } else {
      cluster.zoomToShowLayer(m, () => m.openPopup());
    }
  }

  // ---------- Actions ----------
  function markVisited(id) {
    visits[id] = { date: new Date().toISOString(), note: '' };
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
    saveVisits();
    map.closePopup();
    placeMarker(id);
    refreshPanels();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'visit') markVisited(id);
    else if (action === 'unvisit') unmarkVisited(id);
    else if (action === 'card') openCard(id);
    else if (action === 'locate') focusShrine(id);
  });

  // ---------- Panneau ----------
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab.dataset.tab));
    document.body.classList.remove('panel-collapsed');
  }));

  function refreshPanels() {
    const ordered = visitedOrdered();
    const n = ordered.length;
    $('#visited-count').textContent = n;
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
            <span class="item-sub">No. ${String(number).padStart(4, '0')} · ${new Date(visit.date).toLocaleDateString('fr-FR')}${visit.note ? ' · ' + esc(visit.note) : ''}</span>
          </span>
        </button>
        <button class="ghost small" data-action="card" data-id="${s.id}">Carte</button>
      </li>`).join('');

    $('#card-grid').innerHTML = recent.map(({ shrine: s, visit, number }) => `
      <button class="card-thumb rarity-${ShrineCard.rarityOf(s.id).key}" data-action="card" data-id="${s.id}" title="${esc(s.name)}">
        ${ShrineCard.render(s, visit, number)}
      </button>`).join('');

    renderSearch();
  }

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
          <span class="item-icon">${isVisited(s.id) ? '⛩' : '◦'}</span>
          <span class="item-text">
            <span class="item-name">${esc(s.name)}</span>
            <span class="item-sub">${esc(s.nameLatin || '')}${isVisited(s.id) ? ' · visité ✓' : ''}</span>
          </span>
        </button>
      </li>`).join('') : '<li class="hint">Aucun sanctuaire trouvé.</li>';
  }

  // ---------- Carte postale ----------
  let modalId = null;
  function openCard(id, isNew = false) {
    const s = byId.get(id);
    const visit = visits[id];
    if (!s || !visit) return;
    modalId = id;
    $('#modal-title').textContent = isNew ? '✨ Nouvelle carte obtenue !' : s.name;
    $('#modal-card').innerHTML = ShrineCard.render(s, visit, cardNumber(id));
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
    saveVisits();
    refreshPanels();
  });

  $('#modal-download').addEventListener('click', () => {
    const svg = $('#modal-card svg');
    const s = byId.get(modalId);
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
    const data = { app: 'jinja-collection', exportedAt: new Date().toISOString(), visits };
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
        visits[id] = { date: v.date, note: typeof v.note === 'string' ? v.note : '' };
        added++;
        if (markers.has(id)) placeMarker(id);
      }
      saveVisits();
      refreshPanels();
      alert(`${added} visite(s) restaurée(s).`);
    } catch (err) {
      alert('Fichier de sauvegarde invalide : ' + err.message);
    }
    e.target.value = '';
  });

  // ---------- Mobile : réduire / déplier le panneau ----------
  $('.brand').addEventListener('click', () => {
    if (window.matchMedia('(max-width: 760px)').matches) document.body.classList.toggle('panel-collapsed');
  });

  document.querySelector('.panel').addEventListener('transitionend', () => map.invalidateSize());

  // ---------- Chargement ----------
  fetch('data/shrines.json')
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      shrines = data.shrines.map(([id, name, nameLatin, lat, lon, photo]) => ({ id, name, nameLatin, lat, lon, photo, search: normalize(name + ' ' + nameLatin) }));
      shrines.forEach((s) => byId.set(s.id, s));
      const todo = [];
      for (const s of shrines) {
        const m = makeMarker(s);
        if (isVisited(s.id)) visitedLayer.addLayer(m.setZIndexOffset(1000));
        else todo.push(m);
      }
      cluster.addLayers(todo);
      refreshPanels();
    })
    .catch((err) => {
      $('#progress').textContent = 'Erreur de chargement des sanctuaires (' + err.message + '). Lance un serveur local : voir README.';
    });
})();
