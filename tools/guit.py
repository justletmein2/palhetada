# Nova leitura da guitarra: segue o som da faixa separada.
import numpy as np, librosa, scipy.ndimage as nd
SR = 22050; HOP = 256
FPS = SR / HOP

def analisar(y):
    f0, vflag, vprob = librosa.pyin(y, fmin=70, fmax=1500, sr=SR, hop_length=HOP, frame_length=2048)
    n = len(f0)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0][:n]
    db = 20 * np.log10(rms + 1e-7)
    ref = np.percentile(db, 95)
    ativo = db > max(ref - 24, -52)
    ativo = nd.binary_closing(ativo, np.ones(5)) & nd.binary_opening(ativo, np.ones(3))
    midi = librosa.hz_to_midi(np.where(vflag, f0, np.nan))
    # mediana "ignorando buracos" pra tirar o vibrato miúdo
    pm = np.copy(midi)
    for i in range(n):
        w = midi[max(0, i - 3): i + 4]; w = w[~np.isnan(w)]
        pm[i] = np.median(w) if len(w) >= 2 else np.nan
    env0 = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)[:n]
    refe = nd.maximum_filter1d(nd.uniform_filter1d(env0, 9), int(4 * FPS))
    env = env0 / (refe + np.percentile(env0, 50) + 1e-9)
    ataques = set(librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP, delta=0.1, wait=2, normalize=False))
    C = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)[:, :n]
    return dict(n=n, db=db, ativo=ativo, pm=pm, vprob=vprob, env=env, ataques=ataques, C=C)

def segmentar(A):
    n, ativo, pm, ataques = A['n'], A['ativo'], A['pm'], A['ataques']
    ev, cur = [], None
    def fecha(i):
        nonlocal cur
        if cur is not None:
            cur['fim'] = i; ev.append(cur); cur = None
    for i in range(n):
        if not ativo[i]:
            fecha(i); continue
        p = pm[i]
        if cur is None:
            cur = dict(ini=i, p=np.nan); continue
        idade = i - cur['ini']
        if i in ataques and idade > 0.07 * FPS:
            fecha(i); cur = dict(ini=i, p=np.nan); continue
        if np.isnan(cur['p']):
            w = pm[cur['ini']: i + 1]; w = w[~np.isnan(w)]
            if len(w) >= 4: cur['p'] = float(np.median(w))
            continue
        if not np.isnan(p) and abs(p - cur['p']) >= 0.8:
            w = pm[i: i + 6]; w = w[~np.isnan(w)]
            if len(w) >= 4 and abs(np.median(w) - cur['p']) >= 0.8 and np.ptp(w) < 1.0 and idade > 0.08 * FPS:
                fecha(i); cur = dict(ini=i, p=float(np.median(w))); continue
    fecha(n)
    # junta pedacinhos curtos demais com o anterior
    out = []
    for e in ev:
        if out and (e['fim'] - e['ini']) < 0.05 * FPS and e['ini'] - out[-1]['fim'] <= 1:
            out[-1]['fim'] = e['fim']; continue
        if (e['fim'] - e['ini']) < 0.04 * FPS: continue
        out.append(e)
    for e in out:
        a, b = e['ini'], min(e['fim'], e['ini'] + int(0.15 * FPS))
        w = pm[a:e['fim']]; w = w[~np.isnan(w)]
        e['p'] = float(np.median(pm[a:b][~np.isnan(pm[a:b])])) if np.any(~np.isnan(pm[a:b])) else (float(np.median(w)) if len(w) else np.nan)
        e['voz'] = float(np.mean(A['vprob'][a:b]))
        c = A['C'][:, a:b].mean(1); c = c / (c.max() + 1e-9)
        e['poli'] = int(np.sum(c > 0.65))
        e['croma'] = int(np.argmax(c))
        e['forca'] = float(A['env'][max(0, a - 2): a + 3].max())
        e['t'] = a / FPS; e['dur'] = (e['fim'] - a) / FPS
    return out

def trilhas(ev):
    """mesma nota = mesma trilha; subiu = direita, desceu = esquerda; usa as 4 trilhas no trecho"""
    ts = np.array([e['t'] for e in ev]); ps = np.array([e['p'] if not np.isnan(e['p']) else -1 for e in ev])
    out = []
    ant_p, ant_tr = None, None
    for i, e in enumerate(ev):
        p = round(ps[i]) if ps[i] > 0 else None
        m = (ts > ts[i] - 5) & (ts < ts[i] + 5) & (ps > 0)
        viz = np.unique(np.round(ps[m]))
        if p is None:
            tr = ant_tr if ant_tr is not None else 1
        else:
            r = np.searchsorted(viz, p) if len(viz) else 0
            alvo = int(np.clip(np.floor((r + 0.5) / max(1, len(viz)) * 4), 0, 3))
            if ant_p is None or ts[i] - ev[i - 1]['t'] - ev[i - 1]['dur'] > 1.2:
                tr = alvo
            else:
                d = p - ant_p
                if d == 0: tr = ant_tr
                elif d > 0:
                    tr = max(ant_tr + 1, min(alvo, ant_tr + (2 if d >= 5 else 1)))
                    if tr > 3: tr = 3 if ant_tr < 3 else 2   # sem espaço pra subir: pula pra trás um pouco
                else:
                    tr = min(ant_tr - 1, max(alvo, ant_tr - (2 if d <= -5 else 1)))
                    if tr < 0: tr = 0 if ant_tr > 0 else 1
            ant_p = p
        out.append(int(tr)); ant_tr = int(tr)
    return out

