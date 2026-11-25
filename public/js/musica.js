// Músicas do Palhetada: tudo original e feito na hora pelo navegador (sem arquivo de áudio).
// Cada música tem uma "semente": a melodia sai sempre igual pra todo mundo, então
// todos os celulares da sala tocam exatamente as mesmas notas.
// A banda (bateria, baixo, acordes) toca sozinha; a melodia só soa quando você acerta a nota.

export const MUSICAS = [
  { id: 'laje', nome: 'Rock da Laje', emoji: '🎸', estilo: 'rock', desc: 'Rock pesado de churrasco', bpm: 128, tom: 40, semente: 7,
    escala: [0, 3, 5, 7, 10], acordes: [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']], cor: '#ff5f6d' },
  { id: 'forro', nome: 'Forró Elétrico', emoji: '🪗', estilo: 'forro', desc: 'Baião com sanfona ligada na tomada', bpm: 116, tom: 43, semente: 21,
    escala: [0, 2, 4, 5, 7, 9, 10], acordes: [[0, 'M'], [5, 'M'], [10, 'M'], [0, 'M']], cor: '#ffb800' },
  { id: 'neon', nome: 'Balada Neon', emoji: '🌃', estilo: 'neon', desc: 'Synthpop de anos 80, sem pressa', bpm: 100, tom: 45, semente: 33,
    escala: [0, 2, 4, 7, 9], acordes: [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']], cor: '#3ad1ff' },
  { id: 'padaria', nome: 'Metal de Padaria', emoji: '🤘', estilo: 'metal', desc: 'Rápido, pesado e às 6 da manhã', bpm: 152, tom: 38, semente: 66,
    escala: [0, 2, 3, 5, 7, 8, 10], acordes: [[0, 'm'], [8, 'M'], [10, 'M'], [7, 'm']], cor: '#b46bff' },
];
// músicas feitas no Suno pelo Lucas, com as faixas separadas (fundo + guitarra + bateria)
const SUNO = [
  { id: 'casquinha', pasta: 'faixas/blues/', nome: 'Blues da Casquinha', emoji: '🍦', cor: '#3aa0ff', desc: 'Blues sobre a casquinha que caiu no chão' },
  { id: 'chikorita', pasta: 'faixas/chiko/', nome: 'Chikorita na Garra', emoji: '🌿', cor: '#2fdc6b', desc: 'Metal árabe + dubstep: a saga da máquina de garra' },
  { id: 'dracula', pasta: 'faixas/dracula/', nome: 'Drácula, o Morceguinho', emoji: '🦇', cor: '#b46bff', desc: 'O morcego que invadiu a festa de Halloween' },
  { id: 'arretado', pasta: 'faixas/forro/', nome: 'Forró Arretado', emoji: '🪗', cor: '#ffb800', desc: 'Sanfona endiabrada. No difícil, é difícil MESMO' },
];
MUSICAS.unshift(...SUNO.map(s => ({ ...s, estilo: 'audio', arquivo: { pasta: s.pasta } })));
export const musicaPorId = id => MUSICAS.find(m => m.id === id) || MUSICAS[0];

// ---------- músicas de arquivo (custom songs convertidas) ----------
// Ficam FORA do repositório público. A lista vem de musicas/lista.json (só na prévia de teste)
// e, mais pra frente, da parte trancada por senha do Firebase.
const cache = {};
export async function carregarLista(base = 'musicas/') {
  try {
    const r = await fetch(base + 'lista.json', { cache: 'no-cache' });
    if (!r.ok) return [];
    const lista = await r.json();
    for (const m of lista) {
      if (MUSICAS.some(x => x.id === m.id)) continue;
      MUSICAS.push({ ...m, estilo: 'audio', capa: m.capa ? base + m.capa : null, arquivo: { mapa: base + m.mapa, audio: base + m.audio } });
    }
    return lista;
  } catch { return []; }
}
export const carregada = m => !m.arquivo || !!(cache[m.id] && cache[m.id].buffer);
export function carregar(ac, m, aoAvancar) {
  if (!m.arquivo) return Promise.resolve();
  if (!cache[m.id]) cache[m.id] = (async () => {
    if (m.arquivo.pasta) {   // faixas separadas: mapa + 3 áudios
      const P = m.arquivo.pasta, nomes = ['fundo', 'guitarra', 'bateria'];
      let prontos = 0;
      const baixar = n => fetch(P + n + '.mp3').then(r => { if (!r.ok) throw new Error(n); return r.arrayBuffer(); })
        .then(b => new Promise((ok, erro) => ac.decodeAudioData(b, ok, erro)))
        .then(buf => { prontos++; if (aoAvancar) aoAvancar(prontos / nomes.length); return buf; });
      const [mapa, ...bufs] = await Promise.all([fetch(P + 'mapa.json').then(r => { if (!r.ok) throw new Error('mapa'); return r.json(); }), ...nomes.map(baixar)]);
      const buffers = {}; nomes.forEach((n, i) => { buffers[n] = bufs[i]; });
      cache[m.id] = { mapa, buffer: buffers.fundo, buffers };
      return cache[m.id];
    }
    let mapa, bytes;
    if (m.arquivo.extra) ({ mapa, bytes } = await (await import('./extras.js')).obter(m, aoAvancar));   // trancada pela senha (Firebase)
    else [mapa, bytes] = await Promise.all([
      fetch(m.arquivo.mapa).then(r => { if (!r.ok) throw new Error('mapa'); return r.json(); }),
      fetch(m.arquivo.audio).then(r => { if (!r.ok) throw new Error('áudio'); return r.arrayBuffer(); }),
    ]);
    const buffer = await new Promise((ok, erro) => ac.decodeAudioData(bytes, ok, erro));
    cache[m.id] = { mapa, buffer };
    return cache[m.id];
  })().catch(e => { delete cache[m.id]; throw e; });
  return Promise.resolve(cache[m.id]);
}

// I = entrada (só banda), F = final. * = frase de energia ⚡ (acerte todas as notas dela)
const ROTEIRO = ['I', 'A', 'B', 'A2*', 'B', 'C*', 'A2', 'B*', 'F'];
const COMPASSOS = { I: 2, F: 2 }; // as outras frases têm 4 compassos
export const OITAVOS = 8;          // cada compasso tem 8 "casinhas" (colcheias)

function aleatorio(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const escolhe = (r, l) => l[Math.floor(r() * l.length)];

// ritmos de um compasso (1 = nota)
const RITMOS = {
  leve: ['10001000', '10100000', '10001010', '10000010', '10101000'],
  medio: ['10101010', '10010010', '10101100', '10110010', '10011010', '11001010'],
  denso: ['11101010', '10111010', '11011011', '10101111', '11101110', '11111010'],
  fecha: ['10101000', '10001000', '10100000', '11001000'],
};

// a melodia de uma frase de 4 compassos: lista de { casa (0..31), grau }
function motivo(r, m, denso, ultimoGrau = 4) {
  const notas = [];
  const nEsc = m.escala.length;
  let g = ultimoGrau;
  for (let c = 0; c < 4; c++) {
    const rit = c === 3 ? escolhe(r, RITMOS.fecha) : escolhe(r, denso ? RITMOS.denso : (r() < 0.45 ? RITMOS.denso : r() < 0.85 ? RITMOS.medio : RITMOS.leve));
    const [raizAc, tipo] = m.acordes[c % m.acordes.length];
    const doAcorde = [raizAc, raizAc + (tipo === 'm' ? 3 : 4), raizAc + 7].map(x => ((x % 12) + 12) % 12);
    for (let s = 0; s < 8; s++) {
      if (rit[s] !== '1') continue;
      if (s === 0 || s === 4) {
        // tempo forte: vai pra nota do acorde mais perto
        let melhor = g, dist = 99;
        for (let k = Math.max(0, g - 4); k <= Math.min(nEsc * 2, g + 4); k++) {
          const pc = (m.escala[k % nEsc] + 12) % 12;
          if (doAcorde.includes(pc) && Math.abs(k - g) < dist + (r() < 0.3 ? 1 : 0)) { melhor = k; dist = Math.abs(k - g); }
        }
        g = melhor;
      } else {
        const passo = escolhe(r, [-2, -1, -1, 1, 1, 2, 0, 3, -3]);
        g = Math.max(0, Math.min(nEsc * 2, g + passo));
      }
      notas.push({ casa: c * 8 + s, grau: g });
    }
  }
  return notas;
}

// monta a música inteira: tempo de cada nota, altura, duração, frase
export function compor(m) {
  const r = aleatorio(m.semente * 7919 + 13);
  const A = motivo(r, m, false);
  const B = motivo(r, m, false, 6);
  const C = motivo(r, m, true, 5);
  // A2 = A com o último compasso diferente
  const A2 = [...A.filter(n => n.casa < 24), ...motivo(r, m, false, A[A.length - 1].grau).filter(n => n.casa >= 24)];
  const frases = { A, B, C, A2 };
  const oitavo = 60 / m.bpm / 2;
  const notas = [];
  let compasso = 0, fraseN = 0;
  const secoes = [];
  for (const sec of ROTEIRO) {
    const nome = sec.replace('*', ''), estrela = sec.endsWith('*');
    const tam = COMPASSOS[nome] || 4;
    secoes.push({ nome, compasso, tam, estrela });
    if (frases[nome]) {
      const lista = frases[nome];
      lista.forEach((n, i) => {
        const prox = i + 1 < lista.length ? lista[i + 1].casa : 32;
        notas.push({ casa: compasso * 8 + n.casa, grau: n.grau, vaga: prox - n.casa, frase: fraseN, estrela });
      });
      fraseN++;
    } else if (nome === 'F') {
      // final: uma nota longa na tônica
      notas.push({ casa: compasso * 8, grau: m.escala.length, vaga: 12, frase: fraseN++, estrela: false, final: true });
    }
    compasso += tam;
  }
  const midi = g => m.tom + 24 + Math.floor(g / m.escala.length) * 12 + m.escala[g % m.escala.length];
  return {
    oitavo, compassos: compasso, duracao: compasso * 8 * oitavo, secoes,
    notas: notas.map(n => ({ ...n, t: n.casa * oitavo, midi: midi(n.grau) })),
  };
}

// ---------- troca de instrumento ----------
export const INSTRUMENTOS = { guitarra: { nome: 'Guitarra', emoji: '🎸' }, bateria: { nome: 'Bateria', emoji: '🥁' }, teclado: { nome: 'Teclado', emoji: '🎹' }, sabre: { nome: 'Sabre', emoji: '⚔️' } };
export const INSTR_PADRAO = { troca: false, guitarra: true, bateria: true, teclado: true, sabre: true };
export function ligados(op) {
  if (!op || !op.troca) return ['guitarra'];
  const l = Object.keys(INSTRUMENTOS).filter(i => op[i] !== false);
  return l.length ? l : ['guitarra'];
}
// cada parte da música tem um instrumento "natural"; se ele estiver desligado, entra outro
function instrumentoDaParte(nome, op) {
  const pref = { A: 'guitarra', B: 'bateria', A2: 'teclado', C: 'guitarra', F: 'guitarra' }[nome];
  if (!pref) return null;   // entrada: só a banda
  const L = ligados(op).filter(i => i !== 'sabre');   // as músicas sintetizadas não têm caixinhas
  if (!L.length) return 'guitarra';
  if (L.includes(pref)) return pref;
  const alternativa = { guitarra: ['teclado', 'bateria'], bateria: ['guitarra', 'teclado'], teclado: ['guitarra', 'bateria'] }[pref];
  return alternativa.find(i => L.includes(i)) || L[0];
}
// padrões de bateria de cada estilo (8 colcheias por compasso): bumbo, caixa, chimbal
export const BATERIA = {
  rock: { k: '10001100', sn: '00100010', h: '11111111' },
  forro: { k: '10010010', sn: '00000010', h: '11111111' },
  neon: { k: '10101010', sn: '00100010', h: '01010101' },
  metal: { k: '11111111', sn: '00100010', h: '10101010' },
};
export const PECAS = ['bumbo', 'caixa', 'chimbal', 'prato'];   // trilha 0..3 na bateria
function notasBateria(m, comp, sec, dif, frase) {
  const pad = BATERIA[m.estilo], o = comp.oitavo, out = [];
  for (let c = sec.compasso; c < sec.compasso + sec.tam; c++) {
    for (let x = 0; x < 8; x++) {
      const t = (c * 8 + x) * o, aqui = [];
      const prato = x === 0 && (c - sec.compasso) % 4 === 0;
      if (prato) aqui.push(3);
      if (pad.sn[x] === '1') aqui.push(1);
      if (pad.k[x] === '1' && (dif === 'dificil' || (dif === 'medio' ? x % 2 === 0 : x % 4 === 0))) aqui.push(0);
      if (pad.h[x] === '1' && !prato && (dif === 'dificil' || (dif === 'medio' && x % 2 === 0))) aqui.push(2);
      let fica = [...new Set(aqui)];
      if (dif === 'facil') fica = fica.slice(0, 1);       // fácil: uma peça por vez
      else fica = fica.slice(0, 2);                      // nunca mais que dois dedos
      for (const tr of fica) out.push({ t, trilha: tr, dur: 0, midi: 0, instr: 'bateria', peca: PECAS[tr], frase, estrela: !!sec.estrela, acorde: fica.length > 1 });
    }
  }
  return out;
}
function notasTeclado(m, comp, sec, dif, frase) {
  const o = comp.oitavo, out = [];
  const padroes = { dificil: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 2], [5, 1], [6, 2], [7, 3]], medio: [[0, 0], [2, 2], [4, 1], [6, 3]], facil: [[0, 0], [4, 2]] }[dif];
  for (let c = sec.compasso; c < sec.compasso + sec.tam; c++) {
    const [raizAc, tipo] = m.acordes[(c - sec.compasso) % m.acordes.length];
    const r = m.tom + 24 + raizAc, tons = [r, r + (tipo === 'm' ? 3 : 4), r + 7, r + 12];   // as 4 teclas = notas do acorde
    const ultimo = c === sec.compasso + sec.tam - 1;
    for (const [x, tr] of padroes) {
      if (ultimo && x > 4) continue;
      const dur = dif === 'facil' ? o * 2.6 : (ultimo && x === 4) ? o * 3 : 0;
      out.push({ t: (c * 8 + x) * o, trilha: tr, dur, midi: tons[tr], instr: 'teclado', frase, estrela: !!sec.estrela });
    }
  }
  return out;
}

// músicas com faixas separadas: cada parte tem um instrumento (guitarra, bateria ou caixinhas do sabre)
function partituraFaixas(mapa, dif, op) {
  const L = ligados(op).filter(i => i !== 'teclado');
  const troca = !!(op && op.troca);
  const ALT = { guitarra: ['bateria', 'sabre'], bateria: ['guitarra', 'sabre'], sabre: ['guitarra', 'bateria'] };
  const qual = i => L.includes(i) ? i : (ALT[i].find(x => L.includes(x)) || 'guitarra');
  const partes = troca ? mapa.partes : [{ t: 0, instr: 'guitarra' }];
  const trocas = [];
  partes.forEach(p => { const i = qual(p.instr); if (!trocas.length || trocas[trocas.length - 1].instr !== i) trocas.push({ t: p.t, instr: i }); });
  trocas[0].t = 0;
  const N = mapa.notas[dif], bat = mapa.batidas, notas = [];
  trocas.forEach((p, k) => {
    const fimParte = k + 1 < trocas.length ? trocas[k + 1].t : Infinity;
    for (const n of N[p.instr]) {
      if (n.t < p.t || n.t >= fimParte) continue;
      if (p.instr === 'sabre') notas.push({ t: n.t, lado: n.lado, dir: n.dir, col: n.col, row: n.row, trilha: -1, dur: 0, fim: n.t, instr: 'sabre' });
      else {
        const dur = n.dur > 0 ? Math.max(0, Math.min(n.dur, fimParte - n.t - 0.15)) : 0;
        notas.push({ t: n.t, trilha: n.trilha, dur: dur > 0.25 ? dur : 0, fim: n.t + (dur > 0.25 ? dur : 0), midi: 0, peca: n.peca, instr: p.instr });
      }
    }
  });
  notas.sort((a, b) => a.t - b.t || a.trilha - b.trilha);
  // frases de energia ⚡: blocos de 16 batidas; 1 em cada 4 vale energia
  const fraseDe = t => Math.floor(Math.max(0, bisecaArr(bat, t) - 1) / 16);
  notas.forEach((n, i) => { n.id = i; n.frase = fraseDe(n.t); n.estrela = n.frase % 4 === 2; });
  const passos = bat.slice(1).map((b, i) => b - bat[i]).sort((a, b) => a - b);
  const oitavo = (passos[passos.length >> 1] || 0.5) / 2;
  const nomes = mapa.nomeGuitarra && mapa.nomeGuitarra !== 'Guitarra' ? { guitarra: { nome: mapa.nomeGuitarra, emoji: '🪗' } } : null;
  return { oitavo, duracao: mapa.duracao, batidas: bat, notas, trocas, nomes };
}
function bisecaArr(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }

// a "partitura" de cada dificuldade: quais notas ficam, em que trilha (0 a 3) e quanto duram
export const DIFS = {
  facil: { nome: 'Fácil', emoji: '🙂', janela: 1.9 },
  medio: { nome: 'Médio', emoji: '😎', janela: 1.5 },
  dificil: { nome: 'Difícil', emoji: '🔥', janela: 1.2 },
};
export function partitura(m, dif, op = null) {
  if (m.arquivo) {
    const { mapa } = cache[m.id];
    if (mapa.v === 2) return partituraFaixas(mapa, dif, op);
    // custom song antiga: só guitarra
    const notas = mapa.notas[dif].map((n, i) => ({ ...n, id: i, midi: 0, fim: n.t + n.dur, instr: 'guitarra' }));
    const bat = mapa.batidas;
    return { oitavo: (bat[1] - bat[0]) / 2, duracao: mapa.duracao, batidas: bat, notas, trocas: [{ t: 0, instr: 'guitarra' }] };
  }
  const comp = compor(m);
  comp.secoes.forEach(sec => { sec.instr = instrumentoDaParte(sec.nome, op); sec.t0 = sec.compasso * 8 * comp.oitavo; });
  const secDaCasa = casa => { const c = Math.floor(casa / 8); return comp.secoes.find(x => c >= x.compasso && c < x.compasso + x.tam) || comp.secoes[comp.secoes.length - 1]; };
  let lista = comp.notas.filter(n => {
    const s = n.casa % 8;
    if (dif === 'facil') return s === 0 || s === 4 || n.final;
    if (dif === 'medio') return s % 2 === 0 || n.final;
    return true;
  });
  // recalcula o espaço até a próxima nota que sobrou
  lista = lista.map((n, i) => ({ ...n, vaga: n.final ? 12 : Math.min(8, (lista[i + 1] ? lista[i + 1].casa : n.casa + 8) - n.casa) }));
  // trilha: segue o desenho da melodia (sobe = vai pra direita) sem fugir muito da altura real
  // "altura" de cada nota em quartos: assim as 4 trilhas são usadas por igual
  const graus = lista.map(n => n.grau);
  const absoluta = g => {
    const menores = graus.filter(x => x < g).length, iguais = graus.filter(x => x === g).length;
    return Math.max(0, Math.min(3, Math.floor((menores + iguais / 2) / graus.length * 4)));
  };
  let trilha = absoluta(lista[0].grau), ant = lista[0].grau;
  const notas = [];
  lista.forEach((n, i) => {
    if (i > 0) {
      const d = n.grau - ant;
      if (d > 0) trilha += d > 2 ? 2 : 1; else if (d < 0) trilha -= d < -2 ? 2 : 1;
      const alvo = absoluta(n.grau);
      if (trilha - alvo > 1) trilha--; else if (alvo - trilha > 1) trilha++;
      trilha = Math.max(0, Math.min(3, trilha));
    }
    ant = n.grau;
    // nota longa quando sobra espaço depois dela
    const minimo = { facil: 6, medio: 5, dificil: 4 }[dif];
    const longa = n.vaga >= minimo ? (n.vaga - (dif === 'facil' ? 2 : 1.5)) * comp.oitavo : 0;
    const base = { t: n.t, midi: n.midi, dur: longa, frase: n.frase, estrela: n.estrela, instr: 'guitarra' };
    if (secDaCasa(n.casa).instr !== 'guitarra') return;   // essa parte é de outro instrumento
    notas.push({ ...base, trilha });
    // difícil: acordes (dois dedos) nos tempos fortes de compasso par
    const compasso = Math.floor(n.casa / 8);
    if (dif === 'dificil' && n.casa % 8 === 0 && compasso % 2 === 0 && n.vaga >= 2) {
      const outra = trilha <= 1 ? trilha + 2 : trilha - 2;
      notas.push({ ...base, trilha: outra, midi: n.midi + 7, acorde: true });
    }
  });
  // partes de bateria e de teclado
  comp.secoes.forEach((sec, i) => {
    if (sec.instr === 'bateria') notas.push(...notasBateria(m, comp, sec, dif, 1000 + i));
    if (sec.instr === 'teclado') notas.push(...notasTeclado(m, comp, sec, dif, 1000 + i));
  });
  notas.sort((a, b) => a.t - b.t || a.trilha - b.trilha);
  notas.forEach((n, i) => { n.id = i; n.fim = n.t + n.dur; });
  // quando a guitarra não é do jogador, a banda toca a melodia sozinha
  const melodiaAuto = {};
  comp.notas.forEach(n => { if (secDaCasa(n.casa).instr && secDaCasa(n.casa).instr !== 'guitarra') melodiaAuto[n.casa] = { midi: n.midi, dur: Math.max(1, Math.min(n.vaga, 4)) * comp.oitavo * 0.9 }; });
  // pontos onde o instrumento muda (a entrada usa o instrumento da primeira parte)
  const trocas = [];
  comp.secoes.forEach(sec => { const ins = sec.instr || (comp.secoes.find(x => x.instr) || {}).instr || 'guitarra'; if (!trocas.length || trocas[trocas.length - 1].instr !== ins) trocas.push({ t: sec.t0, instr: ins }); });
  return { ...comp, notas, melodiaAuto, trocas };
}

// ======================= som =======================
let ruido = null;
function bufRuido(ac) {
  if (ruido && ruido.sampleRate === ac.sampleRate) return ruido;
  ruido = ac.createBuffer(1, ac.sampleRate * 1.2, ac.sampleRate);
  const d = ruido.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ruido;
}
let curvaDist = null;
function distorcao(k = 18) {
  if (curvaDist) return curvaDist;
  const n = 1024; curvaDist = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curvaDist[i] = Math.tanh(k * x) / Math.tanh(k); }
  return curvaDist;
}
const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

export class Banda {
  constructor(ac, m, comp, t0) {
    this.ac = ac; this.m = m; this.comp = comp; this.t0 = t0; this.casa = 0;
    this.saida = ac.createGain(); this.saida.gain.value = 0.9;
    // compressor pra nada estourar
    const comp2 = ac.createDynamicsCompressor(); comp2.threshold.value = -14; comp2.ratio.value = 4;
    this.saida.connect(comp2).connect(ac.destination);
    this.lead = ac.createGain(); this.lead.gain.value = 1; this.lead.connect(this.saida);
    // pula o que já passou (quem entrou atrasado começa do meio)
    this.casa = Math.max(0, Math.floor((ac.currentTime - t0) / comp.oitavo));
    this.timer = setInterval(() => this.agendar(), 30);
    this.agendar();
  }
  parar() {
    clearInterval(this.timer);
    try { this.saida.gain.setTargetAtTime(0, this.ac.currentTime, 0.08); } catch {}
    setTimeout(() => { try { this.saida.disconnect(); } catch {} }, 600);
  }
  agendar() {
    const { ac, comp } = this;
    const total = comp.compassos * 8;
    while (this.casa < total + 1 && this.t0 + this.casa * comp.oitavo < ac.currentTime + 0.25) {
      const t = this.t0 + this.casa * comp.oitavo;
      if (t >= ac.currentTime - 0.01) this.tocarCasa(this.casa, t);
      this.casa++;
    }
  }
  tocarCasa(casa, t) {
    const { m, comp } = this;
    const s = casa % 8, compasso = Math.floor(casa / 8);
    const sec = comp.secoes.find(x => compasso >= x.compasso && compasso < x.compasso + x.tam) || comp.secoes[comp.secoes.length - 1];
    const ultimo = compasso >= comp.compassos;
    if (ultimo) { if (s === 0) { this.prato(t, 2); this.bumbo(t); } return; }
    const fim = sec.nome === 'F';
    const ac0 = m.acordes[(compasso - (sec.nome === 'I' ? 0 : sec.compasso)) % m.acordes.length];
    const raiz = m.tom + ac0[0];
    // entrada: contagem nas baquetas no 1º compasso
    if (sec.nome === 'I' && compasso === 0) { if (s % 2 === 0) this.baqueta(t, s === 0 ? 1.4 : 1); return; }
    if (fim) {
      if (casa === sec.compasso * 8) { this.prato(t, 2.4); this.bumbo(t); this.acorde(raiz, ac0[1], t, this.comp.oitavo * 14); this.baixo(raiz, t, this.comp.oitavo * 14); }
      return;
    }
    if (s === 0 && sec.compasso === compasso && sec.nome !== 'I' && sec.instr !== 'bateria') this.prato(t, 1.2);
    const E = m.estilo, ins = sec.instr;
    const auto = comp.melodiaAuto && comp.melodiaAuto[casa];
    if (auto) this.leadAuto(auto.midi, t, auto.dur);
    // bateria (quando a bateria é do jogador, a banda não toca)
    const pad = BATERIA[E];
    if (ins === 'bateria') { /* jogador toca */ } else {
    if (pad.k[s] === '1') this.bumbo(t, E === 'metal' ? 0.7 : 1);
    if (pad.sn[s] === '1') this.caixa(t, E === 'forro' ? 0.6 : 1);
    if (pad.h[s] === '1') this.chimbal(t, E === 'forro' ? (s % 2 ? 0.5 : 1) : (s % 2 ? 0.6 : 0.9), E === 'forro');
    }
    // baixo
    const bx = { rock: '11111111', forro: '10010010', neon: '01110111', metal: '11111111' }[E];
    if (bx[s] === '1') this.baixo(raiz + (E === 'forro' && s === 3 ? 7 : 0), t, this.comp.oitavo * (E === 'forro' ? 1.6 : 0.85));
    // acordes (quando o teclado é do jogador, a banda segura só um fundo bem baixinho)
    if (ins === 'teclado') { if (s === 0) this.acorde(raiz, ac0[1], t, this.comp.oitavo * 7.6, 0.35); }
    else if (E === 'rock' || E === 'metal') { if (s === 0 || s === 4) this.acorde(raiz, '5', t, this.comp.oitavo * 3.6); }
    else if (E === 'forro') { if (s === 2 || s === 3 || s === 6) this.acorde(raiz, ac0[1], t, this.comp.oitavo * 0.7); }
    else if (s === 0) this.acorde(raiz, ac0[1], t, this.comp.oitavo * 7.6);
  }
  env(g, t, pico, ataque, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pico, t + ataque); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  bumbo(t, v = 1) {
    const { ac } = this, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.9 * v, 0.003, 0.22); o.connect(g).connect(this.saida); o.start(t); o.stop(t + 0.25);
  }
  ruido(t, dur, filtro, freq, vol, q = 0.8) {
    const { ac } = this, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = bufRuido(ac); f.type = filtro; f.frequency.value = freq; f.Q.value = q;
    this.env(g, t, vol, 0.002, dur); s.connect(f).connect(g).connect(this.saida); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  caixa(t, v = 1) {
    this.ruido(t, 0.16, 'bandpass', 1800, 0.45 * v, 0.6);
    const { ac } = this, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    this.env(g, t, 0.25 * v, 0.002, 0.1); o.connect(g).connect(this.saida); o.start(t); o.stop(t + 0.12);
  }
  chimbal(t, v = 1, triangulo = false) {
    if (triangulo) { // triângulo do forró
      const { ac } = this, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = 3200; this.env(g, t, 0.05 * v, 0.002, 0.12); o.connect(g).connect(this.saida); o.start(t); o.stop(t + 0.15);
      return;
    }
    this.ruido(t, 0.045, 'highpass', 7500, 0.16 * v);
  }
  prato(t, dur = 1.2) { this.ruido(t, dur, 'highpass', 5200, 0.22); }
  baqueta(t, v = 1) { this.ruido(t, 0.04, 'bandpass', 3000, 0.4 * v, 3); }
  baixo(midi, t, dur) {
    const { ac } = this, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = this.m.estilo === 'neon' ? 'sawtooth' : 'triangle'; o.frequency.value = hz(midi - 12 + (this.m.estilo === 'neon' ? 12 : 0));
    f.type = 'lowpass'; f.frequency.value = this.m.estilo === 'neon' ? 700 : 900;
    this.env(g, t, this.m.estilo === 'neon' ? 0.22 : 0.42, 0.006, dur); o.connect(f).connect(g).connect(this.saida); o.start(t); o.stop(t + dur + 0.05);
  }
  acorde(raiz, tipo, t, dur, vol = 1) {
    const { ac } = this, E = this.m.estilo;
    const iv = tipo === '5' ? [0, 7, 12] : tipo === 'm' ? [0, 3, 7] : [0, 4, 7];
    const g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = E === 'neon' ? 1400 : 2000;
    let fim = g;
    if (E === 'rock' || E === 'metal') {
      const d = ac.createWaveShaper(); d.curve = distorcao(); g.connect(d); fim = d;
      this.env(g, t, 0.16 * vol, 0.005, dur);
    } else if (E === 'neon') this.env(g, t, 0.07 * vol, 0.25, dur);
    else this.env(g, t, 0.06 * vol, 0.01, dur);
    const pos = ac.createGain(); pos.gain.value = E === 'rock' || E === 'metal' ? 0.11 : 1;
    fim.connect(f).connect(pos).connect(this.saida);
    iv.forEach((x, i) => {
      const o = ac.createOscillator();
      o.type = E === 'neon' ? 'sawtooth' : E === 'forro' ? 'square' : 'sawtooth';
      o.frequency.value = hz(raiz + 12 + x); o.detune.value = (i - 1) * 6;
      o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  // a nota que VOCÊ toca. Devolve uma função pra soltar (nota longa)
  solo(midi, dur = 0.28) {
    const { ac } = this, t = ac.currentTime, E = this.m.estilo;
    const g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = E === 'forro' ? 2400 : E === 'neon' ? 3200 : 2800; f.Q.value = 2;
    let ent = g;
    const oscs = [];
    if (E === 'rock' || E === 'metal') {
      const pre = ac.createGain(); pre.gain.value = 1; const d = ac.createWaveShaper(); d.curve = distorcao();
      pre.connect(d).connect(g); ent = pre;
    }
    const tipos = E === 'forro' ? ['square', 'sawtooth'] : E === 'neon' ? ['square', 'sawtooth'] : ['sawtooth', 'sawtooth'];
    tipos.forEach((tp, i) => {
      const o = ac.createOscillator(); o.type = tp; o.frequency.value = hz(midi); o.detune.value = i ? 9 : -9;
      if (E !== 'forro') { // vibrato leve nas notas longas
        const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.5; lg.gain.value = dur > 0.4 ? 10 : 0;
        lfo.connect(lg).connect(o.detune); lfo.start(t); oscs.push(lfo);
      }
      o.connect(ent); o.start(t); oscs.push(o);
    });
    const vol = E === 'rock' || E === 'metal' ? 0.12 : 0.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.15);
    g.connect(f).connect(this.lead);
    let solto = false;
    const soltar = () => {
      if (solto) return; solto = true;
      const a = ac.currentTime; g.gain.cancelScheduledValues(a); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), a); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.12);
      oscs.forEach(o => o.stop(a + 0.15));
    };
    if (dur <= 0.4) setTimeout(soltar, dur * 1000);
    else setTimeout(soltar, (dur + 0.2) * 1000); // segurança
    return soltar;
  }
  // a melodia tocada pela banda (quando o jogador está na bateria ou no teclado)
  leadAuto(midi, t, dur) {
    const { ac } = this, g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2200;
    const o = ac.createOscillator(); o.type = this.m.estilo === 'forro' ? 'square' : 'sawtooth'; o.frequency.value = hz(midi);
    this.env(g, t, 0.045, 0.01, Math.max(0.15, dur));
    o.connect(f).connect(g).connect(this.saida); o.start(t); o.stop(t + dur + 0.1);
  }
  // o jogador acertou uma peça da bateria
  tambor(peca) {
    const t = this.ac.currentTime;
    if (peca === 'bumbo') this.bumbo(t, 1.3);
    else if (peca === 'caixa') this.caixa(t, 1.3);
    else if (peca === 'chimbal') this.chimbal(t, 1.4);
    else this.prato(t, 1.4);
    return () => {};
  }
  // o jogador acertou uma tecla
  piano(midi, dur = 0.6) {
    const { ac } = this, t = ac.currentTime, g = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(1200, t + 0.6);
    const oscs = [['triangle', 0, 1], ['sine', 12, 0.35], ['sine', 19, 0.12]].map(([tp, st, v]) => {
      const o = ac.createOscillator(), gg = ac.createGain(); o.type = tp; o.frequency.value = hz(midi + st); gg.gain.value = v;
      o.connect(gg).connect(f); o.start(t); return o;
    });
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.006); g.gain.exponentialRampToValueAtTime(0.07, t + 0.35);
    f.connect(g).connect(this.lead);
    let solto = false;
    const soltar = () => { if (solto) return; solto = true; const a = ac.currentTime; g.gain.cancelScheduledValues(a); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), a); g.gain.exponentialRampToValueAtTime(0.0001, a + 0.25); oscs.forEach(o => o.stop(a + 0.3)); };
    setTimeout(soltar, Math.max(0.5, dur) * 1000);
    return soltar;
  }
  errou() { // corda abafada
    const t = this.ac.currentTime;
    this.ruido(t, 0.09, 'bandpass', 420, 0.35, 4);
  }
}

