// Palhetada: jogo de ritmo estilo "guitarra de plástico", feito pro celular.
// As notas descem por 4 trilhas; tocar no tempo certo faz a guitarra soar.
// Multiplayer: todo mundo da sala toca a MESMA música ao mesmo tempo (horário do servidor),
// cada um na sua dificuldade, e os pontos vão aparecendo ao vivo pros outros.
import * as rede from './rede.js';
import { MUSICAS, musicaPorId, DIFS, partitura, Banda, BandaAudio, bipe, carregarLista, carregar, carregada } from './musica.js';

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
  ['telaInicio', 'telaMusicas', 'telaComo', 'telaAtraso', 'telaSala', 'telaFim'].forEach(t => { $(t).hidden = t !== id; });
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
  $('boneco').querySelector('.av').innerHTML = bonecoSVG(PERFIL.look, 58) || '🎸';
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
  J.efeitos.push({ tr: n.trilha, txt: q[0], cor: d <= PERFEITO ? '#fff36b' : '#fff', ini: performance.now() });
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
  if (J.combo === 30) $('boneco').classList.add('danca');
}
function errarNota(n) {
  n.st = 2; J.erros++;
  if (n.estrela) J.frases[n.frase].falhou = true;
  quebrarCombo();
}
const RECLAMA = ['Ô, acorda! 😤', 'Foi fora do tempo, hein', 'Que nota foi essa? 🙉', 'Tá me fazendo passar vergonha 😩', 'O público tá vaiando…'];
function quebrarCombo() {
  J.errosSeguidos++;
  if (J.combo >= 15) falar('Perdeu o combo! 😱', 1500);
  else if (J.errosSeguidos === 4 || J.errosSeguidos === 9) falar(RECLAMA[Math.floor(Math.random() * RECLAMA.length)], 1800);
  J.combo = 0; $('boneco').classList.remove('danca');
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
  const chave = `${Math.round(J.pontos)}|${m}|${dob}|${J.energia.toFixed(2)}|${J.dobro ? Math.round((J.dobro.fim - tempo()) * 4) : ''}`;
  if (chave === hudCache) return; hudCache = chave;
  $('pontos').textContent = Math.round(J.pontos).toLocaleString('pt-BR');
  $('mult').textContent = 'x' + m; $('mult').className = 'x' + m + (dob ? ' dobro' : '');
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
}
addEventListener('resize', ajustarTela); ajustarTela();

// perspectiva da "estrada" de notas: z = 0 na linha de tocar, z = 1 lá no fundo
const K = 2.0;
function geo() {
  const hitY = H - Math.max(96, H * 0.15), topoY = H * 0.13;
  const s1 = 1 / (1 + K), vY = (topoY - hitY * s1) / (1 - s1);
  const larg = Math.min(W * 0.94, 480);
  return { hitY, vY, larg, cx: W / 2 };
}
const esc_ = z => 1 / (1 + K * z);
function ponto(G, tr, z) { // centro da trilha tr (pode ser fracionária) na profundidade z
  const s = esc_(z);
  return { x: G.cx + (tr - 1.5) * (G.larg / 4) * s, y: G.vY + (G.hitY - G.vY) * s, s };
}
function trilhaDoX(x) {
  const G = geo();
  return Math.max(0, Math.min(3, Math.floor((x - (G.cx - G.larg / 2)) / (G.larg / 4))));
}

