// Transcription en romaji (Hepburn) des noms de sanctuaires.
// 1. lecture kana fournie par OpenStreetMap si elle existe (exacte) ;
// 2. sinon lecture devinée par l'analyseur kuromoji, aidée d'un petit dictionnaire de
//    mots de sanctuaires dont la lecture usuelle diffère (八幡 = Hachiman, pas Yahata).
// Si un kanji reste sans lecture, on renvoie '' plutôt qu'une transcription fausse.
const Kuroshiro = require('kuroshiro').default || require('kuroshiro');
const KuromojiAnalyzer = require('kuroshiro-analyzer-kuromoji');

// Suffixes : écrits comme un mot séparé.
const SUFFIXES = [
  ['大神宮', 'Daijingū'], ['天満宮', 'Tenmangū'], ['八幡宮', 'Hachimangū'], ['神社', 'Jinja'],
  ['神宮', 'Jingū'], ['大社', 'Taisha'], ['遥拝所', 'Yōhaisho'], ['遙拝所', 'Yōhaisho'],
  ['御旅所', 'Otabisho'], ['奥宮', 'Okumiya'], ['奥社', 'Okusha'], ['本宮', 'Hongū'],
  ['分社', 'Bunsha'], ['社', 'Sha'], ['宮', 'Gū'], ['祠', 'Hokora'],
];
// Lectures usuelles des noms de divinités / sanctuaires.
const WORDS = {
  八幡: 'はちまん', 稲荷: 'いなり', 天満: 'てんまん', 天神: 'てんじん', 熊野: 'くまの', 春日: 'かすが',
  諏訪: 'すわ', 白山: 'はくさん', 浅間: 'せんげん', 金刀比羅: 'ことひら', 琴平: 'ことひら', 金比羅: 'こんぴら',
  秋葉: 'あきば', 愛宕: 'あたご', 日枝: 'ひえ', 日吉: 'ひよし', 山王: 'さんのう', 住吉: 'すみよし',
  神明: 'しんめい', 八雲: 'やくも', 八坂: 'やさか', 氷川: 'ひかわ', 香取: 'かとり', 鹿島: 'かしま',
  貴船: 'きふね', 厳島: 'いつくしま', 嚴島: 'いつくしま', 宗像: 'むなかた', 御嶽: 'みたけ', 弁天: 'べんてん',
  弁財天: 'べんざいてん', 蛭子: 'えびす', 恵比寿: 'えびす', 子安: 'こやす', 水天: 'すいてん', 塩竈: 'しおがま',
  若宮: 'わかみや', 天祖: 'てんそ', 皇大: 'こうたい', 天照: 'あまてらす', 大山祇: 'おおやまづみ',
  第六天: 'だいろくてん', 疱瘡: 'ほうそう', 山神: 'やまのかみ', 水神: 'すいじん', 竜神: 'りゅうじん',
  龍神: 'りゅうじん', 道祖神: 'どうそじん', 津島: 'つしま', 三峯: 'みつみね', 三峰: 'みつみね', 古峯: 'ふるみね',
  阿夫利: 'あふり', 出雲: 'いずも', 大鳥: 'おおとり', 香椎: 'かしい', 宇佐: 'うさ', 北野: 'きたの',
  菅原: 'すがわら', 豊受: 'とようけ', 伊勢: 'いせ', 熱田: 'あつた', 多賀: 'たが', 白鬚: 'しらひげ', 白髭: 'しらひげ',
  天王: 'てんのう', 牛頭: 'ごず', 須賀: 'すが', 御霊: 'ごりょう', 金山: 'かなやま', 大歳: 'おおとし',
};
const WORD_RE = new RegExp(Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|'), 'g');
const KANJI = /[\u3400-\u9fff\uf900-\ufaff]/;
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1);
// Voyelles longues en Hepburn « moderne » : shou → shō, ryuu → ryū.
const macronize = (r) => r.replace(/ou|oo/g, 'ō').replace(/uu/g, 'ū');

async function createRomanizer() {
  const kuroshiro = new Kuroshiro();
  await kuroshiro.init(new KuromojiAnalyzer());
  const kanaToRomaji = (kana) => macronize(Kuroshiro.Util.kanaToRomaji(kana, 'hepburn'));
  const guess = async (text) => (await kuroshiro.convert(text, { to: 'romaji', mode: 'normal', romajiSystem: 'hepburn' })).replace(/\s+/g, '');

  function splitSuffixes(text) {
    const suffixes = [];
    let core = text;
    for (let found = true; found;) {
      found = false;
      for (const [kanji, romaji] of SUFFIXES) {
        if (core.length <= kanji.length || !core.endsWith(kanji)) continue;
        // 若宮 est un nom à part entière : ne pas le couper en 若 + 宮.
        if (Object.keys(WORDS).some((w) => w.length > kanji.length && w.endsWith(kanji) && core.endsWith(w))) continue;
        suffixes.unshift(romaji);
        core = core.slice(0, -kanji.length);
        found = true;
        break;
      }
    }
    return { core, suffixes };
  }

  // Le cœur du nom est découpé en mots du dictionnaire et en autres morceaux,
  // chacun lu séparément (le contexte d'un mot ne fausse pas la lecture du voisin).
  async function coreRomaji(core) {
    const pieces = [];
    let last = 0;
    for (const m of core.matchAll(WORD_RE)) {
      if (m.index > last) pieces.push(core.slice(last, m.index));
      pieces.push(m[0]);
      last = m.index + m[0].length;
    }
    if (last < core.length) pieces.push(core.slice(last));
    const words = [];
    for (const piece of pieces) {
      const r = WORDS[piece] ? kanaToRomaji(WORDS[piece]) : await guess(piece);
      if (KANJI.test(r) || !/[a-z]/i.test(r)) return null;
      words.push(capitalize(r));
    }
    return words.join(' ');
  }

  async function part(text, kana) {
    const { core, suffixes } = splitSuffixes(text);
    if (kana) {
      // Lecture exacte d'OSM : on sépare seulement le suffixe s'il est reconnaissable.
      let r = kanaToRomaji(kana.replace(/\s+/g, ''));
      const tail = [];
      for (const suffix of [...suffixes].reverse()) {
        const low = suffix.toLowerCase();
        // « temmangū » (m devant b/m/p) doit reconnaître le suffixe « Tenmangū ».
        const comparable = r.replace(/m(?=[bmp])/g, 'n');
        if (r.length > low.length && comparable.endsWith(low)) { tail.unshift(suffix); r = r.slice(0, -low.length); } else break;
      }
      return [capitalize(r), ...tail].join(' ');
    }
    if (!core) return suffixes.join(' ');
    const romaji = await coreRomaji(core);
    return romaji && [romaji, ...suffixes].join(' ');
  }

  return async function romanize(name, kana) {
    // Seule la partie japonaise est transcrite : « 平石神社 (Hiraishi Shrine) » → 平石神社.
    const japanese = name.replace(/\s*[(（][^)）]*[)）]/g, '').trim();
    if (!JAPANESE.test(japanese)) return '';
    const parts = japanese.split(/[\s\u3000]+/).filter((p) => JAPANESE.test(p));
    const kanaParts = kana ? kana.split(/[\s\u3000]+/).filter(Boolean) : [];
    const useKana = kanaParts.length === parts.length && kanaParts.every((k) => !KANJI.test(k));
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const r = await part(parts[i], useKana ? kanaParts[i] : null);
      if (!r) return '';
      out.push(r);
    }
    return out.join(' ');
  };
}

module.exports = { createRomanizer };
