// Palhetada: jogo de ritmo estilo "guitarra de plástico", feito pro celular.
// As notas descem por 4 trilhas; tocar no tempo certo faz a guitarra soar.
// Multiplayer: todo mundo da sala toca a MESMA música ao mesmo tempo (horário do servidor),
// cada um na sua dificuldade, e os pontos vão aparecendo ao vivo pros outros.
import * as rede from './rede.js';
import { MUSICAS, musicaPorId, DIFS, partitura, Banda, BandaAudio, BandaFaixas, bipe, carregarLista, carregar, carregada, INSTRUMENTOS, INSTR_PADRAO, ligados } from './musica.js';
import * as extras from './extras.js';

// a prévia (fora do site do jogo) não consegue falar com o servidor: só sozinho
const PREVIA = !rede.LOCAL && !/(^|\.)github\.io$|^localhost$|^127\./.test(location.hostname);
const PARAMS = new URLSearchParams(location.search);
const ROBO = rede.LOCAL && PARAMS.has('robo'); // teste: toca sozinho
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CORES = ['#2fdc6b', '#ff4d5e', '#ffd23f', '#3aa0ff'];
const ESCURAS = ['#138a3f', '#b3202f', '#c79a00', '#1660b3'];
const JANELA = 0.135, PERFEITO = 0.05, OTIMO = 0.09; // segundos de tolerância
const JSABRE = 0.2;   // as caixinhas do sabre têm um pouco mais de folga (o corte leva um tempinho)
// sabre no teclado: W A S D = mão esquerda, setas (ou I J K L) = mão direita
const TECLAS_SABRE = { w: [0, 'cima'], a: [0, 'esq'], s: [0, 'baixo'], d: [0, 'dir'], arrowup: [1, 'cima'], arrowleft: [1, 'esq'], arrowdown: [1, 'baixo'], arrowright: [1, 'dir'], i: [1, 'cima'], j: [1, 'esq'], k: [1, 'baixo'], l: [1, 'dir'] };
// no computador: D F J K (ou A S K L, 1 2 3 4, ou as setas ← ↓ ↑ →)
const TECLAS = { d: 0, f: 1, j: 2, k: 3, a: 0, s: 1, l: 3, '1': 0, '2': 1, '3': 2, '4': 3, arrowleft: 0, arrowdown: 1, arrowup: 2, arrowright: 3 };
const ROTULOS = ['D', 'F', 'J', 'K'];
const COMPUTADOR = matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------- estado geral ----------
let PERFIL = { tag: '', look: null, xp: 0 };
let AV = null;
const M = { code: null, host: false, meta: null, players: {}, sair: null, rodadaVista: 0, partida: { estado: {}, resultado: {} }, sairPartida: null };
let J = null;            // a partida em andamento
let fase = 'inicio';
const guardado = (k, padrao) => { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const escolha = guardado('ph-escolha', { musica: 'laje', dif: 'medio' });
escolha.instr = { ...INSTR_PADRAO, ...(escolha.instr || {}) };
if (!DIFS[escolha.dif]) escolha.dif = 'medio';
let atrasoMs = guardado('ph-atraso', 0);

function mostrar(id) {
  ['telaInicio', 'telaMusicas', 'telaComo', 'telaAtraso', 'telaSala', 'telaFim', 'telaExtras'].forEach(t => { $(t).hidden = t !== id; });
  $('hud').hidden = id !== null;
}
let toastT = 0;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
const bonecoSVG = (look, tam) => (AV && look ? AV.avatarSVG(look, tam, {}) : '');
const meuNome = () => PERFIL.tag || ($('nome').value.trim() || 'Jogador');
const publico = () => ({ name: meuNome().slice(0, 14), look: PERFIL.look || null, dif: escolha.dif });

// ---------- tema claro/escuro (a mesma escolha do Forma Palavras) ----------
const escuro = () => document.documentElement.dataset.tema === 'escuro';
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  $('btnTema').textContent = t === 'escuro' ? '☀️ Claro' : '🌙 Escuro';
}
let tema = 'claro';
try { tema = localStorage.getItem('cp_tema') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'); } catch {}
aplicarTema(tema);
$('btnTema').onclick = () => { tema = tema === 'escuro' ? 'claro' : 'escuro'; try { localStorage.setItem('cp_tema', tema); } catch {} aplicarTema(tema); };

// ---------- áudio ----------
let ac = null;
function audio() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      // iPhone: toca mesmo com a chavinha do silencioso (quando o aparelho deixa)
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    }
    if (ac.state === 'suspended') ac.resume();
  } catch {}
  return ac;
}
addEventListener('pointerdown', audio, true);
addEventListener('keydown', audio, true);
const latencia = () => (ac ? (ac.outputLatency || ac.baseLatency || 0) : 0) + atrasoMs / 1000;

// ---------- recordes (neste aparelho) ----------
const recordes = guardado('ph-rec', {});
const recorde = (m, d) => recordes[m + ':' + d] || 0;

// ---------- listas de músicas e dificuldade ----------
function desenharMusicas(el, sel, aoEscolher, dif) {
  el.innerHTML = MUSICAS.map(m => {
    const rec = recorde(m.id, dif);
    return `<button class="musica ${m.id === sel ? 'on' : ''}" data-id="${m.id}" ${aoEscolher ? '' : 'disabled'}>
      <span class="em" style="background:${m.cor}33">${m.capa ? `<img src="${esc(m.capa)}" alt="">` : m.emoji}</span>
      <span><b>${esc(m.nome)}</b><small>${esc(m.desc)}</small></span>
      <span class="rec">${rec ? '🏆 ' + rec.toLocaleString('pt-BR') : ''}</span></button>`;
  }).join('');
  if (aoEscolher) el.querySelectorAll('.musica').forEach(b => { b.onclick = () => aoEscolher(b.dataset.id); });
}
function desenharDifs(el, sel, aoEscolher) {
  el.innerHTML = Object.entries(DIFS).map(([id, d]) => `<button data-id="${id}" class="${id === sel ? 'on' : ''}">${d.emoji} ${d.nome}</button>`).join('');
  el.querySelectorAll('button').forEach(b => { b.onclick = () => aoEscolher(b.dataset.id); });
}
// "Trocar de instrumento" + quais instrumentos entram
function desenharInstr(el, cfg, aoMudar) {
  const pode = !!aoMudar;
  el.innerHTML = `<label class="trocaInstr"><input type="checkbox" ${cfg.troca ? 'checked' : ''} ${pode ? '' : 'disabled'}><span>Trocar de instrumento durante a música</span></label>
    <div class="chipsInstr">${Object.entries(INSTRUMENTOS).map(([k, v]) => `<button type="button" data-k="${k}" class="${cfg.troca && cfg[k] !== false ? 'on' : ''}" ${pode && cfg.troca ? '' : 'disabled'} aria-pressed="${cfg.troca && cfg[k] !== false}">${v.emoji} ${v.nome}</button>`).join('')}</div>`;
  if (!pode) return;
  el.querySelector('input').onchange = e => aoMudar({ ...cfg, troca: e.target.checked });
  el.querySelectorAll('.chipsInstr button').forEach(b => b.onclick = () => {
    const novo = { ...cfg, [b.dataset.k]: cfg[b.dataset.k] === false };
    if (!Object.keys(INSTRUMENTOS).some(k => novo[k] !== false)) { toast('Deixe pelo menos um instrumento ligado 🙂'); return; }
    aoMudar(novo);
  });
}
function telaSolo() {
  const atualizar = () => {
    desenharMusicas($('listaMusicasSolo'), escolha.musica, id => { escolha.musica = id; guardar('ph-escolha', escolha); atualizar(); }, escolha.dif);
    desenharDifs($('difSolo'), escolha.dif, id => { escolha.dif = id; guardar('ph-escolha', escolha); atualizar(); });
    desenharInstr($('instrSolo'), escolha.instr, cfg => { escolha.instr = cfg; guardar('ph-escolha', escolha); atualizar(); });
  };
  atualizar(); mostrar('telaMusicas');
}

// ======================= a partida =======================
function novaPartida({ musica, dif, inicioPerf, online, ids = [], rodada = 0, instr = null }) {
  const ctx = audio();
  if (J && J.banda) J.banda.parar();
  const m = musicaPorId(musica), p = partitura(m, dif, instr);
  if (m.arquivo && !m.arquivo.pasta && instr && instr.troca) setTimeout(() => toast('Essa música ainda só tem guitarra 🎸', 2600), 400);
  const t0 = ctx.currentTime + (inicioPerf - performance.now()) / 1000;
  const frases = {};
  p.notas.forEach(n => { if (n.estrela) { frases[n.frase] = frases[n.frase] || { total: 0, acertos: 0, falhou: false }; frases[n.frase].total++; } });
  J = {
    m, dif, p, notas: p.notas.map(n => ({ ...n, st: 0 })), perf0: inicioPerf, banda: new (m.arquivo ? (m.arquivo.pasta ? BandaFaixas : BandaAudio) : Banda)(ctx, m, p, t0),
    janela: DIFS[dif].janela, pontos: 0, combo: 0, maxCombo: 0, acertos: 0, perfeitos: 0, erros: 0, errosSeguidos: 0,
    energia: 0, dobro: null, frases, segurando: [null, null, null, null], apertado: [0, 0, 0, 0], efeitos: [], faiscas: [],
    online, ids, rodada, fim: false, prox: 0, ultEnvio: 0, contou: -1, avisoTroca: 0, batida: {},
  };
  fase = 'jogo'; mostrar(null);
  prepararDancarino();
  falar('');
  montarRivais(); atualizarHUD();
}
const tempo = (perfMs = performance.now()) => (perfMs - J.perf0) / 1000 - latencia();
const mult = () => Math.min(4, 1 + Math.floor(J.combo / 10));
const dobrado = () => !!J.dobro;

function pressionar(tr, ts = performance.now(), deslizando = false) {
  if (!J || J.fim || fase !== 'jogo') return;
  J.apertado[tr] = performance.now();
  const t = tempo(ts);
  if (t < -0.5) return;
  let alvo = null;
  for (let i = J.prox; i < J.notas.length; i++) {
    const n = J.notas[i];
    if (n.t - t > JANELA) break;
    if (n.st !== 0 || n.trilha !== tr) continue;
    if (Math.abs(n.t - t) <= JANELA) { alvo = n; break; }
  }
  if (!alvo) { // tocou sem nota
    if (deslizando) return;   // arrastando o dedo: passar por trilha vazia não é erro
    J.banda.errou(pesosInstr(t).atual); quebrarCombo();
    J.efeitos.push({ tr, txt: '', cor: '#888', ini: performance.now(), x: true });
    return;
  }
  acertar(alvo, Math.abs(alvo.t - t));
}
function soltar(tr) {
  if (!J) return;
  J.apertado[tr] = 0;
  const s = J.segurando[tr];
  if (!s) return;
  s.som(); J.segurando[tr] = null; s.n.st = 1;
}
// corte de uma caixinha (lado 0 = mão esquerda, 1 = direita)
function cortar(lado, dir, ts = performance.now()) {
  if (!J || J.fim || fase !== 'jogo') return;
  const t = tempo(ts);
  let alvo = null;
  for (let i = J.prox; i < J.notas.length; i++) {
    const n = J.notas[i];
    if (n.t - t > JSABRE) break;
    if (n.st !== 0 || n.instr !== 'sabre' || n.lado !== lado) continue;
    if (Math.abs(n.t - t) <= JSABRE) { alvo = n; break; }
  }
  if (!alvo) return;   // cortar o vento não tira ponto
  if (alvo.dir !== dir) {   // lado certo, direção errada
    errarNota(alvo);
    J.efeitos.push({ sabre: true, lado, errado: true, txt: COMPUTADOR ? 'DIREÇÃO!' : '✗', cor: '#ff8a8a', ini: performance.now() });
    return;
  }
  acertar(alvo, Math.max(0, Math.abs(alvo.t - t) - 0.04));
}
const modoSabre = () => J && pesosInstr(tempo()).w.sabre > 0.5;
function acertar(n, d) {
  const q = d <= PERFEITO ? ['PERFEITO!', 50] : d <= OTIMO ? ['ÓTIMO', 40] : ['BOM', 25];
  J.combo++; J.maxCombo = Math.max(J.maxCombo, J.combo); J.acertos++; J.errosSeguidos = 0;
  if (d <= PERFEITO) J.perfeitos++;
  J.pontos += q[1] * mult() * (dobrado() ? 2 : 1);
  const som = n.instr === 'sabre' ? (J.banda.corte ? J.banda.corte(n.lado) : J.banda.tambor('caixa'), () => {})
    : n.instr === 'bateria' ? J.banda.tambor(n.peca)
    : n.instr === 'teclado' ? J.banda.piano(n.midi, n.dur > 0 ? n.dur + 0.15 : 0.6)
    : J.banda.solo(n.midi, n.dur > 0 ? n.dur + 0.15 : 0.3);
  if (n.dur > 0) { n.st = 3; n.ate = n.t; J.segurando[n.trilha] = { n, som }; } else n.st = 1;
  // acorde: um texto só (senão os dois "PERFEITO!" se encavalam)
  const ultimoTxt = J.efeitos.filter(e => e.txt).pop();
  const repetido = ultimoTxt && performance.now() - ultimoTxt.ini < 60;
  if (n.instr === 'bateria') {
    const pk = PECA_KIT[n.peca] || 'caixa', P = geoKit()[pk];
    J.batida[pk] = performance.now();
    J.efeitos.push({ kit: pk, txt: repetido ? '' : q[0], cor: d <= PERFEITO ? '#fff36b' : '#fff', ini: performance.now() });
    for (let i = 0; i < 10; i++) J.faiscas.push({ palco: true, x: P.x, y: P.y, a: Math.random() * Math.PI, v: 120 + Math.random() * 200, ini: performance.now(), cor: n.estrela ? '#bff6ff' : COR_KIT[pk] });
  } else if (n.instr === 'sabre') {
    const p = alvoSabre(n.lado);
    J.efeitos.push({ sabre: true, lado: n.lado, dir: n.dir, txt: repetido || !COMPUTADOR ? '' : q[0], cor: d <= PERFEITO ? '#fff36b' : '#fff', ini: performance.now() });
    for (let i = 0; i < 14; i++) J.faiscas.push({ palco: true, x: p.x, y: p.y, a: Math.random() * Math.PI * 2, v: 120 + Math.random() * 260, ini: performance.now(), cor: n.estrela ? '#bff6ff' : COR_SABRE[n.lado] });
  } else {
    J.efeitos.push({ tr: n.trilha, txt: repetido ? '' : q[0], cor: d <= PERFEITO ? '#fff36b' : '#fff', ini: performance.now() });
    for (let i = 0; i < 10; i++) J.faiscas.push({ tr: n.trilha, a: Math.random() * Math.PI, v: 120 + Math.random() * 220, ini: performance.now(), cor: n.estrela ? '#bff6ff' : CORES[n.trilha] });
  }
  if (n.estrela) {
    const f = J.frases[n.frase]; f.acertos++;
    if (f.acertos === f.total && !f.falhou) {
      J.energia = Math.min(1, J.energia + 0.34);
      aviso('⚡ ENERGIA!'); som1([880, 1175, 1568]);
    }
  }
  if ([25, 50, 100, 150, 200].includes(J.combo)) {
    falar(J.combo >= 100 ? `${J.combo} SEGUIDAS?! 🤯` : J.combo >= 50 ? 'Tá voando! 🔥' : 'Isso aí! 🤘', 1800);
    aviso(`${J.combo} DE COMBO!`);
  }
}
function errarNota(n) {
  n.st = 2; J.erros++;
  if (J.banda.falhou) J.banda.falhou(n.instr);
  if (n.estrela) J.frases[n.frase].falhou = true;
  quebrarCombo();
}
const RECLAMA = ['Ô, acorda! 😤', 'Foi fora do tempo, hein', 'Que nota foi essa? 🙉', 'Tá me fazendo passar vergonha 😩', 'O público tá vaiando…'];
function quebrarCombo() {
  J.errosSeguidos++;
  if (J.combo >= 10) DANC.caido = performance.now() + 900;
  if (J.combo >= 15) falar('Perdeu o combo! 😱', 1500);
  else if (J.errosSeguidos === 4 || J.errosSeguidos === 9) falar(RECLAMA[Math.floor(Math.random() * RECLAMA.length)], 1800);
  J.combo = 0;
}
function soltarEnergia() {
  if (!J || J.dobro || J.energia < 0.5) return;
  const t = tempo();
  J.dobro = { ini: t, fim: t + J.energia * 16 };
  J.energia = 0; aviso('⚡ PONTOS EM DOBRO!'); falar('SOLTA O SOM! ⚡', 1800); som1([523, 784, 1046, 1568]);
}
// o "tcharan": arpejo subindo + acorde final + prato
function tcharanSom(est) {
  const c = audio(); if (!c) return;
  const t = c.currentTime + 0.05;
  const notas = est <= 2 ? [392, 330, 262] : [523, 659, 784, 1046];
  notas.forEach((f, i) => bipe(c, f, 0.14, 0.12, t + i * 0.09));
  if (est <= 2) return;
  [523, 659, 784, 1046].forEach(f => bipe(c, f, 0.9, 0.07, t + notas.length * 0.09 + 0.05));
  try {
    const s = c.createBufferSource(), b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const f = c.createBiquadFilter(), gg = c.createGain(); f.type = 'highpass'; f.frequency.value = 5000; gg.gain.value = 0.25;
    s.buffer = b; s.connect(f).connect(gg).connect(c.destination); s.start(t + notas.length * 0.09 + 0.05);
  } catch {}
}
function som1(fs) { const c = audio(); if (c) fs.forEach((f, i) => bipe(c, f, 0.12, 0.08, c.currentTime + i * 0.07)); }

