// Músicas extras: só aparecem pra quem digitou a senha (quem confere é o Firebase).
// Cada celular baixa cada música uma vez e guarda (IndexedDB), pra não gastar internet nem a cota grátis.
import * as rede from './rede.js';
import { MUSICAS } from './musica.js';

const BANCO = 'palhetada-musicas', LOJA = 'musicas';
function abrir() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
}
async function guardado(id) {
  try { const db = await abrir(); return await new Promise(ok => { const q = db.transaction(LOJA).objectStore(LOJA).get(id); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); }
  catch { return null; }
}
async function guardar(id, v) {
  try { const db = await abrir(); await new Promise(ok => { const t = db.transaction(LOJA, 'readwrite'); t.objectStore(LOJA).put(v, id); t.oncomplete = ok; t.onerror = ok; }); } catch {}
}
const deBase64 = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };

export let liberadas = false;
// busca a lista e coloca as músicas extras junto das outras
export async function atualizar() {
  if (!rede.conectado()) return false;
  liberadas = await rede.extrasLiberadas();
  if (!liberadas) return false;
  const lista = await rede.listaExtras();
  if (!lista) return false;
  for (const [id, m] of Object.entries(lista)) {
    const existente = MUSICAS.find(x => x.id === id);
    const musica = { id, nome: m.nome, desc: m.artista, emoji: '🎵', cor: m.cor, capa: m.capa || null, estilo: 'audio', extra: true,
      arquivo: { extra: true, partes: m.partes, enviada: m.enviada, duracao: m.duracao } };
    if (existente) Object.assign(existente, musica); else MUSICAS.push(musica);
  }
  return true;
}
// devolve { mapa, bytes } (do celular, se já baixou; senão baixa do Firebase)
export async function obter(m, aoAvancar) {
  const g = await guardado(m.id);
  if (g && g.enviada === m.arquivo.enviada) return { mapa: g.mapa, bytes: g.bytes.slice(0) };
  const { mapa, base64 } = await rede.baixarExtra(m.id, m.arquivo.partes, aoAvancar);
  const bytes = deBase64(base64);
  await guardar(m.id, { mapa, bytes, enviada: m.arquivo.enviada });
  return { mapa, bytes: bytes.slice(0) };
}
export async function liberar(senha) {
  const ok = await rede.liberarExtras(senha);
  if (ok) await atualizar();
  return ok;
}
export async function enviarArquivo(arquivo, aoAvancar) {
  const pac = JSON.parse(await arquivo.text());
  if (pac.formato !== 'palhetada-musica' || !pac.id || !pac.audio || !pac.mapa) throw new Error(arquivo.name + ' não é uma música do Palhetada');
  await rede.enviarExtra(pac, aoAvancar);
  return pac.nome;
}