function fundo(t, energia) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  if (escuro()) { gr.addColorStop(0, '#08051a'); gr.addColorStop(1, '#1d0f3f'); }
  else { gr.addColorStop(0, '#3a1f8f'); gr.addColorStop(1, '#7b3fc4'); }
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // holofotes balançando
  g.save(); g.globalCompositeOperation = 'lighter';
  const cores = energia ? ['#3ad1ff', '#9ff3ff', '#3ad1ff'] : ['#ff3d8b', '#ffd23f', '#3aa0ff'];
  for (let i = 0; i < 3; i++) {
    const ox = W * (0.15 + i * 0.35), ang = Math.sin(t * 0.9 + i * 2.1) * 0.45;
    const lg = g.createLinearGradient(ox, 0, ox, H * 0.8);
    lg.addColorStop(0, cores[i] + '55'); lg.addColorStop(1, cores[i] + '00');
    g.fillStyle = lg; g.beginPath(); g.moveTo(ox - 6, 0); g.lineTo(ox + 6, 0);
    g.lineTo(ox + Math.sin(ang) * H * 0.8 + 120, H * 0.8); g.lineTo(ox + Math.sin(ang) * H * 0.8 - 120, H * 0.8); g.closePath(); g.fill();
  }
  g.restore();
  // plateia (silhuetas pulando)
  g.fillStyle = escuro() ? '#05030f' : '#24104f';
  const base = H + 6;
  for (let x = -10, i = 0; x < W + 20; x += 26, i++) {
    const pulo = Math.max(0, Math.sin(t * 7 + i * 1.7)) * (energia ? 10 : 4);
    g.beginPath(); g.arc(x, base - 34 - pulo - (i % 3) * 5, 11, 0, 7); g.fill();
    g.fillRect(x - 13, base - 26 - pulo - (i % 3) * 5, 26, 40);
  }
}