FORMAS = [(0, 1), (0, 2), (1, 2), (1, 3), (2, 3)]
def montar(ev, g16, dif, eh_acorde):
    """dificuldade difícil direto do som; as outras simplificam a partir dela"""
    trs = trilhas(ev)
    notas = []
    acorde_ant = None
    for e, tr in zip(ev, trs):
        t = e['t']
        i = np.searchsorted(g16, t); cand = [g16[j] for j in (i - 1, i) if 0 <= j < len(g16)]
        m = min(cand, key=lambda x: abs(x - t)) if cand else t
        if abs(m - t) < 0.045: t = m
        dur = e['dur']
        longa = dur >= 0.42
        n = dict(t=round(float(t), 3), trilha=tr, dur=round(float(dur - 0.1), 3) if longa else 0.0, forca=e['forca'], p=e['p'])
        if eh_acorde(e):
            # acorde: forma de 2 notas; mesmo acorde repetido = mesma forma
            chave = e['croma']
            if acorde_ant and acorde_ant[0] == chave: forma = acorde_ant[1]
            else:
                forma = FORMAS[min(4, max(0, tr + (1 if tr >= 2 else 0)))]
                if acorde_ant and forma == acorde_ant[1]: forma = FORMAS[(FORMAS.index(forma) + 2) % 5]
            acorde_ant = (chave, forma)
            for k in forma: notas.append(dict(n, trilha=k))
        else:
            acorde_ant = None
            notas.append(n)
    return notas

def simplificar(dif_notas, dif, g8, beats):
    """médio e fácil a partir do difícil: menos notas, mesmas trilhas (o desenho continua o mesmo)"""
    grupos = {}
    for n in dif_notas: grupos.setdefault(n['t'], []).append(n)
    ts = sorted(grupos)
    gap = {'medio': 0.2, 'facil': 0.42}[dif]
    # repetições rápidas da mesma trilha (palhetada alternada) viram uma nota longa
    runs, i = [], 0
    while i < len(ts):
        j = i
        while j + 1 < len(ts) and ts[j + 1] - ts[j] < gap and len(grupos[ts[j + 1]]) == 1 and len(grupos[ts[i]]) == 1 \
                and grupos[ts[j + 1]][0]['trilha'] == grupos[ts[i]][0]['trilha']:
            j += 1
        runs.append((i, j)); i = j + 1
    cand = []
    for i, j in runs:
        g = grupos[ts[i]]
        if j - i >= 3:
            fim = ts[j] + max(0.12, grupos[ts[j]][0]['dur'])
            cand.append(dict(t=ts[i], notas=[dict(g[0], dur=round(fim - ts[i] - 0.1, 3))], peso=3))
        else:
            no8 = np.min(np.abs(g8 - ts[i])) < 0.04 if len(g8) else False
            nob = np.min(np.abs(beats - ts[i])) < 0.04 if len(beats) else False
            peso = g[0].get('forca', 1) + (1.5 if nob else 0.7 if no8 else 0) + (1 if g[0]['dur'] > 0 else 0) + (0.5 if len(g) > 1 else 0)
            cand.append(dict(t=ts[i], notas=g, peso=peso))
    # escolhe os mais importantes respeitando o espaço mínimo
    ordem = sorted(range(len(cand)), key=lambda k: -cand[k]['peso'])
    pegos = []
    tt = np.array([c['t'] for c in cand])
    usados = np.zeros(len(cand), bool)
    for k in ordem:
        perto = np.abs(tt - tt[k]) < gap
        if np.any(usados & perto): continue
        usados[k] = True
    out = []
    for k in np.where(usados)[0]:
        c = cand[k]; g = c['notas']
        if len(g) > 1:
            nob = np.min(np.abs(beats - c['t'])) < 0.04
            if dif == 'facil' or not nob: g = [min(g, key=lambda n: n['trilha'])]
        for n in g: out.append(dict(t=n['t'], trilha=n['trilha'], dur=n['dur']))
    out.sort(key=lambda n: (n['t'], n['trilha']))
    # nota longa não pode passar por cima da próxima
    for a, n in enumerate(out):
        if n['dur'] > 0:
            prox = next((m['t'] for m in out[a + 1:] if m['t'] > n['t']), n['t'] + 9)
            n['dur'] = round(min(n['dur'], prox - n['t'] - 0.12), 3)
            if n['dur'] < 0.3: n['dur'] = 0.0
    return out

def finalizar(notas):
    notas = sorted(notas, key=lambda n: (n['t'], n['trilha']))
    out, vistos = [], set()
    for n in notas:
        k = (n['t'], n['trilha'])
        if k in vistos: continue
        vistos.add(k); out.append(dict(t=n['t'], trilha=n['trilha'], dur=n['dur']))
    for a, n in enumerate(out):
        if n['dur'] > 0:
            prox = next((m['t'] for m in out[a + 1:] if m['t'] > n['t'] + 0.001), n['t'] + 9)
            n['dur'] = round(min(n['dur'], prox - n['t'] - 0.1), 3)
            if n['dur'] < 0.3: n['dur'] = 0.0
    return out

def afinar(notas, gap):
    """tira notas grudadas demais (mantém as mais fortes); acordes continuam acordes"""
    grupos = {}
    for n in notas: grupos.setdefault(n['t'], []).append(n)
    ts = np.array(sorted(grupos))
    peso = np.array([max(n.get('forca', 1) for n in grupos[t]) + (0.6 if any(n['dur'] > 0 for n in grupos[t]) else 0) for t in ts])
    usados = np.zeros(len(ts), bool)
    for k in np.argsort(-peso):
        if np.any(usados & (np.abs(ts - ts[k]) < gap - 1e-6)): continue
        usados[k] = True
    return [n for t in ts[usados] for n in grupos[t]]
