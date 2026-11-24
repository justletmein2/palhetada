// Palhetada: jogo de ritmo estilo "guitarra de plástico", feito pro celular.
// As notas descem por 4 trilhas; tocar no tempo certo faz a guitarra soar.
// Multiplayer: todo mundo da sala toca a MESMA música ao mesmo tempo (horário do servidor),
// cada um na sua dificuldade, e os pontos vão aparecendo ao vivo pros outros.
import * as rede from './rede.js';
import { MUSICAS, musicaPorId, DIFS, partitura, Banda, BandaAudio, bipe, carregarLista, carregar, carregada } from './musica.js';
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
const TECLAS = { d: 0, f: 1, j: 2, k: 3 };

// ---------- estado geral ----------
let PERFIL = { tag: '', look: null, xp: 0 };
let AV = null;
const M = { code: null, host: false, meta: null, players: {}, sair: null, rodadaVista: 0, partida: { estado: {}, resultado: {} }, sairPartida: null };
let J = null;            // a partida em andamento
let fase = 'inicio';
const guardado = (k, padrao) => { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const escolha = guardado('ph-escolha', { musica: 'laje', dif: 'medio' });
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
function telaSolo() {
  const atualizar = () => {
    desenharMusicas($('listaMusicasSolo'), escolha.musica, id => { escolha.musica = id; guardar('ph-escolha', escolha); atualizar(); }, escolha.dif);
    desenharDifs($('difSolo'), escolha.dif, id => { escolha.dif = id; guardar('ph-escolha', escolha); atualizar(); });
  };
  atualizar(); mostrar('telaMusicas');
}

// ======================= a partida =======================
function novaPartida({ musica, dif, inicioPerf, online, ids = [], rodada = 0 }) {
  const ctx = audio();
  if (J && J.banda) J.banda.parar();
  const m = musicaPorId(musica), p = partitura(m, dif);
  const t0 = ctx.currentTime + (inicioPerf - performance.now()) / 1000;
  const frases = {};
  p.notas.forEach(n => { if (n.estrela) { frases[n.frase] = frases[n.frase] || { total: 0, acertos: 0, falhou: false }; frases[n.frase].total++; } });
  J = {
    m, dif, p, notas: p.notas.map(n => ({ ...n, st: 0 })), perf0: inicioPerf, banda: new (m.arquivo ? BandaAudio : Banda)(ctx, m, p, t0),
    janela: DIFS[dif].janela, pontos: 0, combo: 0, maxCombo: 0, acertos: 0, perfeitos: 0, erros: 0, errosSeguidos: 0,
    energia: 0, dobro: null, frases, segurando: [null, null, null, null], apertado: [0, 0, 0, 0], efeitos: [], faiscas: [],
    online, ids, rodada, fim: false, prox: 0, ultEnvio: 0, contou: -1,
  };
  fase = 'jogo'; mostrar(null);
  prepararDancarino();
  falar('');
  montarRivais(); atualizarHUD();
}
const tempo = (perfMs = performance.now()) => (perfMs - J.perf0) / 1000 - latencia();
const mult = () => Math.min(4, 1 + Math.floor(J.combo / 10));
const dobrado = () => !!J.dobro;

function pressionar(tr, ts = performance.now()) {
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
    J.banda.errou(); quebrarCombo();
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
function acertar(n, d) {
  const q = d <= PERFEITO ? ['PERFEITO!', 50] : d <= OTIMO ? ['ÓTIMO', 40] : ['BOM', 25];
  J.combo++; J.maxCombo = Math.max(J.maxCombo, J.combo); J.acertos++; J.errosSeguidos = 0;
  if (d <= PERFEITO) J.perfeitos++;
  J.pontos += q[1] * mult() * (dobrado() ? 2 : 1);
  const som = J.banda.solo(n.midi, n.dur > 0 ? n.dur + 0.15 : 0.3);
  if (n.dur > 0) { n.st = 3; n.ate = n.t; J.segurando[n.trilha] = { n, som }; } else n.st = 1;
  // acorde: um texto só (senão os dois "PERFEITO!" se encavalam)
  const ultimoTxt = J.efeitos.filter(e => e.txt).pop();
  const repetido = ultimoTxt && performance.now() - ultimoTxt.ini < 60;
  J.efeitos.push({ tr: n.trilha, txt: repetido ? '' : q[0], cor: d <= PERFEITO ? '#fff36b' : '#fff', ini: performance.now() });
  for (let i = 0; i < 10; i++) J.faiscas.push({ tr: n.trilha, a: Math.random() * Math.PI, v: 120 + Math.random() * 220, ini: performance.now(), cor: n.estrela ? '#bff6ff' : CORES[n.trilha] });
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
    if (n.st === 0) errarNota(n);
  }
  while (J.prox < J.notas.length && J.notas[J.prox].st !== 0 && J.notas[J.prox].t < t - JANELA) J.prox++;
  if (J.dobro && t > J.dobro.fim) J.dobro = null;
  // contagem antes das notas chegarem
  const primeira = J.notas[0].t, falta = primeira - t;
  if (falta > 0 && falta < 4.2) {
    const c = Math.ceil(falta / (J.p.oitavo * 2));
    if (c !== J.contou && c <= 4) { J.contou = c; aviso(c === 4 ? 'PREPARA…' : String(c), 500); }
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
  // guitarra
  g.save(); g.translate(S * 0.02, -pern - tronco * 0.35); g.rotate(-0.45 + (nivel ? Math.sin(ph) * 0.06 : 0));
  g.fillStyle = '#3a2a1a'; g.fillRect(-S * 0.75, -S * 0.035, S * 0.62, S * 0.07);              // braço
  g.fillStyle = '#1a1208'; g.fillRect(-S * 0.86, -S * 0.06, S * 0.13, S * 0.12);               // cabeça do braço
  g.fillStyle = '#e8304a';
  g.beginPath(); g.ellipse(S * 0.02, 0, S * 0.2, S * 0.16, 0, 0, 7); g.fill();
  g.beginPath(); g.ellipse(-S * 0.16, 0, S * 0.13, S * 0.11, 0, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, S * 0.05, S * 0.12, 0, 0, 7); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-S * 0.82, 0); g.lineTo(S * 0.1, 0); g.stroke();
  g.restore();
  // braços: um no braço da guitarra, outro palhetando
  const pal = nivel ? Math.sin(ph * 4) * S * 0.08 : 0;
  g.lineWidth = S * 0.11; g.strokeStyle = DANC.roupa;
  g.beginPath(); g.moveTo(-larg * 0.45, topo + S * 0.05); g.quadraticCurveTo(-larg * 0.75, -pern - tronco * 0.4, -S * 0.42, -pern - tronco * 0.12 - S * 0.16); g.stroke();
  g.beginPath(); g.moveTo(larg * 0.45, topo + S * 0.05); g.quadraticCurveTo(larg * 0.6, -pern - tronco * 0.2, S * 0.06, -pern - tronco * 0.45 + pal); g.stroke();
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

// ---------- a pista ----------
function desenharJogo() {
  const t = tempo(), G = geo(), janela = J.janela, agora = performance.now();
  const dob = dobrado(), m = mult();
  const intensidade = Math.min(1, J.combo / 40);
  fundo(t, dob, intensidade);
  desenharDancarino(t, G);
  const zBaixo = -0.13;
  // corpo da pista
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
  for (let tr = 0; tr < 4; tr++) {
    const p = ponto(G, tr, 0), ap = J.apertado[tr], seg = !!J.segurando[tr];
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
  // notas
  const vis = [];
  for (let i = Math.max(0, J.prox - 8); i < J.notas.length; i++) {
    const n = J.notas[i]; if (n.t - t > janela) break;
    if (n.fim < t - 0.4) continue; vis.push(n);
  }
  for (let i = vis.length - 1; i >= 0; i--) {
    const n = vis[i];
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
    joia(p.x, p.y, r, n.trilha, n.st === 2 ? 'erro' : n.estrela ? 'estrela' : '', agora);
    g.globalAlpha = 1;
  }
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
    const p = ponto(G, 1.5, 0.16), quente = J.combo >= 30;
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

function joia(x, y, r, tr, tipo, agora = 0) {
  if (r < 0.5) return;
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

// ---------- laço ----------
let ultimo = performance.now();
function laco(agora) {
  const dt = Math.min(0.05, (agora - ultimo) / 1000); ultimo = agora;
  g.clearRect(0, 0, W, H);
  if (fase === 'jogo' && J) { passo(); desenharJogo(); }
  else desenharMenu(dt, agora / 1000);
  requestAnimationFrame(laco);
}
requestAnimationFrame(laco);

// ---------- controles ----------
const dedos = new Map();
cv.addEventListener('pointerdown', e => {
  if (fase !== 'jogo') return;
  e.preventDefault();
  const tr = trilhaDoX(e.clientX); dedos.set(e.pointerId, tr);
  try { cv.setPointerCapture(e.pointerId); } catch {}
  pressionar(tr, e.timeStamp || performance.now());
});
const largou = e => { const tr = dedos.get(e.pointerId); if (tr == null) return; dedos.delete(e.pointerId); if (![...dedos.values()].includes(tr)) soltar(tr); };
cv.addEventListener('pointerup', largou); cv.addEventListener('pointercancel', largou);
addEventListener('keydown', e => {
  if (fase !== 'jogo' || e.repeat) return;
  const tr = TECLAS[e.key.toLowerCase()];
  if (tr != null) pressionar(tr, e.timeStamp || performance.now());
  if (e.key === ' ') soltarEnergia();
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
    $('btnDeNovo').hidden = false; $('fimEspera').hidden = true;
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
  $('btnDeNovo').hidden = !M.host; $('fimEspera').hidden = M.host;
  $('btnDeNovo').textContent = '🔁 Tocar de novo';
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
  novaPartida({ musica: escolha.musica, dif: escolha.dif, inicioPerf: performance.now() + 1500, online: false });
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
      prepararMusica(meta.musica).then(ok => { if (ok && M.code) novaPartida({ musica: meta.musica, dif: escolha.dif, inicioPerf: performance.now() + (meta.inicio - rede.agora()), online: true, ids: meta.ids, rodada: meta.rodada }); });
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
  desenharDifs($('difSala'), escolha.dif, id => { escolha.dif = id; guardar('ph-escolha', escolha); rede.atualizarEu(M.code, { dif: id }).catch(() => {}); desenharSala(); });
  $('btnComecar').hidden = !M.host;
  $('salaEspera').hidden = M.host;
}
async function comecarOnline() {
  if (!M.host) return;
  const ids = Object.entries(M.players).filter(([, p]) => p.online).map(([id]) => id);
  if (ids.length < 1) return;
  await rede.limparPartida(M.code).catch(() => {});
  await rede.atualizarMeta(M.code, { status: 'playing', rodada: (M.meta.rodada || 0) + 1, musica: M.meta.musica || 'laje', inicio: rede.agora() + 4000, ids });
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
$('btnDeNovo').onclick = () => { if (M.code) { fase = 'sala'; mostrar('telaSala'); desenharSala(); } else telaSolo(); };
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