// banda de "arquivo": a música inteira já gravada (custom song). Só toca o áudio no horário certo.
export class BandaAudio {
  constructor(ac, m, comp, t0) {
    this.ac = ac;
    this.saida = ac.createGain(); this.saida.gain.value = 1; this.saida.connect(ac.destination);
    this.fonte = ac.createBufferSource(); this.fonte.buffer = cache[m.id].buffer; this.fonte.connect(this.saida);
    const agora = ac.currentTime;
    // quem entrou atrasado começa do meio da música
    if (t0 >= agora) this.fonte.start(t0); else this.fonte.start(agora, agora - t0);
  }
  parar() {
    try { this.saida.gain.setTargetAtTime(0, this.ac.currentTime, 0.1); this.fonte.stop(this.ac.currentTime + 0.6); } catch {}
  }
  solo() { return () => {}; } // a guitarra já está na gravação
  tambor() { return () => {}; }
  piano() { return () => {}; }
  errou() {
    const ac = this.ac, t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = bufRuido(ac); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 4;
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + 0.1);
  }
}

// banda com as faixas separadas: fundo + guitarra + bateria tocando juntas.
// Errou a nota? A faixa do seu instrumento quase some até você acertar de novo.
export class BandaFaixas {
  constructor(ac, m, comp, t0) {
    this.ac = ac;
    const c = cache[m.id];
    this.saida = ac.createGain(); this.saida.gain.value = 1; this.saida.connect(ac.destination);
    this.g = {}; this.fontes = [];
    const agora = ac.currentTime;
    for (const k of ['fundo', 'guitarra', 'bateria']) {
      const gn = ac.createGain(); gn.gain.value = 1; gn.connect(this.saida);
      const s = ac.createBufferSource(); s.buffer = c.buffers[k]; s.connect(gn);
      if (t0 >= agora) s.start(t0); else s.start(agora, agora - t0);   // quem entrou atrasado começa do meio
      this.g[k] = gn; this.fontes.push(s);
    }
  }
  parar() {
    const t = this.ac.currentTime;
    try { this.saida.gain.setTargetAtTime(0, t, 0.1); this.fontes.forEach(s => s.stop(t + 0.6)); } catch {}
  }
  volta(k) { if (this.g[k]) this.g[k].gain.setTargetAtTime(1, this.ac.currentTime, 0.015); }
  abafa(k) { if (this.g[k]) this.g[k].gain.setTargetAtTime(0.1, this.ac.currentTime, 0.04); }
  solo() { this.volta('guitarra'); return () => {}; }
  tambor() { this.volta('bateria'); return () => {}; }
  piano() { return () => {}; }
  corte(lado) {   // "vush" do sabre
    const ac = this.ac, t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = bufRuido(ac); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(lado ? 2600 : 1800, t); f.frequency.exponentialRampToValueAtTime(lado ? 700 : 500, t + 0.16);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + 0.2);
  }
  falhou(instr) { this.abafa(instr); }
  errou(instr) {
    const ac = this.ac, t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = bufRuido(ac); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 4;
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(f).connect(g).connect(ac.destination); s.start(t); s.stop(t + 0.1);
    if (instr) this.abafa(instr);
  }
}

// bipes do menu e da calibração
export function bipe(ac, f = 880, dur = 0.06, vol = 0.15, quando = 0) {
  const t = quando || ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle'; o.frequency.value = f;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
