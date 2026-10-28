// Génère la carte postale de collection d'un sanctuaire, en SVG.
// L'illustration est dérivée de l'identifiant du sanctuaire : une même
// carte a toujours la même saison, le même paysage et la même rareté.
(function () {
  const W = 600, H = 400;

  const THEMES = [
    { key: 'sakura', label: '桜 Sakura', sky: ['#ffd9e4', '#fff3f0'], sun: '#ff9fb6', hills: ['#e7a9bd', '#c98aa6', '#9c6a8c'], ground: '#7d5370', deco: 'petal', decoColor: '#ff8fae' },
    { key: 'momiji', label: '紅葉 Momiji', sky: ['#ffb36b', '#ffe6c4'], sun: '#ff6b3d', hills: ['#d9673a', '#a8452d', '#6f2d24'], ground: '#4d211c', deco: 'leaf', decoColor: '#e5402a' },
    { key: 'yuki', label: '雪 Yuki', sky: ['#c9dcef', '#f4f8fc'], sun: '#ffffff', hills: ['#dfe9f3', '#b5c7da', '#8ea4bd'], ground: '#f6f9fc', deco: 'snow', decoColor: '#ffffff' },
    { key: 'yoru', label: '夜 Yoru', sky: ['#0f1838', '#2c3a6b'], sun: '#fff4c8', hills: ['#27325c', '#1c2547', '#121a35'], ground: '#0b1128', deco: 'star', decoColor: '#fff4c8' },
    { key: 'asa', label: '朝 Asa', sky: ['#ffe9a8', '#fff8e6'], sun: '#ffb13b', hills: ['#a7c4c2', '#7fa3a6', '#557b82'], ground: '#3e5c62', deco: 'bird', decoColor: '#3e5c62' },
    { key: 'matcha', label: '森 Mori', sky: ['#cfe6c8', '#f2f8ec'], sun: '#f7f1c6', hills: ['#8fbf86', '#5f9561', '#3c6b45'], ground: '#284a31', deco: 'firefly', decoColor: '#f2ff9e' },
  ];

  const RARITIES = [
    { key: 'commun', label: 'Commune', border: '#e3ebe6', chance: 0.72 },
    { key: 'rare', label: 'Rare ★', border: 'url(#gold)', chance: 0.23 },
    { key: 'legendaire', label: 'Légendaire ★★', border: 'url(#holo)', chance: 0.05 },
  ];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function themeOf(id) { return THEMES[hash(id + ':theme') % THEMES.length]; }

  function rarityOf(id) {
    const r = rng(hash(id + ':rarity'))();
    let acc = 0;
    for (const rarity of RARITIES) {
      acc += rarity.chance;
      if (r < acc) return rarity;
    }
    return RARITIES[0];
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hillPath(rand, baseY, amp, step) {
    let d = `M0 ${H} L0 ${baseY}`;
    for (let x = 0; x <= W; x += step) {
      d += ` Q${x + step / 2} ${baseY - rand() * amp} ${x + step} ${baseY - rand() * amp * 0.4}`;
    }
    return d + ` L${W} ${H} Z`;
  }

  function fuji(rand, color, snowy) {
    const cx = 120 + rand() * 360, top = 95 + rand() * 30;
    const peak = `M${cx - 230} 300 L${cx - 28} ${top} Q${cx} ${top - 6} ${cx + 28} ${top} L${cx + 230} 300 Z`;
    const cap = `M${cx - 28} ${top} Q${cx} ${top - 6} ${cx + 28} ${top} L${cx + 62} ${top + 48} L${cx + 34} ${top + 38} L${cx + 12} ${top + 54} L${cx - 14} ${top + 36} L${cx - 40} ${top + 52} L${cx - 62} ${top + 48} Z`;
    return `<path d="${peak}" fill="${color}" opacity="0.85"/>` + (snowy ? `<path d="${cap}" fill="#ffffff" opacity="0.95"/>` : '');
  }

  function torii(x, y, s, color) {
    // x,y : pied du pilier gauche ; s : échelle
    const h = 150 * s;
    const p = (n) => (n * s).toFixed(1);
    return `<g transform="translate(${x.toFixed(1)} ${(y - h).toFixed(1)})" fill="${color}">
      <path d="M${p(-22)} ${p(14)} Q${p(75)} ${p(-2)} ${p(172)} ${p(14)} L${p(170)} ${p(2)} Q${p(75)} ${p(-14)} ${p(-20)} ${p(2)} Z" fill="#1d1d1d"/>
      <rect x="${p(-12)}" y="${p(12)}" width="${p(174)}" height="${p(12)}" rx="${p(2)}"/>
      <rect x="${p(-2)}" y="${p(44)}" width="${p(154)}" height="${p(10)}"/>
      <rect x="${p(68)}" y="${p(22)}" width="${p(14)}" height="${p(24)}" fill="#1d1d1d"/>
      <path d="M${p(12)} ${p(22)} L${p(26)} ${p(22)} L${p(30)} ${p(150)} L${p(8)} ${p(150)} Z"/>
      <path d="M${p(124)} ${p(22)} L${p(138)} ${p(22)} L${p(142)} ${p(150)} L${p(120)} ${p(150)} Z"/>
      <rect x="${p(4)}" y="${p(142)}" width="${p(30)}" height="${p(8)}" fill="#1d1d1d"/>
      <rect x="${p(116)}" y="${p(142)}" width="${p(30)}" height="${p(8)}" fill="#1d1d1d"/>
    </g>`;
  }

  function decorations(rand, theme) {
    let out = '';
    const n = theme.deco === 'star' ? 40 : 22;
    for (let i = 0; i < n; i++) {
      const x = rand() * W, y = rand() * (theme.deco === 'star' ? 180 : 300);
      const r = 2 + rand() * 4, rot = rand() * 360;
      const c = theme.decoColor;
      switch (theme.deco) {
        case 'petal':
          out += `<ellipse cx="${x}" cy="${y}" rx="${r * 1.3}" ry="${r * 0.7}" fill="${c}" opacity="${0.6 + rand() * 0.4}" transform="rotate(${rot} ${x} ${y})"/>`; break;
        case 'leaf':
          out += `<path d="M${x} ${y - r * 1.6} L${x + r} ${y} L${x} ${y + r * 1.6} L${x - r} ${y} Z" fill="${c}" opacity="${0.7 + rand() * 0.3}" transform="rotate(${rot} ${x} ${y})"/>`; break;
        case 'snow':
          out += `<circle cx="${x}" cy="${y}" r="${r * 0.6}" fill="${c}" opacity="${0.6 + rand() * 0.4}"/>`; break;
        case 'star':
          out += `<circle cx="${x}" cy="${y}" r="${r * 0.35}" fill="${c}" opacity="${0.4 + rand() * 0.6}"/>`; break;
        case 'bird':
          if (i % 4 === 0) out += `<path d="M${x - 8} ${y * 0.5} Q${x - 4} ${y * 0.5 - 5} ${x} ${y * 0.5} Q${x + 4} ${y * 0.5 - 5} ${x + 8} ${y * 0.5}" stroke="${c}" stroke-width="1.6" fill="none"/>`; break;
        case 'firefly':
          out += `<circle cx="${x}" cy="${180 + y * 0.4}" r="${r * 0.5}" fill="${c}" opacity="${0.5 + rand() * 0.5}"/>`; break;
      }
    }
    return out;
  }

  function lanterns(rand, y) {
    let out = '';
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const x = 40 + rand() * 520;
      out += `<g transform="translate(${x.toFixed(0)} ${y})"><rect x="-3" y="-34" width="6" height="34" fill="#3b3b3b"/><rect x="-9" y="-48" width="18" height="16" rx="3" fill="#ffcf6b"/><path d="M-12 -48 L0 -56 L12 -48 Z" fill="#3b3b3b"/></g>`;
    }
    return out;
  }

  let renderCount = 0;

  // Paysage de la carte (ciel, montagnes, torii), dans un repère W×H.
  function scene(id, theme, uid) {
    const rand = rng(hash(id));
    const toriiColor = theme.key === 'yoru' ? '#e8452c' : '#d63b23';
    const sunX = 80 + rand() * 440, sunY = 60 + rand() * 50;
    const showFuji = rand() < 0.35;
    const toriiScale = 0.75 + rand() * 0.35;
    const toriiX = 140 + rand() * (W - 280 - 150 * toriiScale);
    return `<defs><linearGradient id="${uid}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.sky[0]}"/><stop offset="1" stop-color="${theme.sky[1]}"/></linearGradient></defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${uid}sky)"/>
    <circle cx="${sunX}" cy="${sunY}" r="${theme.key === 'yoru' ? 28 : 46}" fill="${theme.sun}" opacity="0.9"/>
    ${showFuji ? fuji(rand, theme.hills[0], theme.key !== 'momiji') : ''}
    <path d="${hillPath(rand, 250, 70, 150)}" fill="${theme.hills[0]}" opacity="0.8"/>
    <path d="${hillPath(rand, 290, 60, 120)}" fill="${theme.hills[1]}"/>
    <path d="${hillPath(rand, 330, 40, 100)}" fill="${theme.hills[2]}"/>
    <rect x="0" y="${H - 50}" width="${W}" height="60" fill="${theme.ground}"/>
    ${theme.key === 'yoru' || theme.key === 'matcha' ? lanterns(rand, H - 46) : ''}
    ${torii(toriiX, H - 44, toriiScale, toriiColor)}
    ${decorations(rand, theme)}`;
  }

  // Illustration seule, utilisée quand aucune photo du sanctuaire n'est disponible.
  function renderScene(shrine) {
    const uid = 'c' + (++renderCount) + '-';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${H * 0.2} ${W} ${H * 0.8}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration : ${esc(shrine.name)}">${scene(shrine.id, themeOf(shrine.id), uid)}</svg>`;
  }

  // photo (facultatif) : { src, credit } — la même image que la couverture de la popup.
  // Sans photo, la carte garde son illustration générée.
  function photoLayer(photo, uid) {
    const credit = photo.credit ? `<rect x="20" y="${H - 26}" width="${W - 40}" height="26" fill="url(#${uid}shade)"/>
    <text x="32" y="${H - 9}" font-family="Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="11" fill="#fff" opacity="0.9">Photo : ${esc(photo.credit)}</text>` : '';
    return `<defs><linearGradient id="${uid}shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="#2b2420"/>
    <image data-photo="1" href="${esc(photo.src)}" x="20" y="20" width="${W - 40}" height="${H - 20}" preserveAspectRatio="xMidYMid slice"/>
    ${credit}`;
  }

  function render(shrine, visit, number, photo) {
    const id = shrine.id;
    const theme = themeOf(id);
    const rarity = rarityOf(id);
    // Identifiants uniques par rendu : la même carte peut être affichée plusieurs fois dans la page.
    const uid = 'c' + (++renderCount) + '-';
    const date = visit && visit.date ? new Date(visit.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
    const num = String(number || 0).padStart(4, '0');
    const latin = shrine.romaji || (shrine.nameLatin && shrine.nameLatin !== shrine.name ? shrine.nameLatin : '');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 120}" class="shrine-card" role="img" aria-label="Carte postale : ${esc(shrine.name)}">
  <defs>
    <linearGradient id="${uid}gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d77a"/><stop offset="0.5" stop-color="#b8892f"/><stop offset="1" stop-color="#f6d77a"/></linearGradient>
    <linearGradient id="${uid}holo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9ad5"/><stop offset="0.25" stop-color="#9ad0ff"/><stop offset="0.5" stop-color="#a6ffcb"/><stop offset="0.75" stop-color="#ffe29a"/><stop offset="1" stop-color="#d59aff"/></linearGradient>
    <clipPath id="${uid}clip"><rect x="20" y="20" width="${W - 40}" height="${H - 20}" rx="6"/></clipPath>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H + 120}" rx="18" fill="${rarity.border.replace('url(#', 'url(#' + uid)}"/>
  <rect x="10" y="10" width="${W - 20}" height="${H + 100}" rx="12" fill="#ffffff"/>
  <g clip-path="url(#${uid}clip)">
    ${photo ? photoLayer(photo, uid) : scene(id, theme, uid)}
  </g>
  <g transform="translate(${W - 92} 52) rotate(-12)">
    <circle r="40" fill="none" stroke="#c8281e" stroke-width="4" opacity="0.85"/>
    <circle r="33" fill="none" stroke="#c8281e" stroke-width="1.5" opacity="0.85"/>
    <text y="-4" text-anchor="middle" font-family="Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="20" font-weight="700" fill="#c8281e" opacity="0.9">参拝</text>
    <text y="16" text-anchor="middle" font-family="Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="9" fill="#c8281e" opacity="0.9">${visit && visit.date ? new Date(visit.date).toLocaleDateString('fr-FR') : ''}</text>
  </g>
  <text x="36" y="${H + 44}" font-family="Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="32" font-weight="700" fill="#1d1e18">${esc(shrine.name)}</text>
  <text x="36" y="${H + 72}" font-family="Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="16" fill="#5e6a60">${esc(latin)}</text>
  <text x="36" y="${H + 98}" font-family="Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="13" fill="#7d897f">${esc(theme.label)} · ${esc(rarity.label)}${date ? ' · visité le ' + esc(date) : ''}</text>
  <text x="${W - 36}" y="${H + 98}" text-anchor="end" font-family="Roboto, 'Hiragino Sans', 'Noto Sans JP', sans-serif" font-size="18" font-weight="700" fill="#4f6e55">No. ${num}</text>
</svg>`;
  }

  module.exports = { render, renderScene, themeOf, rarityOf };
})();