function desenharJogo() {
  const t = tempo(), G = geo(), janela = J.janela, agora = performance.now();
  const dob = dobrado();
  fundo(t, dob);
  // estrada
  const zBaixo = -0.13;
  const pts = [ponto(G, -0.5, 1), ponto(G, 3.5, 1), ponto(G, 3.5, zBaixo), ponto(G, -0.5, zBaixo)];
  const gr = g.createLinearGradient(0, pts[0].y, 0, pts[2].y);
  gr.addColorStop(0, dob ? 'rgba(20,70,110,.2)' : 'rgba(15,8,35,.15)'); gr.addColorStop(1, dob ? 'rgba(20,90,140,.95)' : 'rgba(15,8,35,.92)');
  g.fillStyle = gr; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill();
  // bordas e divisões
  for (let i = 0; i <= 4; i++) {
    const a = ponto(G, i - 0.5, 1), b = ponto(G, i - 0.5, zBaixo);
    g.strokeStyle = i === 0 || i === 4 ? (dob ? '#9ff3ff' : '#ffffffaa') : 'rgba(255,255,255,.12)';
    g.lineWidth = i === 0 || i === 4 ? 3 : 1.5; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  // linhas de tempo (cada batida)
  const bat = J.p.oitavo * 2, BT = J.p.batidas;
  const k0 = BT ? Math.max(0, bisseca(BT, t - 0.3)) : Math.ceil((t - 0.3) / bat);
  for (let k = k0; BT ? (k < BT.length && BT[k] < t + janela) : k * bat < t + janela; k++) {
    const z = ((BT ? BT[k] : k * bat) - t) / janela; if (z < zBaixo) continue;
    const a = ponto(G, -0.5, z), b = ponto(G, 3.5, z);
    g.strokeStyle = k % 4 === 0 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.12)'; g.lineWidth = (k % 4 === 0 ? 3 : 1.5) * a.s;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  // alvos (os círculos onde se toca)
  const rAlvo = G.larg / 4 * 0.36;
  for (let tr = 0; tr < 4; tr++) {
    const p = ponto(G, tr, 0), ap = J.apertado[tr];
    g.save(); g.translate(p.x, p.y); g.scale(1, 0.6);
    g.fillStyle = ap ? CORES[tr] : 'rgba(0,0,0,.45)';
    g.beginPath(); g.arc(0, 0, rAlvo * (ap ? 1.05 : 1), 0, 7); g.fill();
    g.lineWidth = 6; g.strokeStyle = CORES[tr]; g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(0, 0, rAlvo * 0.62, 0, 7); g.stroke();
    g.restore();
    if (ap) { // brilho subindo quando aperta
      const lg = g.createLinearGradient(0, p.y, 0, p.y - 140);
      lg.addColorStop(0, CORES[tr] + '66'); lg.addColorStop(1, CORES[tr] + '00');
      g.fillStyle = lg; g.fillRect(p.x - rAlvo, p.y - 140, rAlvo * 2, 140);
    }
  }
  // notas (de trás pra frente, pra as de perto ficarem por cima)
  const vis = [];
  for (let i = Math.max(0, J.prox - 8); i < J.notas.length; i++) {
    const n = J.notas[i]; if (n.t - t > janela) break;
    if (n.fim < t - 0.4) continue; vis.push(n);
  }
  for (let i = vis.length - 1; i >= 0; i--) {
    const n = vis[i];
    // rabo da nota longa
    if (n.dur > 0 && n.st !== 1) {
      const zi = Math.max(zBaixo, ((n.st === 3 ? Math.max(n.t, t) : n.t) - t) / janela), zf = Math.min(1, (n.fim - t) / janela);
      if (zf > zi) {
        const a = ponto(G, n.trilha, zi), b = ponto(G, n.trilha, zf), w = rAlvo * 0.32;
        g.fillStyle = n.st === 2 ? 'rgba(150,150,150,.5)' : n.st === 3 ? CORES[n.trilha] : CORES[n.trilha] + 'bb';
        g.beginPath(); g.moveTo(a.x - w * a.s, a.y); g.lineTo(a.x + w * a.s, a.y); g.lineTo(b.x + w * b.s, b.y); g.lineTo(b.x - w * b.s, b.y); g.closePath(); g.fill();
        if (n.st === 3) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); }
      }
    }
    if (n.st === 1 || n.st === 3) continue;
    const z = (n.t - t) / janela; if (z < zBaixo - 0.05) continue;
    const p = ponto(G, n.trilha, z), r = rAlvo * 0.9 * p.s;
    joia(p.x, p.y, r, n.trilha, n.st === 2 ? 'erro' : n.estrela ? 'estrela' : '');
  }
  // faíscas
  J.faiscas = J.faiscas.filter(f => agora - f.ini < 450);
  for (const f of J.faiscas) {
    const p = ponto(G, f.tr, 0), k = (agora - f.ini) / 1000;
    const x = p.x + Math.cos(f.a) * f.v * k, y = p.y - Math.sin(f.a) * f.v * k + 300 * k * k;
    g.globalAlpha = 1 - k / 0.45; g.fillStyle = f.cor; g.fillRect(x - 3, y - 3, 6, 6);
  }
  g.globalAlpha = 1;
  // textos de acerto
  J.efeitos = J.efeitos.filter(e => agora - e.ini < 600);
  g.textAlign = 'center'; g.font = '900 18px Nunito, system-ui, sans-serif';
  for (const e of J.efeitos) {
    const p = ponto(G, e.tr, 0), k = (agora - e.ini) / 600;
    g.globalAlpha = 1 - k;
    if (e.x) { g.strokeStyle = '#ff4d5e'; g.lineWidth = 5; const s = 12; g.beginPath(); g.moveTo(p.x - s, p.y - s); g.lineTo(p.x + s, p.y + s); g.moveTo(p.x + s, p.y - s); g.lineTo(p.x - s, p.y + s); g.stroke(); }
    else { g.fillStyle = e.cor; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 4; const y = p.y - 40 - k * 30; g.strokeText(e.txt, p.x, y); g.fillText(e.txt, p.x, y); }
  }
  g.globalAlpha = 1;
  // combo
  if (J.combo >= 5) {
    const p = ponto(G, 1.5, 0.12);
    g.font = `900 ${J.combo >= 30 ? 30 : 24}px Nunito, system-ui, sans-serif`;
    g.fillStyle = J.combo >= 30 ? '#ffb13d' : '#fff'; g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 5;
    g.strokeText(J.combo + ' combo', p.x, p.y); g.fillText(J.combo + ' combo', p.x, p.y);
  }
  // barra do progresso da música
  const prog = Math.max(0, Math.min(1, t / J.p.duracao));
  g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, H - 4, W, 4);
  g.fillStyle = J.m.cor; g.fillRect(0, H - 4, W * prog, 4);
}