// ---------- a cada quadro ----------
function passo() {
  const t = tempo();
  // notas longas sendo seguradas
  J.segurando.forEach((s, tr) => {
    if (!s) return;
    const ate = Math.min(t, s.n.fim);
    if (ate > s.n.ate) { J.pontos += (ate - s.n.ate) * 60 * mult() * (dobrado() ? 2 : 1); s.n.ate = ate; }
    if (Math.random() < 0.3) J.faiscas.push({ tr, a: Math.random() * Math.PI, v: 80 + Math.random() * 120, ini: performance.now(), cor: CORES[tr] });
    if (t >= s.n.fim) { s.n.st = 1; J.segurando[tr] = null; }
  });
  // robô de teste
  if (ROBO) for (let i = J.prox; i < J.notas.length && J.notas[i].t < t + 0.03; i++) {
    const n = J.notas[i]; if (n.st === 0 && Math.abs(n.t - t) < 0.03) acertar(n, Math.abs(n.t - t));
  }
  // notas que passaram sem ninguém tocar
  for (let i = J.prox; i < J.notas.length; i++) {
    const n = J.notas[i];
    if (n.t > t - JANELA) break;
    if (n.st === 0 && !(n.instr === 'sabre' && n.t > t - JSABRE)) errarNota(n);
  }
  while (J.prox < J.notas.length && J.notas[J.prox].st !== 0 && J.notas[J.prox].t < t - JSABRE) J.prox++;
  if (J.dobro && t > J.dobro.fim) J.dobro = null;
  // contagem antes das notas chegarem
  const primeira = J.notas[0].t, falta = primeira - t;
  if (falta > 0 && falta < 4.2) {
    const c = Math.ceil(falta / (J.p.oitavo * 2));
    if (c !== J.contou && c <= 4) { J.contou = c; aviso(c === 4 ? 'PREPARA…' : String(c), 500); }
  }
  // aviso: vem aí outro instrumento
  const TR = J.p.trocas || [];
  for (let k = J.avisoTroca; k < TR.length; k++) {
    if (TR[k].t - t > 1.7) break;
    if (k > 0 || TR[k].instr !== 'guitarra') {
      const I = (J.p.nomes && J.p.nomes[TR[k].instr]) || INSTRUMENTOS[TR[k].instr];
      aviso(TR[k].instr === 'sabre' ? (COMPUTADOR ? '⚔️ CORTE AS CAIXINHAS!' : '⚔️') : `${I.emoji} ${I.nome.toUpperCase()}!`, 1300); som1([660, 990]);
    }
    J.avisoTroca = k + 1;
  }
  // placar pros outros
  if (J.online && performance.now() - J.ultEnvio > 450) {
    J.ultEnvio = performance.now();
    rede.enviarEstado(M.code, { s: Math.round(J.pontos), c: J.combo, a: J.acertos, d: J.dif, e: J.dobro ? 1 : 0, r: J.rodada }).catch(() => {});
  }
  if (!J.fim && t > J.p.duracao + 0.6) terminar();
  atualizarHUD();
}

