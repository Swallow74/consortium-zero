import { BUILDING_STYLES } from './data.js';

// Tema grafico di una missione: `"theme": "nome"` oppure `"theme": { "preset": "nome", ...override }`.
// Tutti i campi sono opzionali; quelli mancanti vengono dal preset (o da "citta").
export const DEFAULT_THEME = {
  styles: BUILDING_STYLES,          // 7 stili edificio: { wall, win:[3 colori], roof, neon }
  pave: '#2c3244', plaza: ['#3a4157', '#323850'],
  road: '#171a22', curb: '#3b425a', laneCenter: '#d6a92a', laneDash: 'rgba(210,220,235,0.6)',
  grass: '#183a2a', blade: [90, 170, 110],
  water: ['#0b3050', '#0a2640'], sea: ['#071a2c', '#0c2b45'], quay: ['#2a3246', '#38415a'], quayLine: 'rgba(150,190,235,0.5)',
  tree: ['#1d5a37', '#25704a', '#2f8a5a'], trunk: '#4a3322',
  ambient: null,                     // luce ambiente moltiplicata (CSS rgb): chiara = giorno, scura = notte
  weather: null,                     // clear | rain | fog (se la missione non lo indica)
};

const S = (wall, roof, neon, win) => ({ wall, roof, neon, win });