function bisseca(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
function joia(x, y, r, tr, tipo) {
  g.save(); g.translate(x, y); g.scale(1, 0.62);
  const cor = tipo === 'erro' ? '#777' : CORES[tr], esc2 = tipo === 'erro' ? '#444' : ESCURAS[tr];
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(0, r * 0.25, r, 0, 7); g.fill();
  g.fillStyle = esc2; g.beginPath(); g.arc(0, r * 0.12, r, 0, 7); g.fill();
  g.fillStyle = tipo === 'estrela' ? '#e8fbff' : cor; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  if (tipo === 'estrela') { g.lineWidth = r * 0.28; g.strokeStyle = cor; g.beginPath(); g.arc(0, 0, r * 0.82, 0, 7); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(-r * 0.25, -r * 0.35, r * 0.38, r * 0.2, -0.3, 0, 7); g.fill();
  g.fillStyle = tipo === 'estrela' ? '#fff' : 'rgba(255,255,255,.9)';
  g.beginPath(); g.arc(0, 0, r * 0.28, 0, 7); g.fill();
  g.restore();
}

// fundo do menu: palco com notinhas descendo devagar
const menuNotas = Array.from({ length: 14 }, (_, i) => ({ tr: i % 4, z: i / 14 }));
function desenharMenu(dt, t) {
  fundo(t, false);
  const G = geo();
  for (const n of menuNotas) {
    n.z -= dt * 0.18; if (n.z < -0.1) { n.z = 1; n.tr = Math.floor(Math.random() * 4); }
    const p = ponto(G, n.tr, n.z);
    g.globalAlpha = 0.35; joia(p.x, p.y, G.larg / 4 * 0.33 * p.s, n.tr, ''); g.globalAlpha = 1;
  }
}

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
  const m = musicaPorId(id);
  if (carregada(m)) return true;
  toast('Carregando a música… 🎧', 20000);
  try { await carregar(audio(), m); $('toast').hidden = true; return true; }
  catch (e) { toast('Não consegui carregar a música 😕', 3000); return false; }
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
  if (!carregada(musicaPorId(musica))) carregar(audio(), musicaPorId(musica)).catch(() => {});
  $('quemEscolhe').textContent = M.host ? '(você escolhe)' : '(quem criou escolhe)';
  desenharMusicas($('listaMusicasSala'), musica, M.host ? id => rede.atualizarMeta(M.code, { musica: id }).catch(() => {}) : null, escolha.dif);
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

// XP vai pro mesmo nível do Forma Palavras
async function ganharXP(n) {
  if (!PERFIL.tag || !rede.conectado()) return;
  try {
    const p = await rede.lerPerfil();
    const xp = ((p && p.xp) || 0) + n;
    await rede.salvarPerfil({ xp }); PERFIL.xp = xp;
    setTimeout(() => toast(`+${n} XP pro seu boneco ⭐`), 1500);
  } catch {}
}

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
  $('eu').innerHTML = PERFIL.tag ? `<div class="rosto">${svg || '🙂'}</div><div><b>${esc(PERFIL.tag)}</b><small>seu boneco do Forma Palavras</small></div>` : '';
  $('eu').hidden = !PERFIL.tag;
  $('nome').hidden = !!PERFIL.tag;
}
async function iniciar() {
  try { $('nome').value = localStorage.getItem('ph-nome') || ''; } catch {}
  mostrar('telaInicio');
  try { AV = await import(new URL('../../forma-palavras/js/avatar.js', import.meta.url).href); } catch { AV = null; }
  if (!PREVIA) try {
    await rede.conectar();
    const p = await rede.lerPerfil();
    if (p && p.tag) PERFIL = { ...PERFIL, ...p };
  } catch (e) { console.warn('Sem conexão com o servidor', e); }
  $('linkPortal').hidden = PREVIA; $('notaPrevia').hidden = !PREVIA;
  desenharEu();
  await carregarLista();
  const sala = PARAMS.get('sala');
  if (sala) { $('codigo').value = sala.toUpperCase(); entrar(sala); }
}
iniciar();

// pra testes automáticos
window.__ph = { get J() { return J; }, M, pressionar, soltar, tempo, soltarEnergia, comecarSolo, escolha };