// ---------- painel ----------
let hudCache = '';
function atualizarHUD() {
  const m = mult(), dob = dobrado();
  const chave = `${Math.round(J.pontos)}|${J.combo}|${m}|${dob}|${J.energia.toFixed(2)}|${J.dobro ? Math.round((J.dobro.fim - tempo()) * 4) : ''}`;
  if (chave === hudCache) return; hudCache = chave;
  $('pontos').textContent = Math.round(J.pontos).toLocaleString('pt-BR');
  $('mult').textContent = 'x' + m; $('mult').className = 'x' + m + (dob ? ' dobro' : '');
  $('mult').style.setProperty('--p', m >= 4 ? 1 : (J.combo % 10) / 10);
  const e = J.dobro ? Math.max(0, (J.dobro.fim - tempo()) / 16) : J.energia;
  $('energia').firstElementChild.style.width = (e * 100) + '%';
  $('energia').classList.toggle('pronta', !J.dobro && J.energia >= 0.5);
  $('btnEnergia').hidden = !!J.dobro || J.energia < 0.5 || J.fim;
}
let falaT = 0;
function falar(txt, ms = 1600) {
  const b = $('boneco').querySelector('.balao');
  clearTimeout(falaT);
  if (!txt) { b.hidden = true; return; }
  b.textContent = txt; b.hidden = false; falaT = setTimeout(() => { b.hidden = true; }, ms);
}
let avisoT = 0;
function aviso(txt, ms = 1100) {
  const a = $('aviso'); a.textContent = txt; a.hidden = false;
  a.animate([{ transform: 'translateX(-50%) scale(1.5)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 180 });
  clearTimeout(avisoT); avisoT = setTimeout(() => { a.hidden = true; }, ms);
}
function montarRivais() {
  const el = $('rivais');
  if (!J || !J.online) { el.innerHTML = ''; return; }
  el.innerHTML = J.ids.filter(id => id !== rede.meuId()).map(id => {
    const p = M.players[id] || {};
    return `<div class="rival" id="rv-${id}"><div class="av">${bonecoSVG(p.look, 34) || '🙂'}</div><div><div class="nm">${esc(p.name || '?')}</div><div class="pt">0</div></div></div>`;
  }).join('');
}
function atualizarRivais() {
  if (!J || !J.online) return;
  const est = M.partida.estado || {};
  const pts = id => id === rede.meuId() ? J.pontos : ((est[id] && est[id].r === J.rodada && est[id].s) || 0);
  const lider = [...J.ids].sort((a, b) => pts(b) - pts(a))[0];
  J.ids.forEach(id => {
    const el = document.getElementById('rv-' + id); if (!el) return;
    const e = est[id] && est[id].r === J.rodada ? est[id] : {};
    el.querySelector('.pt').textContent = (e.s || 0).toLocaleString('pt-BR') + (e.e ? ' ⚡' : '');
    el.classList.toggle('fogo', (e.c || 0) >= 30);
    el.classList.toggle('liderando', id === lider && (e.s || 0) > 0);
  });
}
setInterval(atualizarRivais, 300);

// ======================= desenho =======================
const cv = $('tela'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function ajustarTela() {
  DPR = Math.min(2, devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  fundoCache = null;
}
addEventListener('resize', ajustarTela);
const FONTE = '"Nunito", system-ui, -apple-system, sans-serif';

// perspectiva da pista: z = 0 na linha de tocar, z = 1 lá no fundo (onde fica o palco)
const K = 1.8;
function geo() {
  const hitY = H - Math.max(96, H * 0.15), topoY = H * 0.3;
  const s1 = 1 / (1 + K), vY = (topoY - hitY * s1) / (1 - s1);
  const larg = Math.min(W * 0.94, 480);
  return { hitY, vY, topoY, larg, cx: W / 2 };
}
const esc_ = z => 1 / (1 + K * z);
function ponto(G, tr, z) {
  const s = esc_(z);
  return { x: G.cx + (tr - 1.5) * (G.larg / 4) * s, y: G.vY + (G.hitY - G.vY) * s, s };
}
function trilhaDoX(x) {
  const G = geo();
  return Math.max(0, Math.min(3, Math.floor((x - (G.cx - G.larg / 2)) / (G.larg / 4))));
}
function bisseca(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
// em que ponto da batida estamos (0 a 1) e qual batida
function batida(t) {
  if (J && J.p.batidas) { const B = J.p.batidas, i = Math.max(0, bisseca(B, t) - 1), d = (B[i + 1] || B[i] + 0.5) - B[i]; return { n: i, f: Math.max(0, Math.min(1, (t - B[i]) / d)) }; }
  const d = J ? J.p.oitavo * 2 : 0.5; return { n: Math.floor(t / d), f: ((t / d) % 1 + 1) % 1 };
}

// ---------- fundo: palco com treliça de luzes, holofotes, fumaça e plateia ----------
let fundoCache = null;
function fundoFixo() {
  // a parte que não mexe vai pra uma imagem só (mais leve no celular)
  const c = document.createElement('canvas'); c.width = W * DPR; c.height = H * DPR;
  const x = c.getContext('2d'); x.scale(DPR, DPR);
  const gr = x.createLinearGradient(0, 0, 0, H);
  if (escuro()) { gr.addColorStop(0, '#05030f'); gr.addColorStop(0.45, '#140a33'); gr.addColorStop(1, '#2a0f4a'); }
  else { gr.addColorStop(0, '#2b1670'); gr.addColorStop(0.45, '#4f27a8'); gr.addColorStop(1, '#8a3fc4'); }
  x.fillStyle = gr; x.fillRect(0, 0, W, H);
  // brilho atrás do palco
  const G = geo(), rg = x.createRadialGradient(W / 2, G.topoY - 40, 10, W / 2, G.topoY - 40, W * 0.7);
  rg.addColorStop(0, 'rgba(255,120,200,.35)'); rg.addColorStop(1, 'rgba(255,120,200,0)');
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  // bolinhas desfocadas (bokeh)
  for (let i = 0; i < 26; i++) {
    const bx = (i * 97.3) % W, by = (i * 53.7) % (H * 0.55), r = 6 + (i % 5) * 5;
    const b = x.createRadialGradient(bx, by, 0, bx, by, r);
    b.addColorStop(0, `hsla(${(i * 47) % 360},90%,75%,.16)`); b.addColorStop(1, 'hsla(0,0%,100%,0)');
    x.fillStyle = b; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  // treliça (a estrutura de metal das luzes)
  x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 2;
  const ty = Math.max(8, H * 0.012);
  x.beginPath(); x.moveTo(0, ty); x.lineTo(W, ty); x.moveTo(0, ty + 10); x.lineTo(W, ty + 10); x.stroke();
  for (let i = 0; i < W; i += 14) { x.beginPath(); x.moveTo(i, ty); x.lineTo(i + 7, ty + 10); x.lineTo(i + 14, ty); x.stroke(); }
  return c;
}
function fundo(t, energia, intensidade) {
  if (!fundoCache || fundoCache.width !== W * DPR) fundoCache = fundoFixo();
  g.drawImage(fundoCache, 0, 0, W, H);
  const ty = Math.max(8, H * 0.012) + 12;
  // lâmpadas da treliça piscando na batida
  const b = J && fase === 'jogo' ? batida(tempo()) : { n: Math.floor(t * 2), f: (t * 2) % 1 };
  const cores = energia ? ['#7ff3ff', '#ffffff', '#3ad1ff'] : ['#ff3d8b', '#ffd23f', '#3aa0ff', '#2fdc6b'];
  const nL = Math.max(6, Math.round(W / 60));
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < nL; i++) {
    const lx = (i + 0.5) * W / nL, cor = cores[i % cores.length];
    const aceso = (i + b.n) % 2 === 0 ? 1 - b.f * 0.6 : 0.35;
    const rg = g.createRadialGradient(lx, ty, 0, lx, ty, 22);
    rg.addColorStop(0, cor); rg.addColorStop(0.25, cor + 'aa'); rg.addColorStop(1, cor + '00');
    g.globalAlpha = aceso; g.fillStyle = rg; g.beginPath(); g.arc(lx, ty, 22, 0, 7); g.fill();
  }
  // holofotes balançando
  g.globalAlpha = 0.5 + intensidade * 0.5;
  for (let i = 0; i < 4; i++) {
    const ox = W * (0.1 + i * 0.27), ang = Math.sin(t * (0.7 + i * 0.13) + i * 2.1) * 0.5, cor = cores[i % cores.length];
    const len = H * 0.95, ex = ox + Math.sin(ang) * len, ey = ty + Math.cos(ang) * len;
    const lg = g.createLinearGradient(ox, ty, ex, ey);
    lg.addColorStop(0, cor + '66'); lg.addColorStop(1, cor + '00');
    const nx = Math.cos(ang) * 110, ny = -Math.sin(ang) * 110;
    g.fillStyle = lg; g.beginPath(); g.moveTo(ox - 5, ty); g.lineTo(ox + 5, ty); g.lineTo(ex + nx, ey + ny); g.lineTo(ex - nx, ey - ny); g.closePath(); g.fill();
  }
  g.restore();
  // plateia: cabeças e mãos pra cima quando o combo esquenta
  const base = H + 4;
  g.fillStyle = escuro() ? '#030108' : '#1a0b3d';
  for (let x = -10, i = 0; x < W + 20; x += 24, i++) {
    const pulo = Math.max(0, Math.sin(t * 7 + i * 1.7)) * (2 + intensidade * 10);
    const y = base - 30 - pulo - (i % 3) * 6;
    g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x, y + 26, 15, 18, 0, 0, 7); g.fill();
    if (intensidade > 0.3 && i % 2 === 0) { // braço levantado
      g.save(); g.strokeStyle = g.fillStyle; g.lineWidth = 6; g.lineCap = 'round';
      const lado = i % 4 === 0 ? -1 : 1;
      g.beginPath(); g.moveTo(x + lado * 9, y + 14); g.lineTo(x + lado * (14 + Math.sin(t * 9 + i) * 4), y - 16 - pulo * 0.6); g.stroke(); g.restore();
    }
  }
}

// ---------- o boneco do jogador dançando no palco ----------
const DANC = { img: null, look: null, roupa: '#5b3cc4', pele: '#e8b38f', caido: 0 };
function prepararDancarino() {
  DANC.img = null;
  if (!AV) return;
  const look = PERFIL.look || DANC.look || (DANC.look = AV.lookPadrao());
  try {
    const svg = AV.avatarSVG(look, 200, { semFundo: true }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const img = new Image(); img.onload = () => { DANC.img = img; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const C = AV.CATALOGO, ach = (l, id) => (l || []).find(x => x.id === id);
    DANC.roupa = (ach(C.corRoupa, look.corRoupa) || {}).cor || '#5b3cc4';
    DANC.pele = (ach(C.pele, look.pele) || {}).cor || '#e8b38f';
  } catch {}
}
function desenharDancarino(t, G) {
  if (!DANC.img) return;
  const S = Math.min(120, H * 0.15, W * 0.3);   // tamanho da cabeça
  const pe = G.topoY - 6, cx = G.cx;
  const b = batida(t), m = mult(), c = J.combo;
  const nivel = c >= 10 ? Math.min(1, 0.4 + (m - 2) * 0.3) : 0;  // 0 = parado, 1 = dançando com tudo
  const caindo = Math.max(0, DANC.caido - performance.now()) / 900;  // acabou de perder o combo
  const ph = b.f * Math.PI * 2, lado = b.n % 2 ? 1 : -1;
  const quica = nivel ? Math.abs(Math.sin(ph / 2 + Math.PI / 2)) * S * 0.12 * nivel : Math.sin(t * 2) * S * 0.015;
  const pulo = m >= 4 && b.n % 4 === 0 ? Math.sin(b.f * Math.PI) * S * 0.25 : 0;
  const inclina = nivel ? Math.sin(ph) * 0.12 * nivel : 0;
  const cabeca = nivel ? Math.sin(ph * 2) * 0.12 * nivel : caindo * 0.25;
  g.save();
  // chão do palco + luz
  const rg = g.createRadialGradient(cx, pe, 0, cx, pe, S * 1.1);
  rg.addColorStop(0, `rgba(255,255,255,${0.25 + nivel * 0.35})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.beginPath(); g.ellipse(cx, pe, S * 1.1, S * 0.22, 0, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(cx, pe, S * 0.42 * (1 - pulo / S), S * 0.07, 0, 0, 7); g.fill();
  g.translate(cx, pe - quica - pulo + caindo * S * 0.08); g.rotate(inclina - caindo * 0.1);
  const pern = S * 0.42, tronco = S * 0.42, larg = S * 0.5;
  // pernas (passinho de um lado pro outro)
  const passo = nivel ? Math.sin(ph) * S * 0.1 * nivel : 0;
  g.lineCap = 'round'; g.lineWidth = S * 0.13; g.strokeStyle = '#2b1d5c';
  g.beginPath(); g.moveTo(-larg * 0.22, -pern); g.lineTo(-larg * 0.3 + passo, -S * 0.04); g.stroke();
  g.beginPath(); g.moveTo(larg * 0.22, -pern); g.lineTo(larg * 0.3 + passo * (nivel ? -1 : 1), -S * 0.04); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(-larg * 0.3 + passo - S * 0.03, -S * 0.03, S * 0.1, S * 0.05, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(larg * 0.3 - passo * (nivel ? 1 : -1) + S * 0.03, -S * 0.03, S * 0.1, S * 0.05, 0, 0, 7); g.fill();
  // tronco (camiseta da mesma cor da roupa do boneco)
  const topo = -pern - tronco;
  g.fillStyle = DANC.roupa;
  g.beginPath(); g.moveTo(-larg / 2, topo); g.lineTo(larg / 2, topo); g.lineTo(larg * 0.4, -pern + S * 0.02); g.lineTo(-larg * 0.4, -pern + S * 0.02); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(-larg * 0.4, -pern - S * 0.04, larg * 0.8, S * 0.06);
  // guitarra (na bateria some; no teclado vira um "keytar" branco)
  const instrAgora = pesosInstr(t).atual;
  g.save(); g.translate(S * 0.02, -pern - tronco * 0.35); g.rotate(-0.45 + (nivel ? Math.sin(ph) * 0.06 : 0));
  if (instrAgora === 'bateria' || instrAgora === 'sabre') g.globalAlpha = 0;
  g.fillStyle = '#3a2a1a'; g.fillRect(-S * 0.75, -S * 0.035, S * 0.62, S * 0.07);              // braço
  g.fillStyle = '#1a1208'; g.fillRect(-S * 0.86, -S * 0.06, S * 0.13, S * 0.12);               // cabeça do braço
  g.fillStyle = instrAgora === 'teclado' ? '#f4f1ff' : '#e8304a';
  g.beginPath(); g.ellipse(S * 0.02, 0, S * 0.2, S * 0.16, 0, 0, 7); g.fill();
  if (instrAgora === 'teclado') { g.fillStyle = '#16122a'; for (let k = -3; k <= 3; k++) g.fillRect(k * S * 0.045 - S * 0.012, -S * 0.11, S * 0.024, S * 0.11); }
  g.beginPath(); g.ellipse(-S * 0.16, 0, S * 0.13, S * 0.11, 0, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, S * 0.05, S * 0.12, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-S * 0.82, 0); g.lineTo(S * 0.1, 0); g.stroke();
  g.restore();
  // braços: um no braço da guitarra, outro palhetando
  const pal = nivel ? Math.sin(ph * 4) * S * 0.08 : 0;
  g.lineWidth = S * 0.11; g.strokeStyle = DANC.roupa;
  g.beginPath(); g.moveTo(-larg * 0.45, topo + S * 0.05); g.quadraticCurveTo(-larg * 0.75, -pern - tronco * 0.4, -S * 0.42, -pern - tronco * 0.12 - S * 0.16); g.stroke();
  g.beginPath(); g.moveTo(larg * 0.45, topo + S * 0.05); g.quadraticCurveTo(larg * 0.6, -pern - tronco * 0.2, S * 0.06, -pern - tronco * 0.45 + pal); g.stroke();
  if (instrAgora === 'bateria' || instrAgora === 'sabre') {   // baquetas batendo no ritmo (ou dois sabres de luz)
    const sab = instrAgora === 'sabre';
    g.lineWidth = S * (sab ? 0.05 : 0.035);
    const bate = Math.sin(ph * 2) * 0.5;
    for (const [hx, hy, lado] of [[-S * 0.42, -pern - tronco * 0.12 - S * 0.16, -1], [S * 0.06, -pern - tronco * 0.45 + pal, 1]]) {
      const ang = -Math.PI / 2 + lado * (0.5 + (lado > 0 ? bate : -bate) * 0.6), L = S * (sab ? 0.7 : 0.45);
      g.save(); g.strokeStyle = sab ? (lado < 0 ? COR_SABRE[0] : COR_SABRE[1]) : '#e9d3a3';
      if (sab) { g.shadowColor = g.strokeStyle; g.shadowBlur = 12; g.lineCap = 'round'; }
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(ang) * L, hy + Math.sin(ang) * L); g.stroke(); g.restore();
    }
  }
  g.fillStyle = DANC.pele;
  g.beginPath(); g.arc(-S * 0.42, -pern - tronco * 0.12 - S * 0.16, S * 0.065, 0, 7); g.fill();
  g.beginPath(); g.arc(S * 0.06, -pern - tronco * 0.45 + pal, S * 0.065, 0, 7); g.fill();
  // cabeça (o boneco do Forma Palavras)
  g.translate(0, topo + S * 0.08); g.rotate(cabeca);
  g.drawImage(DANC.img, -S / 2, -S * 0.98, S, S);
  g.restore();
  // fogo quando está no x4
  if (m >= 4 && Math.random() < 0.5) J.faiscas.push({ palco: true, x: cx + (Math.random() - 0.5) * S, y: pe - Math.random() * S * 0.3, a: Math.PI / 2 + (Math.random() - 0.5), v: 60 + Math.random() * 90, ini: performance.now(), cor: Math.random() < 0.5 ? '#ffb13d' : '#ff5f2e' });
}

// quanto de cada instrumento aparece na tela agora (0 a 1)
function pesosInstr(t) {
  const TR = (J && J.p.trocas) || [{ t: 0, instr: 'guitarra' }], ANT = 0.9, DUR = 0.5;
  let i = 0; for (let k = 0; k < TR.length; k++) if (t >= TR[k].t - ANT) i = k;
  const atual = TR[i].instr, ant = i > 0 ? TR[i - 1].instr : atual;
  const f = i > 0 ? Math.max(0, Math.min(1, (t - (TR[i].t - ANT)) / DUR)) : 1;
  const w = { guitarra: 0, bateria: 0, teclado: 0, sabre: 0 }; w[ant] += 1 - f; w[atual] += f;
  return { w, atual };
}
// ---------- a pista ----------
function desenharJogo() {
  const t = tempo(), G = geo(), janela = J.janela, agora = performance.now();
  g.lineJoin = 'round';   // sem 'espinhos' no contorno das letras
  const dob = dobrado(), m = mult();
  const intensidade = Math.min(1, J.combo / 40);
  fundo(t, dob, intensidade);
  desenharDancarino(t, G);
  const zBaixo = -0.13;
  const PI = pesosInstr(t), WI = PI.w, vis = 1 - WI.sabre - WI.bateria;
  // corpo da pista (fica quase transparente na bateria e no teclado; some nas caixinhas do sabre)
  g.globalAlpha = (0.28 + 0.72 * WI.guitarra) * vis;
  const pts = [ponto(G, -0.5, 1), ponto(G, 3.5, 1), ponto(G, 3.5, zBaixo), ponto(G, -0.5, zBaixo)];
  const gr = g.createLinearGradient(0, pts[0].y, 0, pts[2].y);
  gr.addColorStop(0, dob ? 'rgba(10,60,100,.55)' : 'rgba(12,6,30,.55)'); gr.addColorStop(0.35, dob ? 'rgba(12,70,120,.92)' : 'rgba(14,8,34,.92)'); gr.addColorStop(1, dob ? 'rgba(18,90,150,.97)' : 'rgba(20,10,46,.97)');
  g.fillStyle = gr; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill();
  // cor de cada trilha perto da linha de tocar
  for (let tr = 0; tr < 4; tr++) {
    const a = ponto(G, tr - 0.5, 0.45), b = ponto(G, tr + 0.5, 0.45), c = ponto(G, tr + 0.5, zBaixo), d = ponto(G, tr - 0.5, zBaixo);
    const lg = g.createLinearGradient(0, a.y, 0, c.y);
    lg.addColorStop(0, CORES[tr] + '00'); lg.addColorStop(1, CORES[tr] + (J.apertado[tr] ? '40' : '1c'));
    g.fillStyle = lg; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
  }
  // divisões das trilhas
  for (let i = 1; i < 4; i++) {
    const a = ponto(G, i - 0.5, 1), b = ponto(G, i - 0.5, zBaixo);
    g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  g.globalAlpha = vis;
  // linhas de tempo
  const bat = J.p.oitavo * 2, BT = J.p.batidas;
  const k0 = BT ? Math.max(0, bisseca(BT, t - 0.3)) : Math.ceil((t - 0.3) / bat);
  for (let k = k0; BT ? (k < BT.length && BT[k] < t + janela) : k * bat < t + janela; k++) {
    const z = ((BT ? BT[k] : k * bat) - t) / janela; if (z < zBaixo) continue;
    const a = ponto(G, -0.5, z), b = ponto(G, 3.5, z);
    g.strokeStyle = k % 4 === 0 ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.1)'; g.lineWidth = (k % 4 === 0 ? 3 : 1.5) * a.s;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  // bordas brilhantes (mudam de cor com o multiplicador)
  const corBorda = dob ? '#7ff3ff' : ['#ffffff', '#ffffff', '#3aa0ff', '#2fdc6b', '#ffb13d'][m];
  for (const lado of [-0.5, 3.5]) {
    const a = ponto(G, lado, 1), b = ponto(G, lado, zBaixo);
    g.save(); g.shadowColor = corBorda; g.shadowBlur = m >= 3 || dob ? 16 : 6;
    const lg = g.createLinearGradient(0, a.y, 0, b.y); lg.addColorStop(0, corBorda + '22'); lg.addColorStop(1, corBorda);
    g.strokeStyle = lg; g.lineWidth = 4; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.restore();
  }
  // linha de tocar
  const l1 = ponto(G, -0.5, 0), l2 = ponto(G, 3.5, 0);
  g.save(); g.shadowColor = corBorda; g.shadowBlur = 12; g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(l1.x, l1.y); g.lineTo(l2.x, l2.y); g.stroke(); g.restore();
  // alvos
  const rAlvo = G.larg / 4 * 0.37;
  g.globalAlpha = 1;
  if (WI.teclado > 0) { g.globalAlpha = WI.teclado; desenharTeclado(G, rAlvo, zBaixo); g.globalAlpha = 1; }

  for (let tr = 0; tr < 4 && WI.guitarra > 0.02; tr++) {
    const p = ponto(G, tr, 0), ap = J.apertado[tr], seg = !!J.segurando[tr];
    g.globalAlpha = WI.guitarra;
    g.save(); g.translate(p.x, p.y); g.scale(1, 0.58);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(0, rAlvo * 0.22, rAlvo * 1.06, 0, 7); g.fill();
    const anel = g.createLinearGradient(0, -rAlvo, 0, rAlvo);
    anel.addColorStop(0, '#ffffff'); anel.addColorStop(0.35, CORES[tr]); anel.addColorStop(1, ESCURAS[tr]);
    g.fillStyle = anel; g.beginPath(); g.arc(0, 0, rAlvo, 0, 7); g.fill();
    const meio = g.createRadialGradient(0, -rAlvo * 0.2, 0, 0, 0, rAlvo * 0.75);
    if (ap || seg) { meio.addColorStop(0, '#ffffff'); meio.addColorStop(0.5, CORES[tr]); meio.addColorStop(1, ESCURAS[tr]); }
    else { meio.addColorStop(0, '#2a1d4f'); meio.addColorStop(1, '#0c0620'); }
    g.fillStyle = meio; g.beginPath(); g.arc(0, 0, rAlvo * 0.74, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, rAlvo * 0.5, 0, 7); g.stroke();
    g.restore();
    if (ap || seg) {
      const alt = seg ? 170 : 120, lg = g.createLinearGradient(0, p.y, 0, p.y - alt);
      lg.addColorStop(0, CORES[tr] + '88'); lg.addColorStop(1, CORES[tr] + '00');
      g.fillStyle = lg; g.beginPath(); g.moveTo(p.x - rAlvo * 0.8, p.y); g.lineTo(p.x + rAlvo * 0.8, p.y); g.lineTo(p.x + rAlvo * 0.3, p.y - alt); g.lineTo(p.x - rAlvo * 0.3, p.y - alt); g.closePath(); g.fill();
    }
  }
  g.globalAlpha = vis;
  if (COMPUTADOR && vis > 0.02) {   // no computador, mostra qual tecla é cada trilha
    g.font = `900 15px ${FONTE}`; g.textAlign = 'center';
    for (let tr = 0; tr < 4; tr++) {
      const p = ponto(G, tr, 0), y = p.y + rAlvo * 0.62 + 6;
      g.fillStyle = 'rgba(10,4,30,.7)'; g.beginPath(); g.roundRect(p.x - 13, y, 26, 22, 6); g.fill();
      g.fillStyle = CORES[tr]; g.fillText(ROTULOS[tr], p.x, y + 16);
    }
  }
  g.globalAlpha = 1;
  // notas
  const visiveis = [];
  for (let i = Math.max(0, J.prox - 8); i < J.notas.length; i++) {
    const n = J.notas[i]; if (n.t - t > janela) break;
    if (n.fim < t - 0.4) continue; if (n.instr !== 'sabre' && n.instr !== 'bateria') visiveis.push(n);
  }
  for (let i = visiveis.length - 1; i >= 0; i--) {
    const n = visiveis[i];
    if (n.dur > 0 && n.st !== 1) {   // rabo da nota longa
      const zi = Math.max(zBaixo, ((n.st === 3 ? Math.max(n.t, t) : n.t) - t) / janela), zf = Math.min(1, (n.fim - t) / janela);
      if (zf > zi) {
        const a = ponto(G, n.trilha, zi), b = ponto(G, n.trilha, zf), w = rAlvo * 0.26;
        const tremor = n.st === 3 ? Math.sin(agora / 30) * 2 : 0;
        g.save();
        if (n.st === 3) { g.shadowColor = CORES[n.trilha]; g.shadowBlur = 14; }
        g.fillStyle = n.st === 2 ? 'rgba(140,140,150,.45)' : CORES[n.trilha] + (n.st === 3 ? 'ff' : 'cc');
        g.beginPath(); g.moveTo(a.x - w * a.s + tremor, a.y); g.lineTo(a.x + w * a.s + tremor, a.y); g.lineTo(b.x + w * b.s, b.y); g.lineTo(b.x - w * b.s, b.y); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,.35)';
        g.beginPath(); g.moveTo(a.x - w * a.s * 0.3 + tremor, a.y); g.lineTo(a.x + w * a.s * 0.1 + tremor, a.y); g.lineTo(b.x + w * b.s * 0.1, b.y); g.lineTo(b.x - w * b.s * 0.3, b.y); g.closePath(); g.fill();
        g.restore();
      }
    }
    if (n.st === 1 || n.st === 3) continue;
    const z = (n.t - t) / janela; if (z < zBaixo - 0.05) continue;
    const p = ponto(G, n.trilha, z), r = rAlvo * 0.88 * p.s;
    g.globalAlpha = Math.min(1, (1 - z) * 5);   // aparece suave lá no fundo
    joia(p.x, p.y, r, n.trilha, n.st === 2 ? 'erro' : n.estrela ? 'estrela' : '', agora, n.instr);
    g.globalAlpha = 1;
  }
  desenharKit(t, janela, WI.bateria, agora);
  desenharSabre(t, janela, WI.sabre, agora);
  // explosões de acerto (anel que cresce) e faíscas
  J.faiscas = J.faiscas.filter(f => agora - f.ini < 500);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const f of J.faiscas) {
    const k = (agora - f.ini) / 1000;
    const p = f.palco ? f : ponto(G, f.tr, 0);
    const x = p.x + Math.cos(f.a) * f.v * k, y = p.y - Math.sin(f.a) * f.v * k + (f.palco ? -40 * k : 320 * k * k);
    g.globalAlpha = Math.max(0, 1 - k / 0.5); g.fillStyle = f.cor;
    g.beginPath(); g.arc(x, y, f.palco ? 3 : 2.6, 0, 7); g.fill();
  }
  g.restore(); g.globalAlpha = 1;
  J.efeitos = J.efeitos.filter(e => agora - e.ini < 650);
  g.textAlign = 'center';
  for (const e of J.efeitos) {
    if (e.sabre) { efeitoSabre(e, agora); continue; }
    if (e.kit) {
      const P = geoKit()[e.kit], k = (agora - e.ini) / 650;
      if (k < 0.45) anelPeca(P, 1 + k * 0.8, COR_KIT[e.kit], 1 - k / 0.45, 5 * (1 - k));
      if (!e.txt) continue;
      const y = (P.tipo === 'bumbo' ? P.y - P.ry : P.y - P.ry - 22) - k * 30;
      g.globalAlpha = Math.min(1, (1 - k) * 2); g.font = `900 17px ${FONTE}`; g.textAlign = 'center';
      g.lineWidth = 5; g.strokeStyle = 'rgba(10,4,30,.75)'; g.strokeText(e.txt, P.x, y); g.fillStyle = e.cor; g.fillText(e.txt, P.x, y);
      g.globalAlpha = 1; continue;
    }
    const p = ponto(G, e.tr, 0), k = (agora - e.ini) / 650;
    if (e.x) {
      g.globalAlpha = 1 - k; g.strokeStyle = '#ff4d5e'; g.lineWidth = 5; g.lineCap = 'round'; const s = 11;
      g.beginPath(); g.moveTo(p.x - s, p.y - s); g.lineTo(p.x + s, p.y + s); g.moveTo(p.x + s, p.y - s); g.lineTo(p.x - s, p.y + s); g.stroke();
      continue;
    }
    if (k < 0.45) { // anel
      g.globalAlpha = 1 - k / 0.45; g.strokeStyle = e.cor; g.lineWidth = 4 * (1 - k);
      g.save(); g.translate(p.x, p.y); g.scale(1, 0.58); g.beginPath(); g.arc(0, 0, rAlvo * (1 + k * 1.6), 0, 7); g.stroke(); g.restore();
    }
    if (!e.txt) continue;
    const y = p.y - 44 - k * 34, tam = e.txt === 'PERFEITO!' ? 19 : 17;
    g.globalAlpha = Math.min(1, (1 - k) * 2);
    g.font = `900 ${tam * (k < 0.12 ? 1 + (0.12 - k) * 3 : 1)}px ${FONTE}`;
    g.lineWidth = 5; g.strokeStyle = 'rgba(10,4,30,.75)'; g.strokeText(e.txt, p.x, y);
    g.fillStyle = e.cor; g.fillText(e.txt, p.x, y);
  }
  g.globalAlpha = 1;
  // combo
  if (J.combo >= 5) {
    const p = vis > 0.5 ? ponto(G, 1.5, 0.16) : { x: W / 2, y: H * 0.37 }, quente = J.combo >= 30;
    g.font = `900 ${quente ? 30 : 24}px ${FONTE}`;
    g.lineWidth = 6; g.strokeStyle = 'rgba(10,4,30,.6)';
    const txt = J.combo + ' COMBO';
    g.strokeText(txt, p.x, p.y);
    if (quente) { const lg = g.createLinearGradient(0, p.y - 26, 0, p.y); lg.addColorStop(0, '#fff36b'); lg.addColorStop(1, '#ff7a1a'); g.fillStyle = lg; } else g.fillStyle = '#fff';
    g.fillText(txt, p.x, p.y);
  }
  // progresso da música
  const prog = Math.max(0, Math.min(1, t / J.p.duracao));
  g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(0, H - 4, W, 4);
  g.fillStyle = J.m.cor; g.fillRect(0, H - 4, W * prog, 4);
}

// ---------- a bateria de verdade ----------
// 6 peças: prato da esquerda (elevado), caixa, tom 1, tom 2, prato da direita (elevado) e o bumbo na frente.
// Cada nota é um anel que vai encolhendo em volta da peça: bata quando o anel encostar nela.
const KIT = ['pratoE', 'caixa', 'tom1', 'tom2', 'pratoD', 'bumbo'];
const PECA_KIT = { chimbal: 'pratoE', prato: 'pratoD', bumbo: 'bumbo', caixa: 'caixa', tom1: 'tom1', tom2: 'tom2' };
const COR_KIT = { pratoE: '#ffd23f', caixa: '#ff4d5e', tom1: '#2fdc6b', tom2: '#3aa0ff', pratoD: '#ff9a3d', bumbo: '#c38bff' };
const TECLA_KIT = { pratoE: 'S', caixa: 'D', tom1: 'F', tom2: 'J', pratoD: 'K', bumbo: '␣' };
const TECLAS_KIT = { s: 'pratoE', a: 'pratoE', d: 'caixa', f: 'tom1', j: 'tom2', k: 'pratoD', l: 'pratoD', ' ': 'bumbo', b: 'bumbo' };
function geoKit() {
  const u = Math.min(W * 0.86, H * 0.5);
  const cx = W / 2, base = H * 0.8;
  return {
    bumbo: { x: cx, y: base - u * 0.02, rx: u * 0.17, ry: u * 0.17, tipo: 'bumbo' },
    caixa: { x: cx - u * 0.33, y: base - u * 0.16, rx: u * 0.15, ry: u * 0.065, tipo: 'tambor', alt: u * 0.08 },
    tom1: { x: cx - u * 0.14, y: base - u * 0.34, rx: u * 0.11, ry: u * 0.05, tipo: 'tambor', alt: u * 0.07 },
    tom2: { x: cx + u * 0.14, y: base - u * 0.34, rx: u * 0.12, ry: u * 0.055, tipo: 'tambor', alt: u * 0.075 },
    pratoE: { x: cx - u * 0.38, y: base - u * 0.55, rx: u * 0.15, ry: u * 0.04, tipo: 'prato' },
    pratoD: { x: cx + u * 0.38, y: base - u * 0.55, rx: u * 0.16, ry: u * 0.043, tipo: 'prato' },
    chao: base + u * 0.2, u,
  };
}
function pecaNoPonto(x, y) {
  const K = geoKit(); let melhor = null, dm = Infinity;
  for (const p of KIT) {
    const P = K[p], ry = P.tipo === 'bumbo' ? P.ry : Math.max(P.ry, P.rx * 0.45);
    const d = Math.hypot((x - P.x) / P.rx, (y - P.y) / ry);
    if (d < dm) { dm = d; melhor = p; }
  }
  return dm < 2.2 ? melhor : null;
}
function desenharPeca(P, nome, aceso) {
  const cor = COR_KIT[nome];
  g.save();
  if (P.tipo === 'prato') {
    g.strokeStyle = '#8a8aa0'; g.lineWidth = 3;   // pedestal
    g.beginPath(); g.moveTo(P.x, P.y); g.lineTo(P.x, geoKit().chao - 10); g.stroke();
    g.beginPath(); g.moveTo(P.x - 16, geoKit().chao); g.lineTo(P.x, geoKit().chao - 14); g.lineTo(P.x + 16, geoKit().chao); g.stroke();
    const lg = g.createLinearGradient(P.x - P.rx, 0, P.x + P.rx, 0);
    lg.addColorStop(0, '#9b7a1e'); lg.addColorStop(0.45, aceso ? '#fff7c2' : '#ffd96a'); lg.addColorStop(1, '#a57d16');
    g.fillStyle = lg; g.beginPath(); g.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(80,50,0,.5)'; g.lineWidth = 1;
    for (const k of [0.35, 0.7]) { g.beginPath(); g.ellipse(P.x, P.y, P.rx * k, P.ry * k, 0, 0, 7); g.stroke(); }
    g.fillStyle = '#5a4210'; g.beginPath(); g.ellipse(P.x, P.y, 4, 2, 0, 0, 7); g.fill();
  } else if (P.tipo === 'tambor') {
    // corpo
    g.fillStyle = cor; g.beginPath();
    g.moveTo(P.x - P.rx, P.y); g.lineTo(P.x - P.rx, P.y + P.alt); g.ellipse(P.x, P.y + P.alt, P.rx, P.ry, 0, Math.PI, 0, true); g.lineTo(P.x + P.rx, P.y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(P.x - P.rx, P.y + P.alt * 0.15, P.rx * 2, P.alt * 0.12);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(P.x - P.rx * 0.8, P.y, P.rx * 0.22, P.alt);
    // pele
    g.fillStyle = aceso ? '#ffffff' : '#ece7f6'; g.strokeStyle = '#c9c4d6'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, 7); g.fill(); g.stroke();
  } else {   // bumbo, visto de frente
    g.fillStyle = '#1c1238'; g.beginPath(); g.arc(P.x, P.y, P.rx * 1.06, 0, 7); g.fill();
    g.fillStyle = cor; g.beginPath(); g.arc(P.x, P.y, P.rx, 0, 7); g.fill();
    const rg = g.createRadialGradient(P.x - P.rx * 0.3, P.y - P.rx * 0.3, 0, P.x, P.y, P.rx * 0.86);
    rg.addColorStop(0, aceso ? '#ffffff' : '#f6f2ff'); rg.addColorStop(1, aceso ? '#f1e6ff' : '#d8d0ea');
    g.fillStyle = rg; g.beginPath(); g.arc(P.x, P.y, P.rx * 0.86, 0, 7); g.fill();
    g.fillStyle = cor; g.font = `900 ${Math.round(P.rx * 0.32)}px ${FONTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.globalAlpha *= 0.55; g.fillText('♪', P.x, P.y + 2); g.textBaseline = 'alphabetic';
  }
  g.restore();
}
function anelPeca(P, k, cor, alfa, largura) {   // k = 1 no momento de bater
  g.save(); g.globalAlpha = alfa; g.strokeStyle = cor; g.lineWidth = largura;
  g.shadowColor = cor; g.shadowBlur = 10;
  const ry = P.tipo === 'bumbo' ? P.ry : P.ry;
  g.beginPath(); g.ellipse(P.x, P.y, P.rx * k + 4, ry * k + 4, 0, 0, 7); g.stroke(); g.restore();
}
function desenharKit(t, janela, peso, agora) {
  if (peso < 0.02) return;
  const K = geoKit();
  g.save(); g.globalAlpha = peso;
  // tapetinho
  g.fillStyle = 'rgba(10,4,30,.45)'; g.beginPath(); g.ellipse(W / 2, K.chao, K.u * 0.62, K.u * 0.09, 0, 0, 7); g.fill();
  const ordem = ['pratoE', 'pratoD', 'bumbo', 'tom1', 'tom2', 'caixa'];
  for (const p of ordem) desenharPeca(K[p], p, agora - (J.batida[p] || 0) < 110);
  // anéis das notas chegando
  const ap = janela * 0.85;
  for (let i = Math.max(0, J.prox - 6); i < J.notas.length; i++) {
    const n = J.notas[i]; if (n.t - t > ap) break;
    if (n.instr !== 'bateria' || n.st === 1) continue;
    const p = PECA_KIT[n.peca] || 'caixa', P = K[p], f = (n.t - t) / ap;   // 1 longe, 0 na hora
    if (f < -0.12) continue;
    if (n.st === 2) { anelPeca(P, 1, '#888', 0.5 * peso, 3); continue; }
    const k = 1 + Math.max(0, f) * (P.tipo === 'bumbo' ? 0.75 : 1.0);
    anelPeca(P, k, COR_KIT[p], peso * Math.min(1, (1 - f) * 2.5), f < 0.08 ? 6 : 4);
  }
  if (COMPUTADOR) {
    g.font = `900 13px ${FONTE}`; g.textAlign = 'center';
    for (const p of KIT) { const P = K[p], y = P.tipo === 'bumbo' ? P.y + P.ry + 18 : P.y - P.ry - 10;
      g.fillStyle = 'rgba(10,4,30,.7)'; g.beginPath(); g.roundRect(P.x - 12, y - 14, 24, 19, 5); g.fill();
      g.fillStyle = COR_KIT[p]; g.fillText(TECLA_KIT[p], P.x, y); }
  }
  g.restore();
}
function baterPeca(peca, ts = performance.now()) {
  if (!J || J.fim || fase !== 'jogo') return;
  J.batida[peca] = performance.now();
  const t = tempo(ts);
  if (t < -0.5) return;
  let alvo = null;
  for (let i = J.prox; i < J.notas.length; i++) {
    const n = J.notas[i];
    if (n.t - t > JANELA) break;
    if (n.st !== 0 || n.instr !== 'bateria' || (PECA_KIT[n.peca] || 'caixa') !== peca) continue;
    if (Math.abs(n.t - t) <= JANELA) { alvo = n; break; }
  }
  if (!alvo) { J.banda.errou('bateria'); quebrarCombo(); return; }
  acertar(alvo, Math.abs(alvo.t - t));
}
const modoBateria = () => J && pesosInstr(tempo()).w.bateria > 0.5;

// ---------- caixinhas do sabre ----------
const COR_SABRE = ['#ff4d5e', '#3aa0ff'], ESC_SABRE = ['#a3182a', '#1452a0'];
const SETA = { cima: -Math.PI / 2, baixo: Math.PI / 2, esq: Math.PI, dir: 0 };
const alvoSabre = lado => ({ x: W * (lado ? 0.73 : 0.27), y: H * 0.64, s: Math.min(W * 0.3, H * 0.17) });
function caixinha(x, y, tam, lado, dir, alfa, cinza) {
  g.save(); g.translate(x, y); g.globalAlpha = alfa;
  const r = tam * 0.18;
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.roundRect(-tam / 2 + tam * 0.05, -tam / 2 + tam * 0.08, tam, tam, r); g.fill();
  const lg = g.createLinearGradient(0, -tam / 2, 0, tam / 2);
  lg.addColorStop(0, cinza ? '#9a9aa6' : COR_SABRE[lado]); lg.addColorStop(1, cinza ? '#55555f' : ESC_SABRE[lado]);
  g.fillStyle = lg; g.beginPath(); g.roundRect(-tam / 2, -tam / 2, tam, tam, r); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = Math.max(1.5, tam * 0.04); g.stroke();
  // seta pra onde cortar
  g.rotate(SETA[dir]); g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(tam * 0.3, 0); g.lineTo(-tam * 0.05, -tam * 0.26); g.lineTo(-tam * 0.05, -tam * 0.1); g.lineTo(-tam * 0.28, -tam * 0.1);
  g.lineTo(-tam * 0.28, tam * 0.1); g.lineTo(-tam * 0.05, tam * 0.1); g.lineTo(-tam * 0.05, tam * 0.26); g.closePath(); g.fill();
  g.restore();
}
function desenharSabre(t, janela, peso, agora) {
  const temNota = J.notas.slice(Math.max(0, J.prox - 4), J.prox + 40).some(n => n.instr === 'sabre' && n.t - t < janela * 1.3 && n.t > t - 0.5);
  if (peso < 0.02 && !temNota) return;
  const vx = W / 2, vy = H * 0.2, s1 = esc_(1.3);
  const a0 = alvoSabre(0), chaoAlvo = a0.y + a0.s * 0.95;   // onde fica a sombra quando é hora de cortar
  const chaoDe = k => vy + (chaoAlvo - vy) * k;
  // o chão: linhas indo pro fundo + a linha de corte
  g.save(); g.globalAlpha = peso;
  const lgc = g.createLinearGradient(0, vy, 0, H); lgc.addColorStop(0, 'rgba(10,4,30,0)'); lgc.addColorStop(1, 'rgba(10,4,30,.55)');
  g.fillStyle = lgc; g.beginPath(); g.moveTo(vx - W * 0.04, vy); g.lineTo(vx + W * 0.04, vy); g.lineTo(W * 1.3, H); g.lineTo(-W * 0.3, H); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(vx + i * W * 0.012, vy); g.lineTo(vx + i * W * 0.32, H); g.stroke(); }
  // marcas de profundidade no ritmo (batidas chegando)
  const BT = J.p.batidas || [];
  for (let k = Math.max(0, bisseca(BT, t)); k < BT.length && BT[k] - t < janela * 1.3; k++) {
    const z = (BT[k] - t) / janela, kk = (esc_(z) - s1) / (1 - s1), y = chaoDe(kk), larg = W * (0.04 + 0.42 * kk);
    g.strokeStyle = `rgba(255,255,255,${0.05 + 0.1 * kk})`; g.beginPath(); g.moveTo(vx - larg, y); g.lineTo(vx + larg, y); g.stroke();
  }
  g.shadowColor = '#fff'; g.shadowBlur = 14; g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(W * 0.04, chaoAlvo); g.lineTo(W * 0.96, chaoAlvo); g.stroke();
  g.restore();
  for (const lado of [0, 1]) {
    const a = alvoSabre(lado);
    g.save(); g.globalAlpha = 0.22 * peso; g.strokeStyle = COR_SABRE[lado]; g.lineWidth = 3;
    g.beginPath(); g.roundRect(a.x - a.s / 2, a.y - a.s / 2, a.s, a.s, a.s * 0.18); g.stroke(); g.restore();
    if (COMPUTADOR && peso > 0.3) {
      g.save(); g.globalAlpha = peso; g.font = `900 14px ${FONTE}`; g.textAlign = 'center';
      g.fillStyle = 'rgba(10,4,30,.7)'; g.beginPath(); g.roundRect(a.x - 46, a.y + a.s / 2 + 10, 92, 22, 6); g.fill();
      g.fillStyle = COR_SABRE[lado]; g.fillText(lado ? '← ↑ ↓ →' : 'W A S D', a.x, a.y + a.s / 2 + 26); g.restore();
    }
  }
  const lista = [];
  for (let i = Math.max(0, J.prox - 8); i < J.notas.length; i++) {
    const n = J.notas[i]; if (n.t - t > janela * 1.3) break;
    if (n.instr !== 'sabre' || n.st === 1) continue;
    lista.push(n);
  }
  for (let i = lista.length - 1; i >= 0; i--) {
    const n = lista[i], z = (n.t - t) / janela, a = alvoSabre(n.lado);
    if (z < -0.45) continue;
    const k = Math.max(-0.6, (esc_(Math.max(-0.3, z)) - s1) / (1 - s1));   // 0 lá no fundo, 1 no alvo
    let x = vx + (a.x - vx) * k, y = vy + (a.y - vy) * k;
    if (n.st === 2) y += (t - n.t) * 900 * Math.max(0, t - n.t);   // errou: cai
    const tam = a.s * (0.25 + 0.75 * Math.max(0, Math.min(1.25, k)));
    const alfa = Math.min(1, (1.3 - z) * 3) * (z < 0 ? Math.max(0, 1 + z * 2.2) : 1);
    if (n.st !== 2) {   // sombra no chão: quando ela encosta na linha, é hora de cortar
      const ys = chaoDe(Math.max(0, k));
      g.save(); g.globalAlpha = alfa * 0.55; g.fillStyle = '#000';
      g.beginPath(); g.ellipse(x, ys, tam * 0.5, tam * 0.13, 0, 0, 7); g.fill(); g.restore();
    }
    caixinha(x, y, tam, n.lado, n.dir, alfa, n.st === 2);
  }
}
function efeitoSabre(e, agora) {
  const k = (agora - e.ini) / 650, a = alvoSabre(e.lado);
  if (!e.errado && k < 0.6) {   // a caixinha partida em dois pedaços voando
    const ang = SETA[e.dir] + Math.PI / 2, sep = k * a.s * 1.1;
    g.save(); g.globalAlpha = 1 - k / 0.6;
    for (const sg of [-1, 1]) {
      g.save(); g.translate(a.x + Math.cos(ang) * sep * sg, a.y + Math.sin(ang) * sep * sg + k * k * 300);
      g.rotate(sg * k * 2); g.fillStyle = COR_SABRE[e.lado];
      g.beginPath(); g.roundRect(-a.s * 0.4, -a.s * 0.2, a.s * 0.8, a.s * 0.4, 8); g.fill(); g.restore();
    }
    // o risco do corte
    const ang2 = SETA[e.dir], L = a.s * 0.9;
    g.strokeStyle = '#fff'; g.lineWidth = 5 * (1 - k); g.lineCap = 'round'; g.shadowColor = COR_SABRE[e.lado]; g.shadowBlur = 18;
    g.beginPath(); g.moveTo(a.x - Math.cos(ang2) * L, a.y - Math.sin(ang2) * L); g.lineTo(a.x + Math.cos(ang2) * L, a.y + Math.sin(ang2) * L); g.stroke();
    g.restore();
  }
  if (!e.txt) return;
  const y = a.y - a.s * 0.75 - k * 34, tam = e.txt === 'PERFEITO!' ? 19 : 17;
  g.globalAlpha = Math.min(1, (1 - k) * 2); g.textAlign = 'center';
  g.font = `900 ${tam}px ${FONTE}`; g.lineWidth = 5; g.strokeStyle = 'rgba(10,4,30,.75)'; g.strokeText(e.txt, a.x, y);
  g.fillStyle = e.cor; g.fillText(e.txt, a.x, y); g.globalAlpha = 1;
}

// a bateria: 4 peças (bumbo, caixa, chimbal, prato) no lugar dos alvos
function desenharBateria(G, rAlvo) {
  for (let tr = 0; tr < 4; tr++) {
    const p = ponto(G, tr, 0), ap = J.apertado[tr], prato = tr === 3, chimbal = tr === 2;
    const r = rAlvo * (tr === 0 ? 1.12 : 1);
    g.save(); g.translate(p.x, p.y);
    if (!prato && !chimbal) {   // casco do tambor
      const cg = g.createLinearGradient(-r, 0, r, 0);
      cg.addColorStop(0, ESCURAS[tr]); cg.addColorStop(0.45, CORES[tr]); cg.addColorStop(1, ESCURAS[tr]);
      g.fillStyle = cg; g.fillRect(-r, 0, r * 2, r * 0.55);
      g.beginPath(); g.ellipse(0, r * 0.55, r, r * 0.58 * 0.6, 0, 0, Math.PI); g.fill();
    }
    g.scale(1, prato || chimbal ? 0.42 : 0.58);
    if (prato || chimbal) {   // pratos dourados
      const pg = g.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.1);
      pg.addColorStop(0, ap ? '#fff6c8' : '#ffe58a'); pg.addColorStop(0.7, '#d9a520'); pg.addColorStop(1, '#8a6410');
      g.fillStyle = pg; g.beginPath(); g.arc(0, 0, r * 1.05, 0, 7); g.fill();
      g.strokeStyle = 'rgba(120,80,10,.45)'; g.lineWidth = 1.5;
      for (const k of [0.35, 0.6, 0.85]) { g.beginPath(); g.arc(0, 0, r * k, 0, 7); g.stroke(); }
      g.fillStyle = '#5a4108'; g.beginPath(); g.arc(0, 0, r * 0.12, 0, 7); g.fill();
    } else {   // pele do tambor com aro de metal
      g.fillStyle = '#c9ced8'; g.beginPath(); g.arc(0, 0, r * 1.04, 0, 7); g.fill();
      g.fillStyle = ap ? CORES[tr] : '#f4eee2'; g.beginPath(); g.arc(0, 0, r * 0.9, 0, 7); g.fill();
      g.strokeStyle = CORES[tr]; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, r * 0.62, 0, 7); g.stroke();
    }
    g.restore();
  }
}
// o teclado: 4 teclas brancas com teclas pretas entre elas
function desenharTeclado(G, rAlvo, zBaixo) {
  for (let tr = 0; tr < 4; tr++) {
    const a = ponto(G, tr - 0.47, 0.05), b = ponto(G, tr + 0.47, 0.05), c = ponto(G, tr + 0.47, zBaixo), d = ponto(G, tr - 0.47, zBaixo);
    const ap = J.apertado[tr] || J.segurando[tr];
    const lg = g.createLinearGradient(0, a.y, 0, c.y);
    lg.addColorStop(0, ap ? CORES[tr] : '#ffffff'); lg.addColorStop(1, ap ? ESCURAS[tr] : '#d9d4e8');
    g.fillStyle = lg; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
    g.fillStyle = CORES[tr]; g.fillRect(a.x, a.y - 3, b.x - a.x, 6);   // risquinho colorido na beira da tecla
  }
  for (let i = 1; i < 4; i++) {   // teclas pretas
    if (i === 2) continue;
    const a = ponto(G, i - 0.5 - 0.14, 0.05), b = ponto(G, i - 0.5 + 0.14, 0.05), c = ponto(G, i - 0.5 + 0.14, -0.06), d = ponto(G, i - 0.5 - 0.14, -0.06);
    g.fillStyle = '#16122a'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
  }
}
function joia(x, y, r, tr, tipo, agora = 0, instr = 'guitarra') {
  if (r < 0.5) return;
  if (instr === 'bateria' && tipo !== 'erro') {   // nota de bateria: um tamborzinho (ou prato)
    g.save(); g.translate(x, y); g.scale(1, 0.5);
    if (tr >= 2) {
      const pg = g.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      pg.addColorStop(0, '#fff6c8'); pg.addColorStop(1, '#c9921a');
      g.fillStyle = pg; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.strokeStyle = CORES[tr]; g.lineWidth = Math.max(2, r * 0.2); g.stroke();
    } else {
      g.fillStyle = ESCURAS[tr]; g.beginPath(); g.arc(0, r * 0.35, r, 0, 7); g.fill();
      g.fillStyle = '#f4eee2'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
      g.strokeStyle = CORES[tr]; g.lineWidth = Math.max(2, r * 0.28); g.stroke();
    }
    if (tipo === 'estrela') { g.fillStyle = '#8fe6ff'; g.beginPath(); g.arc(0, 0, r * 0.3, 0, 7); g.fill(); }
    g.restore(); return;
  }
  if (instr === 'teclado' && tipo !== 'erro') {   // nota de teclado: uma barrinha
    g.save(); g.translate(x, y);
    const w = r * 1.9, h = r * 0.75;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.roundRect(-w / 2, -h / 2 + 3, w, h, h * 0.4); g.fill();
    const lg = g.createLinearGradient(0, -h / 2, 0, h / 2);
    lg.addColorStop(0, tipo === 'estrela' ? '#e8fbff' : '#ffffff'); lg.addColorStop(1, CORES[tr]);
    g.fillStyle = lg; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, h * 0.4); g.fill();
    g.strokeStyle = ESCURAS[tr]; g.lineWidth = Math.max(1.5, r * 0.12); g.stroke();
    g.restore(); return;
  }
  g.save(); g.translate(x, y); g.scale(1, 0.6);
  const erro = tipo === 'erro', estrela = tipo === 'estrela';
  const cor = erro ? '#6b6b78' : CORES[tr], esc2 = erro ? '#3a3a44' : ESCURAS[tr];
  g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(0, r * 0.32, r * 1.02, 0, 7); g.fill();
  g.fillStyle = esc2; g.beginPath(); g.arc(0, r * 0.16, r, 0, 7); g.fill();       // lateral da joia
  const rg = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
  if (estrela) { rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.6, '#d9f8ff'); rg.addColorStop(1, '#8fe6ff'); }
  else { rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.25, cor); rg.addColorStop(1, esc2); }
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.lineWidth = Math.max(1, r * 0.1); g.strokeStyle = estrela ? cor : 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(0, 0, r * 0.93, 0, 7); g.stroke();
  // miolo
  g.fillStyle = erro ? '#555' : estrela ? cor : '#fff';
  g.beginPath(); g.arc(0, 0, r * 0.3, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(-r * 0.32, -r * 0.42, r * 0.3, r * 0.14, -0.35, 0, 7); g.fill();
  if (estrela) { // brilho girando
    g.rotate(agora / 400); g.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.beginPath(); g.moveTo(0, -r * 1.35); g.lineTo(r * 0.09, -r * 1.05); g.lineTo(-r * 0.09, -r * 1.05); g.closePath(); g.fill(); }
  }
  g.restore();
}

// fundo do menu: palco com notinhas descendo devagar
const menuNotas = Array.from({ length: 14 }, (_, i) => ({ tr: i % 4, z: i / 14 }));
function desenharMenu(dt, t) {
  fundo(t, false, 0.2);
  const G = geo();
  for (const n of menuNotas) {
    n.z -= dt * 0.18; if (n.z < -0.1) { n.z = 1; n.tr = Math.floor(Math.random() * 4); }
    const p = ponto(G, n.tr, n.z);
    g.globalAlpha = 0.3; joia(p.x, p.y, G.larg / 4 * 0.33 * p.s, n.tr, ''); g.globalAlpha = 1;
  }
}
ajustarTela();


// ---------- fim da música: o boneco comemora com a guitarra pro alto, confete e fogos ----------
const FESTA = { ini: 0, animo: 1, confete: [], fogos: [] };
function comecarFesta(animo) {
  FESTA.ini = performance.now(); FESTA.animo = animo; FESTA.confete = []; FESTA.fogos = [];
  const cores = ['#2fdc6b', '#ff4d5e', '#ffd23f', '#3aa0ff', '#ff3d8b', '#ffffff'];
  for (let i = 0; i < 90 * animo + 20; i++) FESTA.confete.push({ x: Math.random() * W, y: -Math.random() * H * 0.8, v: 60 + Math.random() * 120, a: Math.random() * 7, va: (Math.random() - .5) * 8, c: cores[i % 6], w: 5 + Math.random() * 5 });
}
function desenharFesta(dt, t) {
  fundo(t, false, FESTA.animo);
  const k = (performance.now() - FESTA.ini) / 1000;
  // fogos de artifício
  if (FESTA.animo >= 0.6 && Math.random() < dt * 2.2 * FESTA.animo) {
    const x = W * (0.15 + Math.random() * 0.7), y = H * (0.08 + Math.random() * 0.22), c = CORES[Math.floor(Math.random() * 4)];
    for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2; FESTA.fogos.push({ x, y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, ini: performance.now(), c }); }
  }
  FESTA.fogos = FESTA.fogos.filter(f => performance.now() - f.ini < 900);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const f of FESTA.fogos) {
    const q = (performance.now() - f.ini) / 1000;
    g.globalAlpha = 1 - q / 0.9; g.fillStyle = f.c;
    g.beginPath(); g.arc(f.x + f.vx * q, f.y + f.vy * q + 60 * q * q, 2.6, 0, 7); g.fill();
  }
  g.restore(); g.globalAlpha = 1;
  // o boneco, em cima do palco
  if (DANC.img) {
    const S = Math.min(112, H * 0.13, W * 0.28), cx = W / 2, pe = Math.min(H * 0.4, 330) - 14;
    const per = 0.42, f = (t / per) % 1, n = Math.floor(t / per), an = FESTA.animo;
    const pulo = Math.abs(Math.sin(f * Math.PI)) * S * 0.3 * an;
    const entra = Math.min(1, k / 0.5);   // sobe no palco no começo
    g.save();
    const rg = g.createRadialGradient(cx, pe, 0, cx, pe, S * 1.3);
    rg.addColorStop(0, 'rgba(255,255,255,.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.ellipse(cx, pe, S * 1.3, S * 0.25, 0, 0, 7); g.fill();
    g.translate(cx, pe - pulo + (1 - entra) * S * 2); g.rotate(Math.sin(f * Math.PI * 2) * 0.08 * an);
    const pern = S * 0.42, tronco = S * 0.42, larg = S * 0.5, topo = -pern - tronco;
    const abre = an > 0.3 ? Math.sin(f * Math.PI) * S * 0.08 : 0;
    g.lineCap = 'round'; g.lineWidth = S * 0.13; g.strokeStyle = '#2b1d5c';
    g.beginPath(); g.moveTo(-larg * 0.22, -pern); g.lineTo(-larg * 0.34 - abre, -S * 0.04); g.stroke();
    g.beginPath(); g.moveTo(larg * 0.22, -pern); g.lineTo(larg * 0.34 + abre, -S * 0.04); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(-larg * 0.34 - abre - S * 0.03, -S * 0.03, S * 0.1, S * 0.05, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(larg * 0.34 + abre + S * 0.03, -S * 0.03, S * 0.1, S * 0.05, 0, 0, 7); g.fill();
    g.fillStyle = DANC.roupa;
    g.beginPath(); g.moveTo(-larg / 2, topo); g.lineTo(larg / 2, topo); g.lineTo(larg * 0.4, -pern + S * 0.02); g.lineTo(-larg * 0.4, -pern + S * 0.02); g.closePath(); g.fill();
    // braços pra cima (o direito segura a guitarra lá no alto)
    const aceno = Math.sin(t * 9) * S * 0.06 * an;
    const maoE = [-S * 0.55 - aceno, topo - S * (0.25 + 0.35 * an)], maoD = [S * 0.5, topo - S * (0.3 + 0.4 * an)];
    g.lineWidth = S * 0.11; g.strokeStyle = DANC.roupa;
    g.beginPath(); g.moveTo(-larg * 0.45, topo + S * 0.05); g.quadraticCurveTo(-larg * 0.9, topo - S * 0.05, maoE[0], maoE[1]); g.stroke();
    g.beginPath(); g.moveTo(larg * 0.45, topo + S * 0.05); g.quadraticCurveTo(larg * 0.9, topo - S * 0.05, maoD[0], maoD[1]); g.stroke();
    g.save(); g.translate(maoD[0], maoD[1]); g.rotate(-0.55 + Math.sin(t * 6) * 0.1 * an);
    g.fillStyle = '#3a2a1a'; g.fillRect(-S * 0.05, -S * 0.035, S * 0.6, S * 0.07);
    g.fillStyle = '#1a1208'; g.fillRect(S * 0.52, -S * 0.06, S * 0.13, S * 0.12);
    g.fillStyle = '#e8304a'; g.beginPath(); g.ellipse(-S * 0.18, 0, S * 0.2, S * 0.16, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(-S * 0.02, 0, S * 0.13, S * 0.11, 0, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-S * 0.2, 0, S * 0.05, S * 0.12, 0, 0, 7); g.fill();
    g.restore();
    g.fillStyle = DANC.pele;
    g.beginPath(); g.arc(maoE[0], maoE[1], S * 0.07, 0, 7); g.fill();
    g.beginPath(); g.arc(maoD[0], maoD[1], S * 0.07, 0, 7); g.fill();
    g.translate(0, topo + S * 0.08); g.rotate(Math.sin(f * Math.PI * 2) * 0.12 * an);
    g.drawImage(DANC.img, -S / 2, -S * 0.98, S, S);
    g.restore();
  }
  // confete
  for (const c of FESTA.confete) {
    c.y += c.v * dt; c.a += c.va * dt; c.x += Math.sin(c.a) * 20 * dt;
    if (c.y > H + 10 && k < 6) { c.y = -10; c.x = Math.random() * W; }
    g.save(); g.translate(c.x, c.y); g.rotate(c.a); g.fillStyle = c.c; g.fillRect(-c.w / 2, -c.w / 4, c.w, c.w / 2); g.restore();
  }
}

// ---------- laço ----------
let ultimo = performance.now();
function laco(agora) {
  const dt = Math.min(0.05, (agora - ultimo) / 1000); ultimo = agora;
  g.clearRect(0, 0, W, H);
  if (fase === 'jogo' && J) { passo(); desenharJogo(); }
  else if (fase === 'fim' && J) desenharFesta(dt, agora / 1000);
  else desenharMenu(dt, agora / 1000);
  requestAnimationFrame(laco);
}
requestAnimationFrame(laco);

// ---------- controles ----------
// sem zoom de pinça nem de toque duplo (os gestos do sabre e da bateria atrapalhariam)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1 || fase === 'jogo') e.preventDefault(); }, { passive: false });
let ultimoToque = 0;
document.addEventListener('touchend', e => { const a = Date.now(); if (fase === 'jogo' && a - ultimoToque < 350) e.preventDefault(); ultimoToque = a; }, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault());
const dedos = new Map();
const golpes = new Map();   // dedos fazendo o movimento de corte (sabre)
cv.addEventListener('pointerdown', e => {
  if (fase !== 'jogo') return;
  e.preventDefault();
  if (modoBateria()) {
    const r = cv.getBoundingClientRect(), p = pecaNoPonto(e.clientX - r.left, e.clientY - r.top);
    if (p) baterPeca(p, e.timeStamp || performance.now());
    return;
  }
  if (modoSabre()) {
    golpes.set(e.pointerId, { x: e.clientX, y: e.clientY, ts: e.timeStamp || performance.now(), feito: false });
    try { cv.setPointerCapture(e.pointerId); } catch {}
    return;
  }
  const tr = trilhaDoX(e.clientX); dedos.set(e.pointerId, tr);
  try { cv.setPointerCapture(e.pointerId); } catch {}
  pressionar(tr, e.timeStamp || performance.now());
});
const largou = e => { golpes.delete(e.pointerId); const tr = dedos.get(e.pointerId); if (tr == null) return; dedos.delete(e.pointerId); if (![...dedos.values()].includes(tr)) soltar(tr); };
cv.addEventListener('pointerup', largou); cv.addEventListener('pointercancel', largou);
// glissando: arrastou o dedo pra trilha do lado = tocou ela (como deslizar no teclado de um piano).
// Passar por uma trilha sem nota não conta como erro, então dá pra "varrer" as sequências rápidas.
cv.addEventListener('pointermove', e => {
  const gp = golpes.get(e.pointerId);
  if (gp && fase === 'jogo') {   // sabre: arrastou o dedo uns 25 px = cortou naquela direção
    const dx = e.clientX - gp.x, dy = e.clientY - gp.y;
    if (Math.hypot(dx, dy) < 25) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'dir' : 'esq') : (dy > 0 ? 'baixo' : 'cima');
    const agoraTs = e.timeStamp || performance.now();
    cortar(gp.x < cv.getBoundingClientRect().left + cv.clientWidth / 2 ? 0 : 1, dir, (gp.ts + agoraTs) / 2);
    golpes.set(e.pointerId, { x: e.clientX, y: e.clientY, ts: agoraTs });   // dá pra emendar outro corte sem tirar o dedo
    return;
  }
  if (fase !== 'jogo' || !dedos.has(e.pointerId)) return;
  const antes = dedos.get(e.pointerId), agora = trilhaDoX(e.clientX);
  if (agora === antes) return;
  dedos.set(e.pointerId, agora);
  if (![...dedos.values()].includes(antes)) soltar(antes);
  const passo = agora > antes ? 1 : -1;
  for (let tr = antes + passo; ; tr += passo) {   // se pulou trilhas no meio do caminho, toca elas também
    pressionar(tr, e.timeStamp || performance.now(), true);
    if (tr === agora) break;
    if (![...dedos.values()].includes(tr)) soltar(tr);
  }
});
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (fase === 'jogo') {
    if (TECLAS_KIT[e.key === ' ' ? ' ' : k] && modoBateria()) {
      e.preventDefault(); if (e.repeat) return;
      baterPeca(TECLAS_KIT[e.key === ' ' ? ' ' : k], e.timeStamp || performance.now());
      return;
    }
    if (k === 'e') soltarEnergia();
    if (TECLAS_SABRE[k] && modoSabre()) {
      e.preventDefault(); if (e.repeat) return;
      cortar(TECLAS_SABRE[k][0], TECLAS_SABRE[k][1], e.timeStamp || performance.now());
      return;
    }
    const tr = TECLAS[k];
    if (tr != null || k === ' ') e.preventDefault();   // setas e espaço não rolam a página
    if (e.repeat) return;
    if (tr != null) pressionar(tr, e.timeStamp || performance.now());
    if (k === ' ') soltarEnergia();
    if (k === 'escape') $('btnSairJogo').click();
    return;
  }
  // nos menus: Enter confirma o botão principal da tela
  if (k !== 'enter' || ['INPUT', 'BUTTON', 'A'].includes(document.activeElement && document.activeElement.tagName)) return;
  const principal = { telaMusicas: 'btnTocarSolo', telaFim: 'btnDeNovo', telaComo: 'btnComoOk', telaAtraso: 'btnAtrasoOk', telaSala: 'btnComecar' };
  const tela = Object.keys(principal).find(t => !$(t).hidden);
  if (tela && !$(principal[tela]).hidden) { e.preventDefault(); $(principal[tela]).click(); }
});
addEventListener('keyup', e => { const tr = TECLAS[e.key.toLowerCase()]; if (tr != null) soltar(tr); });
$('btnEnergia').onclick = () => soltarEnergia();