export const THEME_PRESETS = {
  citta: {},
  deserto: {
    styles: [
      S('#a8845a', '#c29a68', '#ffb04d', ['#ffe9b0', '#ffd27a', '#fff3d0']),
      S('#b99668', '#d1aa78', '#ff8a4d', ['#ffe9b0', '#ffd27a', '#7af0ff']),
      S('#8a6a48', '#a07e58', '#ffcf6b', ['#ffd27a', '#ff9a5a', '#ffe9b0']),
      S('#c4a27a', '#d8b88e', '#ff7a5a', ['#ffe9b0', '#fff3d0', '#ffd27a']),
      S('#7e5f44', '#96745a', '#ffb04d', ['#ffd27a', '#ffe9b0', '#ff9a5a']),
      S('#d0b690', '#e2caa4', '#4de0ff', ['#7af0ff', '#ffe9b0', '#ffffff']),
      S('#6a5038', '#7e6048', '#ff9a3d', ['#ff9a5a', '#ffd27a', '#ffe9b0']),
    ],
    pave: '#8a7456', plaza: ['#9c8662', '#92805c'], road: '#4a4440', curb: '#a08a66', laneCenter: '#e8d9a0',
    grass: '#7a6a3a', blade: [150, 140, 80], water: ['#2a6a80', '#1f5870'], sea: ['#c8a870', '#b89a64'], quay: ['#8a7456', '#9c8662'], quayLine: 'rgba(255,235,190,0.5)',
    tree: ['#6a7a3a', '#7e8e48', '#92a258'], trunk: '#6a4a2a', ambient: 'rgb(236,214,176)', weather: 'clear',
  },
  industriale: {
    styles: [
      S('#4a4f58', '#5a606a', '#ff9a3d', ['#ffd27a', '#ffb04d', '#ffe9b0']),
      S('#3a3f48', '#4a505a', '#ff6a3d', ['#ffb04d', '#ffd27a', '#ff9a5a']),
      S('#5a4a40', '#6a5a50', '#ffb04d', ['#ffd27a', '#ff9a5a', '#ffe9b0']),
      S('#34383f', '#444a52', '#ffd24d', ['#ffe9b0', '#ffd27a', '#ffffff']),
      S('#4a5048', '#5a6058', '#9aff5a', ['#d4ffa0', '#ffe9b0', '#ffd27a']),
      S('#5e6269', '#6e737a', '#ff9a3d', ['#ffe9b0', '#ffd27a', '#ffb04d']),
      S('#2a2d33', '#3a3e46', '#ff4a3d', ['#ff6a5a', '#ffb04d', '#ffd27a']),
    ],
    pave: '#3a3c40', plaza: ['#44464a', '#3c3e42'], road: '#1c1d20', curb: '#55585e', laneCenter: '#e0b020',
    grass: '#2a3224', blade: [100, 120, 80], water: ['#1f3a34', '#18302a'], sea: ['#10201e', '#1a3330'], quay: ['#34363a', '#44464a'], quayLine: 'rgba(255,170,90,0.45)',
    tree: ['#34452c', '#3e5434', '#4a623e'], trunk: '#3a2a1e', ambient: 'rgb(118,112,112)', weather: 'fog',
  },
  artico: {
    styles: [
      S('#7e8ea4', '#b4c4d8', '#7ad6ff', ['#e8f4ff', '#a8d8ff', '#ffe9b0']),
      S('#5a6e8a', '#9ab0c8', '#4de0ff', ['#bdf6ff', '#e8f4ff', '#ffe9b0']),
      S('#8a96a6', '#c4d0de', '#7ab8ff', ['#e8f4ff', '#ffe9b0', '#a8d8ff']),
      S('#4a5a74', '#8aa0ba', '#a08aff', ['#d4c4ff', '#bdf6ff', '#ffe9b0']),
      S('#6a8098', '#a8bcd0', '#4dffc4', ['#d4fff4', '#e8f4ff', '#ffe9b0']),
      S('#9aa8b8', '#d4dee8', '#7ad6ff', ['#ffffff', '#e8f4ff', '#a8d8ff']),
      S('#3a4660', '#6a7c98', '#ff7ad9', ['#ffc4f1', '#e8f4ff', '#bdf6ff']),
    ],
    pave: '#9aa8ba', plaza: ['#aab6c6', '#a0acbe'], road: '#3a4252', curb: '#c4d0de', laneCenter: '#e0a830', laneDash: 'rgba(240,248,255,0.7)',
    grass: '#c4d4e0', blade: [200, 220, 240], water: ['#1a4a6a', '#143a58'], sea: ['#0c2a44', '#143a5a'], quay: ['#8a98aa', '#aab6c6'], quayLine: 'rgba(220,240,255,0.6)',
    tree: ['#3a5a58', '#4a6e6a', '#5a8280'], trunk: '#4a3a2e', ambient: 'rgb(196,212,238)', weather: 'clear',
  },
  tossico: {
    styles: [
      S('#2e3a2a', '#3e4e38', '#9aff3d', ['#c8ff7a', '#ffe9b0', '#7affc4']),
      S('#243a34', '#34504a', '#3dffa0', ['#7affc4', '#d4fff4', '#ffe9b0']),
      S('#3a3a24', '#4e4e32', '#e0ff3d', ['#f0ff7a', '#ffe9b0', '#c8ff7a']),
      S('#2a2e38', '#3a4050', '#3dffd0', ['#7af0ff', '#9aff7a', '#ffe9b0']),
      S('#1e3a2a', '#2e4e3a', '#7aff3d', ['#a8ff7a', '#d4ffa0', '#ffe9b0']),
      S('#404a38', '#546048', '#c8ff3d', ['#e8ff9a', '#ffe9b0', '#ffffff']),
      S('#1a2620', '#2a3a30', '#ff3d8a', ['#ff7ab0', '#9aff7a', '#ffe9b0']),
    ],
    pave: '#2c3a30', plaza: ['#36463a', '#2e3e32'], road: '#141a16', curb: '#44584a', laneCenter: '#b8d62a',
    grass: '#2a4a1e', blade: [130, 220, 70], water: ['#1a5a3a', '#144a30'], sea: ['#0a2a1a', '#123a26'], quay: ['#26342a', '#364a3a'], quayLine: 'rgba(160,255,120,0.45)',
    tree: ['#4a6a1e', '#5e8426', '#74a030'], trunk: '#3a3a1e', ambient: 'rgb(98,138,106)', weather: 'fog',
  },
  tramonto: {
    styles: [
      S('#5a3a4a', '#7a4a5a', '#ff7a5a', ['#ffd27a', '#ff9a5a', '#ffe9b0']),
      S('#4a3a5a', '#6a4a7a', '#ff4fd8', ['#ffc4f1', '#ffd27a', '#ff9a8a']),
      S('#6a4036', '#8a5446', '#ffb04d', ['#ffd27a', '#ff9a5a', '#ffe9b0']),
      S('#3a2e50', '#54447a', '#ff7ad9', ['#ff9ae0', '#ffd27a', '#ffe9b0']),
      S('#2a4a5a', '#3a6478', '#4de0ff', ['#7af0ff', '#ffd27a', '#ffe9b0']),
      S('#7a5a6a', '#9a7080', '#ffcf6b', ['#ffe9b0', '#ffd27a', '#ffffff']),
      S('#2a1e38', '#3e3052', '#ff3b6b', ['#ff6a8a', '#ffb04d', '#ffd27a']),
    ],
    pave: '#4a3a4a', plaza: ['#5a4858', '#524050'], road: '#241c28', curb: '#6a5468', laneCenter: '#ffb04d',
    grass: '#34402a', blade: [150, 170, 90], water: ['#3a4a7a', '#2e3a66'], sea: ['#3a2a5a', '#7a4a6a'], quay: ['#4a3a4a', '#5a4858'], quayLine: 'rgba(255,190,140,0.55)',
    tree: ['#3a5a34', '#4a6e3e', '#5e8448'], trunk: '#4a2e22', ambient: 'rgb(214,160,150)', weather: 'clear',
  },
};

export function resolveTheme(def) {
  const t = def.theme;
  const name = typeof t === 'string' ? t : t?.preset || 'citta';
  const preset = THEME_PRESETS[name] || {};
  const over = typeof t === 'object' && t ? t : {};
  const th = { ...DEFAULT_THEME, ...preset, ...over };
  // stili edificio: l'override può essere parziale (indice per indice)
  const base = preset.styles || DEFAULT_THEME.styles;
  th.styles = base.map((s, i) => ({ ...s, ...(over.styles?.[i] || {}) }));
  if (over.styles && over.styles.length > th.styles.length) th.styles.push(...over.styles.slice(th.styles.length));
  th.name = name;
  return th;
}