// ======================= fim da música =======================
function estrelasDe(pct) { return pct >= 0.95 ? 5 : pct >= 0.85 ? 4 : pct >= 0.7 ? 3 : pct >= 0.5 ? 2 : 1; }
function terminar() {
  J.fim = true; fase = 'fim';
  J.segurando.forEach((s, tr) => { if (s) soltar(tr); });
  setTimeout(() => { if (J && J.fim) J.banda.parar(); }, 1500);
  const pts = Math.round(J.pontos), chave = J.m.id + ':' + J.dif;
  J.novoRecorde = pts > (recordes[chave] || 0);
  if (J.novoRecorde) { recordes[chave] = pts; guardar('ph-rec', recordes); }
  if (J.online) {
    const r = { s: pts, a: J.acertos, n: J.notas.length, mc: J.maxCombo, d: J.dif, r: J.rodada, t: rede.agora() };
    rede.enviarResultado(M.code, r).catch(() => {});
    rede.enviarEstado(M.code, { s: pts, c: 0, a: J.acertos, d: J.dif, e: 0, r: J.rodada }).catch(() => {});
  }
  desenharFim(); mostrar('telaFim');
  const est = estrelasDe(J.acertos / J.notas.length);
  const animo = [0.25, 0.45, 0.75, 0.9, 1][est - 1];
  comecarFesta(animo); $('telaFim').classList.toggle('fraco', est <= 2);
  $('tcharan').textContent = est <= 2 ? 'Ufa, acabou!' : 'TCHARAN!';
  $('tcharan').style.animation = 'none'; void $('tcharan').offsetWidth; $('tcharan').style.animation = '';
  tcharanSom(est);
  if (!J.online) ganharXP(est >= 3 ? 5 : 2);
}
function desenharFim() {
  if (!J) return;
  const pct = J.acertos / J.notas.length, est = estrelasDe(pct);
  $('fimEstrelas').innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="${i <= est ? '' : 'apagada'}">⭐</span>`).join('');
  $('fimMeu').innerHTML = `<div class="grandao"><b>${Math.round(J.pontos).toLocaleString('pt-BR')}</b>pontos${J.novoRecorde ? ' · 🏆 recorde!' : ''}</div>
    <div><b>${Math.round(pct * 100)}%</b>acertos</div><div><b>${J.maxCombo}</b>maior combo</div>`;
  const frases = ['Melhor voltar pro chuveiro 🚿', 'Dá pra melhorar! 😅', 'Mandou bem! 🎸', 'Que show! 🤘', 'LENDA DO ROCK! 🔥'];
  if (!J.online) {
    $('fimTitulo').textContent = frases[est - 1];
    $('fimLista').innerHTML = `<p class="peq">${esc(J.m.emoji + ' ' + J.m.nome)} · ${DIFS[J.dif].emoji} ${DIFS[J.dif].nome}</p>`;
    $('btnDeNovo').hidden = false; $('btnOutra').hidden = false; $('fimEspera').hidden = true;
    return;
  }
  const res = M.partida.resultado || {}, est2 = M.partida.estado || {};
  const valeu = id => res[id] && res[id].r === J.rodada ? res[id] : null;
  const pontosDe = id => (valeu(id) || (est2[id] && est2[id].r === J.rodada ? est2[id] : {})).s || 0;
  const ordem = [...J.ids].sort((a, b) => pontosDe(b) - pontosDe(a));
  const todos = J.ids.every(id => valeu(id) || !(M.players[id] && M.players[id].online));
  const v = ordem[0], eu = rede.meuId();
  $('fimTitulo').textContent = !todos ? '🎶 Esperando o resto da banda…' : v === eu ? '🏆 Você venceu!' : `🏆 ${(M.players[v] && M.players[v].name) || 'Alguém'} venceu!`;
  if (todos && !J.xpDado) { J.xpDado = true; ganharXP(v === eu ? 10 : 3); if (v === eu) som1([523, 659, 784, 1046]); }
  $('fimLista').innerHTML = ordem.map((id, i) => {
    const p = M.players[id] || {}, r = valeu(id);
    const info = r ? `${pontosDe(id).toLocaleString('pt-BR')} pts<br>${DIFS[r.d] ? DIFS[r.d].emoji : ''} ${Math.round(r.a / r.n * 100)}% · combo ${r.mc}` : `${pontosDe(id).toLocaleString('pt-BR')} pts<br>tocando…`;
    return `<div class="jog ${i === 0 && todos ? 'vence' : ''} ${p.online ? '' : 'off'}"><div class="av">${bonecoSVG(p.look, 44) || '🙂'}</div>${esc(p.name || '?')}<small>${info}</small></div>`;
  }).join('');
  $('btnDeNovo').hidden = !M.host; $('btnOutra').hidden = !M.host; $('fimEspera').hidden = M.host;
}

// ======================= sozinho =======================
async function prepararMusica(id) {
  if (!MUSICAS.some(x => x.id === id)) {   // música extra e este celular ainda não tem a senha
    await extras.atualizar().catch(() => {});
    if (!MUSICAS.some(x => x.id === id)) { toast('Essa é uma música extra: digite a senha 🔒', 3500); abrirExtras(); return false; }
  }
  const m = musicaPorId(id);
  if (carregada(m)) return true;
  toast(m.extra ? 'Baixando a música… 🎧' : 'Carregando a música… 🎧', 60000);
  try {
    await carregar(audio(), m, f => toast(`Baixando a música… ${Math.round(f * 100)}% 🎧`, 60000));
    $('toast').hidden = true; return true;
  } catch (e) { console.warn(e); toast('Não consegui carregar a música 😕', 3000); return false; }
}
async function comecarSolo() {
  M.code = null;
  if (!(await prepararMusica(escolha.musica))) return;
  novaPartida({ musica: escolha.musica, dif: escolha.dif, inicioPerf: performance.now() + 1500, online: false, instr: escolha.instr });
}

// ======================= salas =======================
const linkSala = code => location.origin + location.pathname + '?sala=' + code + (rede.LOCAL ? '&local=1' : '');
async function criarSala() {
  if (PREVIA) { toast('Aqui é só a prévia 🙂 As salas funcionam no jogo publicado.', 3200); return; }
  if (!(await garantirNome())) return;
  try {
    await rede.conectar();
    const code = await rede.criarSala();
    await rede.atualizarMeta(code, { musica: escolha.musica });
    await entrar(code);
  } catch (e) { toast('Não deu pra criar a sala: ' + (e.message || e), 3000); }
}
async function garantirNome() {
  if (PERFIL.tag) return true;
  const n = $('nome').value.trim();
  if (n.length < 2) { $('nome').hidden = false; $('nome').focus(); toast('Escreve seu nome primeiro 🙂'); return false; }
  try { localStorage.setItem('ph-nome', n); } catch {}
  return true;
}
async function entrar(code) {
  if (PREVIA) { toast('Aqui é só a prévia 🙂 As salas funcionam no jogo publicado.', 3200); return; }
  code = (code || '').toUpperCase().trim();
  if (!/^[A-Z]{4}$/.test(code)) { toast('O código tem 4 letras'); return; }
  if (!(await garantirNome())) return;
  try {
    await rede.conectar();
    const meta = await rede.lerMeta(code);
    if (!meta) { toast('Não achei essa sala 🤔'); return; }
    if (M.sair) M.sair();
    M.code = code; M.rodadaVista = meta.status === 'playing' ? meta.rodada : 0;
    try { history.replaceState(null, '', '?sala=' + code + (rede.LOCAL ? '&local=1' : '')); } catch {}
    M.sair = await rede.entrarSala(code, publico(), st => { M.meta = st.meta; M.players = st.players; atualizouSala(); });
    if (M.sairPartida) M.sairPartida();
    M.sairPartida = rede.ouvirPartida(code, st => { M.partida = st; if (fase === 'fim') desenharFim(); });
    fase = 'sala'; mostrar('telaSala'); desenharSala();
    if (meta.status === 'playing') toast('A música já começou: você entra na próxima 😉', 3000);
  } catch (e) { toast('Não deu pra entrar: ' + (e.message || e), 3000); }
}
function sairSala() {
  if (J && J.banda) J.banda.parar();
  if (M.sair) M.sair(); if (M.sairPartida) M.sairPartida();
  Object.assign(M, { code: null, meta: null, players: {}, sair: null, sairPartida: null });
  J = null; fase = 'inicio';
  try { history.replaceState(null, '', location.pathname + (rede.LOCAL ? '?local=1' : '')); } catch {}
  desenharEu(); mostrar('telaInicio');
}
function atualizouSala() {
  const meta = M.meta; if (!meta) return;
  M.host = meta.host === rede.meuId();
  // o anfitrião caiu? quem estiver na sala assume
  const hostOn = M.players[meta.host] && M.players[meta.host].online;
  if (!hostOn && !M.host && M.players[rede.meuId()]) {
    const on = Object.entries(M.players).filter(([, p]) => p.online).map(([id]) => id).sort();
    if (on[0] === rede.meuId()) rede.atualizarMeta(M.code, { host: rede.meuId() }).catch(() => {});
  }
  if (meta.status === 'playing' && meta.rodada !== M.rodadaVista) {
    M.rodadaVista = meta.rodada;
    if ((meta.ids || []).includes(rede.meuId())) {
      prepararMusica(meta.musica).then(ok => { if (ok && M.code) novaPartida({ musica: meta.musica, dif: escolha.dif, inicioPerf: performance.now() + (meta.inicio - rede.agora()), online: true, ids: meta.ids, rodada: meta.rodada, instr: meta.instr || null }); });
      return;
    }
  }
  if (fase === 'sala') desenharSala();
  if (fase === 'jogo' && J && J.online && document.querySelectorAll('#rivais .rival').length !== J.ids.length - 1) montarRivais();
  if (fase === 'fim') desenharFim();
}
function desenharSala() {
  $('salaCodigo').textContent = M.code;
  const lista = Object.entries(M.players).filter(([, p]) => p.online);
  $('listaJog').innerHTML = lista.map(([id, p]) => `<div class="jog"><div class="av">${bonecoSVG(p.look, 44) || '🙂'}</div>${esc(p.name)}<small>${DIFS[p.dif] ? DIFS[p.dif].emoji + ' ' + DIFS[p.dif].nome : ''}${id === (M.meta && M.meta.host) ? '<br>👑 anfitrião' : ''}</small></div>`).join('')
    + (lista.length < 2 ? '<p class="peq">Mande o convite pra alguém entrar 👆</p>' : '');
  const musica = (M.meta && M.meta.musica) || 'laje';
  const conheco = MUSICAS.some(x => x.id === musica);
  if (conheco && !carregada(musicaPorId(musica))) carregar(audio(), musicaPorId(musica)).catch(() => {});   // já vai baixando
  $('quemEscolhe').textContent = M.host ? '(você escolhe)' : '(quem criou escolhe)';
  desenharMusicas($('listaMusicasSala'), musica, M.host ? id => rede.atualizarMeta(M.code, { musica: id }).catch(() => {}) : null, escolha.dif);
  if (!conheco) $('listaMusicasSala').insertAdjacentHTML('afterbegin', '<button class="musica on" disabled><span class="em">🔒</span><span><b>Música extra</b><small>Toque em "Músicas extras" e digite a senha</small></span></button>');
  const cfgSala = { ...INSTR_PADRAO, ...((M.meta && M.meta.instr) || (M.host ? escolha.instr : {})) };
  $('instrQuem').textContent = M.host ? '(você escolhe, vale pra todos)' : '(quem criou escolhe)';
  desenharInstr($('instrSala'), cfgSala, M.host ? cfg => { escolha.instr = cfg; guardar('ph-escolha', escolha); rede.atualizarMeta(M.code, { instr: cfg }).catch(() => {}); } : null);
  desenharDifs($('difSala'), escolha.dif, id => { escolha.dif = id; guardar('ph-escolha', escolha); rede.atualizarEu(M.code, { dif: id }).catch(() => {}); desenharSala(); });
  $('btnComecar').hidden = !M.host;
  $('salaEspera').hidden = M.host;
}
async function comecarOnline() {
  if (!M.host) return;
  const ids = Object.entries(M.players).filter(([, p]) => p.online).map(([id]) => id);
  if (ids.length < 1) return;
  await rede.limparPartida(M.code).catch(() => {});
  await rede.atualizarMeta(M.code, { status: 'playing', rodada: (M.meta.rodada || 0) + 1, musica: M.meta.musica || 'laje', instr: M.meta.instr || escolha.instr, inicio: rede.agora() + 4000, ids });
}

// XP vai pro mesmo nível do boneco (o perfil é um só pra todos os jogos)
async function ganharXP(n) {
  if (!PERFIL.tag || !rede.conectado()) return;
  try {
    const p = await rede.lerPerfil();
    const xp = ((p && p.xp) || 0) + n;
    await rede.salvarPerfil({ xp }); PERFIL.xp = xp;
    setTimeout(() => toast(`+${n} XP pro seu boneco ⭐`), 1500);
  } catch {}
}

// ======================= músicas extras (senha) =======================
let voltarDeExtras = 'telaInicio';
function desenharExtras() {
  $('extrasTrancado').hidden = extras.liberadas; $('extrasAberto').hidden = !extras.liberadas;
  const n = MUSICAS.filter(m => m.extra).length;
  $('extrasInfo').textContent = n ? `🔓 Liberado! ${n} ${n === 1 ? 'música extra já aparece' : 'músicas extras já aparecem'} na lista.` : '🔓 Liberado! Ainda não tem nenhuma música extra enviada.';
}
async function abrirExtras() {
  if (PREVIA) { toast('Na prévia não dá: as extras ficam no servidor do jogo 🙂', 3200); return; }
  voltarDeExtras = ['telaMusicas', 'telaSala'].find(t => !$(t).hidden) || 'telaInicio';
  try { await rede.conectar(); await extras.atualizar(); } catch {}
  desenharExtras(); mostrar('telaExtras');
  if (!extras.liberadas) setTimeout(() => $('senhaExtras').focus(), 100);
}
function voltarExtras() {
  if (voltarDeExtras === 'telaMusicas') telaSolo(); else if (voltarDeExtras === 'telaSala' && M.code) { mostrar('telaSala'); desenharSala(); } else mostrar('telaInicio');
}
document.querySelectorAll('.btnExtras').forEach(b => { b.onclick = () => abrirExtras(); });
$('btnExtrasVoltar').onclick = () => voltarExtras();
$('btnLiberar').onclick = async () => {
  const senha = $('senhaExtras').value.trim();
  if (!senha) return;
  $('btnLiberar').disabled = true;
  const ok = await extras.liberar(senha).catch(() => false);
  $('btnLiberar').disabled = false;
  if (!ok) { toast('Senha errada 🙅', 2400); return; }
  $('senhaExtras').value = ''; toast('Liberado! 🎉', 2000); desenharExtras();
};
$('senhaExtras').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnLiberar').click(); });
$('btnEnviarExtras').onclick = () => $('arqExtras').click();
$('arqExtras').onchange = async () => {
  const arqs = [...$('arqExtras').files]; $('arqExtras').value = '';
  let ok = 0;
  for (const [i, a] of arqs.entries()) {
    try {
      const nome = await extras.enviarArquivo(a, f => toast(`Enviando ${i + 1}/${arqs.length}: ${Math.round(f * 100)}%`, 60000));
      ok++; toast(`✅ ${nome} enviada`, 1500);
    } catch (e) { console.warn(e); toast(`Não deu pra enviar ${a.name} 😕`, 3500); await new Promise(r => setTimeout(r, 2000)); }
  }
  await extras.atualizar(); desenharExtras();
  toast(ok ? `Pronto! ${ok} música${ok > 1 ? 's' : ''} no jogo 🎸` : 'Nenhuma música enviada', 3000);
};

// ======================= ajuste de atraso =======================
function mostrarAtraso() { $('atrasoValor').textContent = `${atrasoMs} ms`; }
function mudarAtraso(v) { atrasoMs = Math.max(-100, Math.min(450, Math.round(v))); guardar('ph-atraso', atrasoMs); mostrarAtraso(); }
$('atrasoMenos').onclick = () => mudarAtraso(atrasoMs - 10);
$('atrasoMais').onclick = () => mudarAtraso(atrasoMs + 10);
let calib = null;
$('btnCalibrar').addEventListener('pointerdown', e => {
  const ctx = audio(); if (!ctx) return;
  if (!calib) {
    const inter = 0.6, ini = ctx.currentTime + 1.0, perfIni = performance.now() + 1000;
    calib = { bipes: [], toques: [] };
    for (let i = 0; i < 8; i++) {
      bipe(ctx, i % 4 ? 880 : 1320, 0.07, 0.25, ini + i * inter);
      calib.bipes.push(perfIni + i * inter * 1000 + ((ctx.outputLatency || ctx.baseLatency || 0) * 1000));
      setTimeout(() => { const b = $('btnCalibrar'); b.classList.remove('batida'); void b.offsetWidth; b.classList.add('batida'); }, 1000 + i * inter * 1000);
    }
    $('btnCalibrar').textContent = '👆 Toque junto com o bipe!';
    setTimeout(() => {
      const difs = calib.toques.map(tq => { const b = calib.bipes.reduce((m, x) => Math.abs(x - tq) < Math.abs(m - tq) ? x : m); return tq - b; }).filter(d => Math.abs(d) < 400).sort((a, b) => a - b);
      if (difs.length >= 4) {
        const med = difs[Math.floor(difs.length / 2)];
        mudarAtraso(med); toast(`Pronto! Atraso ajustado pra ${atrasoMs} ms`, 2800);
      } else toast('Poucos toques 🤔 Tenta de novo', 2500);
      calib = null; $('btnCalibrar').textContent = '🥁 Testar de novo';
    }, 1000 + 8 * inter * 1000 + 500);
    return;
  }
  calib.toques.push(e.timeStamp || performance.now());
});

// ======================= botões das telas =======================
$('btnSolo').onclick = () => telaSolo();
$('btnTocarSolo').onclick = () => comecarSolo();
$('btnVoltarSolo').onclick = () => mostrar('telaInicio');
$('btnCriar').onclick = () => criarSala();
$('btnEntrar').onclick = () => entrar($('codigo').value);
$('codigo').addEventListener('keydown', e => { if (e.key === 'Enter') entrar($('codigo').value); });
$('btnComo').onclick = () => mostrar('telaComo');
$('btnComoOk').onclick = () => mostrar(M.code ? 'telaSala' : 'telaInicio');
$('btnAtraso').onclick = () => { mostrarAtraso(); mostrar('telaAtraso'); };
$('btnAtrasoOk').onclick = () => mostrar('telaInicio');
$('btnComecar').onclick = () => comecarOnline();
$('btnSairSala').onclick = () => sairSala();
$('btnCopiar').onclick = async () => {
  const link = linkSala(M.code);
  try { if (navigator.share) await navigator.share({ title: 'Palhetada', text: 'Bora tocar Palhetada comigo? 🎸', url: link }); else { await navigator.clipboard.writeText(link); toast('Convite copiado! 📋'); } }
  catch { try { await navigator.clipboard.writeText(link); toast('Convite copiado! 📋'); } catch { toast(link, 5000); } }
};
// Jogar de novo = a mesma música e dificuldade, na hora
$('btnDeNovo').onclick = () => {
  if (M.code) { if (M.host) comecarOnline(); return; }
  if (J) { escolha.musica = J.m.id; escolha.dif = J.dif; guardar('ph-escolha', escolha); }
  comecarSolo();
};
// Selecionar outra música = volta pra lista (sozinho) ou pra sala (quem criou escolhe)
$('btnOutra').onclick = () => { if (M.code) { fase = 'sala'; mostrar('telaSala'); desenharSala(); } else { fase = 'inicio'; telaSolo(); } };
const sairPartida = () => { if (J && J.banda) J.banda.parar(); if (M.code) sairSala(); else { J = null; fase = 'inicio'; mostrar('telaInicio'); } };
let sairArmado = 0;
$('btnSairJogo').onclick = () => {
  if (Date.now() - sairArmado > 2500) { sairArmado = Date.now(); toast('Toque de novo pra sair'); return; }
  sairPartida();
};
$('btnFimSair').onclick = () => sairPartida();

// ======================= início =======================
function desenharEu() {
  const svg = bonecoSVG(PERFIL.look, 56);
  $('eu').innerHTML = PERFIL.tag ? `<div class="rosto">${svg || '🙂'}</div><div><b>${esc(PERFIL.tag)}</b><small>seu boneco · toque pra personalizar ✏️</small></div>` : '';
  $('eu').hidden = !PERFIL.tag;
  $('nome').hidden = !!PERFIL.tag;
  $('btnBoneco').hidden = !!PERFIL.tag;
}
// a tela de personalizar é a MESMA do portal e dos outros jogos (forma-palavras/js/boneco-editor.js):
// o boneco é um só, mudou aqui muda em todos
async function personalizar() {
  let ed = null;
  try { ed = await import(new URL('../../forma-palavras/js/boneco-editor.js', import.meta.url).href); }
  catch { try { ed = await import('./boneco-editor.js'); } catch {} } // a prévia leva uma cópia
  if (!ed) { toast('Não consegui abrir agora 😕 Confere a internet?', 2600); return; }
  if (!PREVIA) try { await rede.conectar(); } catch {}
  const r = await ed.abrirEditorBoneco({
    perfil: { ...PERFIL, tag: PERFIL.tag || $('nome').value.trim() }, pedirNome: !PERFIL.tag,
    salvar: async ({ look, tag }) => {
      if (rede.conectado()) {
        if (tag && tag !== PERFIL.tag && !(await rede.reservarTag(tag, PERFIL.tag))) return 'Esse nome já tem dono 😬 Tenta outro';
        await rede.salvarPerfil(tag ? { look, tag } : { look });
      }
      PERFIL = { ...PERFIL, look, tag: tag || PERFIL.tag };
      return null;
    },
  });
  if (!r) return;
  desenharEu();
  if (M.code) rede.atualizarEu(M.code, publico()).catch(() => {});
  toast('Boneco salvo! Vale em todos os jogos ✨', 2400);
}
$('eu').onclick = () => personalizar();
$('btnBoneco').onclick = () => personalizar();
async function iniciar() {
  try { $('nome').value = localStorage.getItem('ph-nome') || ''; } catch {}
  mostrar('telaInicio');
  try { AV = await import(new URL('../../forma-palavras/js/avatar.js', import.meta.url).href); }
  catch { try { AV = await import('./avatar.js'); } catch { AV = null; } } // a prévia leva uma cópia
  if (!PREVIA) try {
    await rede.conectar();
    const p = await rede.lerPerfil();
    if (p && p.tag) PERFIL = { ...PERFIL, ...p };
  } catch (e) { console.warn('Sem conexão com o servidor', e); }
  $('linkPortal').hidden = PREVIA; $('notaPrevia').hidden = !PREVIA;
  desenharEu();
  await carregarLista();
  if (!PREVIA) await extras.atualizar().catch(() => {});
  const sala = PARAMS.get('sala');
  if (sala) { $('codigo').value = sala.toUpperCase(); entrar(sala); }
}
iniciar();

// pra testes automáticos
window.__ph = { get J() { return J; }, M, pressionar, soltar, tempo, soltarEnergia, comecarSolo, escolha };
