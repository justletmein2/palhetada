# Gera os mapas do Palhetada a partir das faixas separadas do Suno.
# Uso: python3 gen.py <id>   (lê raw/<id>_mix|<inst>|drums.mp3, escreve out/<id>/mapa.json + faixas)
import sys, json, os, subprocess
import numpy as np, librosa, soundfile as sf

SR = 22050
HOP = 256

SONGS = {
  'blues': dict(nome='Blues da Casquinha', emoji='🍦', cor='#3aa0ff', desc='Blues sobre a casquinha que caiu no chão', inst='guitar', nomeInst='Guitarra',
                partes=[(0,'guitarra'),(24,'bateria'),(50,'sabre'),(78,'guitarra'),(138,'bateria'),(156,'sabre'),(182,'guitarra')], denso=1.0),
  'chiko': dict(nome='Chikorita na Garra', emoji='🌿', cor='#2fdc6b', desc='Metal árabe com dubstep: a saga da máquina de garra', inst='guitar', nomeInst='Guitarra',
                partes=[(0,'guitarra'),(52,'sabre'),(72,'guitarra'),(124,'bateria'),(166,'guitarra'),(187,'sabre'),(228,'bateria'),(252,'guitarra')], denso=1.0, gapG=0.15),
  'dracula': dict(nome='Drácula, o Morceguinho', emoji='🦇', cor='#b46bff', desc='O morcego que invadiu a festa de Halloween', inst='guitar', nomeInst='Guitarra',
                partes=[(0,'guitarra'),(20,'bateria'),(48,'guitarra'),(108,'sabre'),(132,'guitarra'),(152,'bateria')], denso=1.0),
  'forro': dict(nome='Forró Arretado', emoji='🪗', cor='#ffb800', desc='Sanfona endiabrada. Difícil de verdade!', inst='sanfona', nomeInst='Sanfona',
                partes=[(0,'guitarra'),(34,'bateria'),(56,'guitarra'),(80,'sabre'),(96,'guitarra'),(130,'bateria'),(148,'guitarra')], denso=1.6, gapG=0.085, fonte='raw/forro_lead.wav', poliAcorde=99, acordeForca=88),
}

def load(path, sr=SR):
    return librosa.load(path, sr=sr, mono=True)[0]

def nms(times, scores, mingap):
    """escolhe os eventos mais fortes, sem dois mais perto que mingap"""
    ordem = np.argsort(-np.asarray(scores))
    pegos = []
    tt = np.asarray(times)
    for i in ordem:
        if all(abs(tt[i] - tt[j]) >= mingap for j in pegos):
            pegos.append(i)
    return sorted(pegos, key=lambda i: tt[i])

def grade(beats, sub):
    """grade de subdivisões entre batidas"""
    g = []
    for a, b in zip(beats[:-1], beats[1:]):
        for k in range(sub):
            g.append(a + (b - a) * k / sub)
    g.append(beats[-1])
    return np.array(g)

def encaixa(t, g, tol):
    i = np.searchsorted(g, t)
    cand = [g[j] for j in (i - 1, i) if 0 <= j < len(g)]
    m = min(cand, key=lambda x: abs(x - t))
    return (m, True) if abs(m - t) <= tol else (t, False)

def rms_db(y, t, dur=0.06):
    a = int(max(0, t) * SR); b = int((t + dur) * SR)
    seg = y[a:b]
    return 10 * np.log10(np.mean(seg ** 2) + 1e-10) if len(seg) else -100

# ---------------- guitarra / sanfona ----------------
def notas_guitarra(y, beats, denso):
    import scipy.ndimage as nd
    env0 = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    # normaliza por trecho: assim as partes mais baixinhas também ganham notas
    ref = nd.maximum_filter1d(nd.uniform_filter1d(env0, 9), int(4 * SR / HOP))
    env = env0 / (ref + np.percentile(env0, 50))
    on = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP, units='frames', delta=0.12 / denso ** 1.5, wait=1, normalize=False)
    tons = librosa.frames_to_time(on, sr=SR, hop_length=HOP)
    forca = env[on]
    # ignora ataques onde a guitarra está praticamente muda (vazamento de outros instrumentos)
    niveis = np.array([rms_db(y, t, 0.12) for t in tons])
    ref = np.percentile([rms_db(y, t, 0.5) for t in np.arange(0, len(y) / SR, 0.5)], 75)
    ok = niveis > ref - 16
    tons, forca, niveis = tons[ok], forca[ok], niveis[ok]
    # altura (pitch) de cada nota
    f0, voiced, _ = librosa.pyin(y, fmin=70, fmax=1400, sr=SR, hop_length=HOP, frame_length=2048)
    cent = librosa.feature.spectral_centroid(y=y, sr=SR, hop_length=HOP)[0]
    tf = librosa.frames_to_time(np.arange(len(f0)), sr=SR, hop_length=HOP)
    alturas = []
    for t in tons:
        a, b = np.searchsorted(tf, t + 0.02), np.searchsorted(tf, t + 0.14)
        fs = f0[a:b][voiced[a:b]] if b > a else []
        if len(fs):
            alturas.append(float(np.median(librosa.hz_to_midi(fs))))
        else:
            c = np.median(cent[a:max(b, a + 1)])
            alturas.append(float(librosa.hz_to_midi(max(c / 3, 60))))   # sem afinação clara: usa o "brilho"
    alturas = np.array(alturas)
    g16 = grade(beats, 4)
    return dict(t=tons, forca=forca, altura=alturas, nivel=niveis, g16=g16, y=y)

def trilhas_por_altura(alt, ts):
    """sobe na altura = vai pra direita; usa as 4 trilhas por igual dentro de cada trecho"""
    n = len(alt)
    out = np.zeros(n, int)
    if n == 0: return out
    def absoluta(i):
        m = (ts > ts[i] - 6) & (ts < ts[i] + 6)
        viz = alt[m]
        menores = np.sum(viz < alt[i] - 0.3); iguais = np.sum(np.abs(viz - alt[i]) <= 0.3)
        return int(np.clip(np.floor((menores + iguais / 2) / len(viz) * 4), 0, 3))
    tr = absoluta(0)
    out[0] = tr
    for i in range(1, n):
        d = alt[i] - alt[i - 1]
        if d > 0.5: tr += 2 if d > 4 else 1
        elif d < -0.5: tr -= 2 if d < -4 else 1
        alvo = absoluta(i)
        if tr - alvo > 1: tr -= 1
        elif alvo - tr > 1: tr += 1
        tr = int(np.clip(tr, 0, 3))
        out[i] = tr
    return out

def montar_guitarra(G, dif, denso):
    tons, forca, alt, y = G['t'], G['forca'], G['altura'], G['y']
    mingap = {'facil': 0.42, 'medio': 0.21, 'dificil': G.get('gapDif') or 0.085}[dif]
    tol = {'facil': 0.06, 'medio': 0.045, 'dificil': 0.035}[dif]
    # notas no tempo forte valem mais na hora de escolher
    g8 = G['g16'][::2]
    score = forca.copy()
    for i, t in enumerate(tons):
        _, no8 = encaixa(t, g8, 0.04)
        if no8: score[i] *= 1.6 if dif != 'dificil' else 1.15
    idx = nms(tons, score, mingap)
    sel_t = []
    for i in idx:
        t2, _ = encaixa(tons[i], G['g16'], tol)
        sel_t.append(t2)
    sel_t = np.array(sel_t); sel_a = alt[idx]; sel_f = forca[idx]
    # remove duplicadas depois de encaixar
    keep = [0] + [k for k in range(1, len(sel_t)) if sel_t[k] - sel_t[k - 1] > 0.02]
    sel_t, sel_a, sel_f = sel_t[keep], sel_a[keep], sel_f[keep]
    trs = trilhas_por_altura(sel_a, sel_t)
    notas = []
    corte_acorde = (np.percentile(sel_f, {'medio': 93, 'dificil': 88 - 10 * (denso - 1)}[dif]) if len(sel_f) and dif != 'facil' else 1e9)
    for k, t in enumerate(sel_t):
        prox = sel_t[k + 1] if k + 1 < len(sel_t) else t + 1.5
        vaga = prox - t
        dur = 0.0
        minlong = {'facil': 0.75, 'medio': 0.6, 'dificil': 0.55}[dif]
        if vaga >= minlong:
            # só vira nota longa se o som continua soando
            if rms_db(y, t + 0.35, 0.1) > rms_db(y, t + 0.02, 0.08) - 9:
                dur = round(min(vaga - 0.18, 2.5), 3)
        notas.append(dict(t=round(float(t), 3), trilha=int(trs[k]), dur=dur))
        if sel_f[k] >= corte_acorde and dur == 0:
            outra = trs[k] + 1 if trs[k] < 3 else trs[k] - 1
            if dif == 'dificil' and denso > 1 and trs[k] in (1, 2) and sel_f[k] >= np.percentile(sel_f, 96):
                notas.append(dict(t=round(float(t), 3), trilha=int(trs[k] - 1), dur=0.0))
                notas.append(dict(t=round(float(t), 3), trilha=int(trs[k] + 1), dur=0.0))
            else:
                notas.append(dict(t=round(float(t), 3), trilha=int(outra), dur=0.0))
    # nota longa não pode atravessar outra nota da mesma trilha
    notas.sort(key=lambda n: (n['t'], n['trilha']))
    return dedup(notas)

def dedup(notas):
    vistos, out = set(), []
    for n in notas:
        k = (n['t'], n.get('peca') or n['trilha'])
        if k in vistos: continue
        vistos.add(k); out.append(n)
    return out

# ---------------- bateria ----------------
def banda_env(S, freqs, lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return librosa.onset.onset_strength(S=librosa.power_to_db(S[m] ** 2 + 1e-10), sr=SR, hop_length=HOP)

def picos(env, delta, wait):
    p = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=12, post_avg=12, delta=delta, wait=wait)
    return p

def notas_bateria(y, beats):
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    E = {}
    for nome, lo, hi in [('bumbo', 30, 130), ('caixa', 180, 2500), ('chimbal', 7000, 11000), ('prato', 4000, 11000)]:
        e = banda_env(S, freqs, lo, hi)
        E[nome] = e / (np.percentile(e, 99) + 1e-9)
    hf = S[(freqs >= 4000)].sum(0)
    lvl = 20 * np.log10(hf + 1e-9)
    ev = {}
    for nome, d in [('bumbo', 0.22), ('caixa', 0.25), ('chimbal', 0.18)]:
        p = picos(E[nome], d, 2)
        ev[nome] = (librosa.frames_to_time(p, sr=SR, hop_length=HOP), E[nome][p])
    # prato: ataque forte no agudo que continua soando ~0,4 s depois
    p = picos(E['prato'], 0.45, 20)
    pr = []
    for f in p:
        f2 = min(len(lvl) - 1, f + int(0.4 * SR / HOP))
        if lvl[f2] > lvl[f] - 6 and E['prato'][f] > 0.5:
            pr.append(f)
    ev['prato'] = (librosa.frames_to_time(np.array(pr, int), sr=SR, hop_length=HOP), E['prato'][np.array(pr, int)] if pr else np.array([]))
    # caixa que é só o bumbo vazando: tira
    bt = ev['bumbo'][0]
    ct, cf = ev['caixa']
    m = np.array([not (np.min(np.abs(bt - t)) < 0.03 and f < 0.6) if len(bt) else True for t, f in zip(ct, cf)], bool)
    ev['caixa'] = (ct[m], cf[m])
    # tons: "caixas" com quase nada de chiado agudo e muito grave-médio. Agudo = tom 1, mais grave = tom 2
    ct, cf = ev['caixa']
    fr = librosa.time_to_frames(ct, sr=SR, hop_length=HOP)
    lo_b = (freqs >= 90) & (freqs < 400); hi_b = (freqs >= 1500) & (freqs < 6000)
    r = np.array([S[lo_b, f:f + 4].sum() / (S[hi_b, f:f + 4].sum() + 1e-9) for f in fr]) if len(fr) else np.array([])
    eh_tom = (r > np.percentile(r, 88)) & (r > np.median(r) * 1.5) if len(r) else np.array([], bool)
    band = (freqs >= 80) & (freqs < 500)
    cen = np.array([np.sum(freqs[band] * S[band, f:f + 4].sum(1)) / (S[band, f:f + 4].sum() + 1e-9) for f in fr[eh_tom]]) if eh_tom.any() else np.array([])
    corte = np.median(cen) if len(cen) else 0
    tt, tf_ = ct[eh_tom], cf[eh_tom]
    ev['tom1'] = (tt[cen >= corte], tf_[cen >= corte]) if len(cen) else (np.array([]), np.array([]))
    ev['tom2'] = (tt[cen < corte], tf_[cen < corte]) if len(cen) else (np.array([]), np.array([]))
    ev['caixa'] = (ct[~eh_tom], cf[~eh_tom]) if len(r) else ev['caixa']
    print('   tons', int(eh_tom.sum()), 'de', len(r))
    return ev

def montar_bateria(D, beats, dif, denso):
    g16 = grade(beats, 4); g8 = grade(beats, 2)
    lanes = {'bumbo': 0, 'caixa': 1, 'chimbal': 2, 'prato': 3, 'tom1': 1, 'tom2': 2}
    notas = []
    for peca, (ts, fs) in D.items():
        if len(ts) == 0: continue
        if peca in ('tom1', 'tom2') and dif == 'facil': continue
        if peca in ('tom1', 'tom2'):
            idx = nms(ts, fs, 0.3 if dif == 'medio' else 0.13)
            idx = [i for i in idx if fs[i] > (0.45 if dif == 'medio' else 0.3)]
        elif dif == 'facil':
            if peca == 'chimbal': continue
            gap = 0.55 if peca != 'prato' else 2.0
            idx = nms(ts, fs * np.array([1.5 if encaixa(t, beats, 0.05)[1] else 0.6 for t in ts]), gap)
            idx = [i for i in idx if fs[i] > (0.35 if peca != 'prato' else 0.6)]
        elif dif == 'medio':
            if peca == 'chimbal' and denso <= 1: continue
            gap = {'bumbo': 0.3, 'caixa': 0.3, 'chimbal': 0.42, 'prato': 1.2}[peca]
            idx = nms(ts, fs * np.array([1.4 if encaixa(t, grade(beats, 2), 0.04)[1] else 0.7 for t in ts]), gap)
            if peca == 'chimbal':
                idx = [i for i in idx if encaixa(ts[i], beats, 0.05)[1]]
            idx = [i for i in idx if fs[i] > 0.3]
        else:
            gap = {'bumbo': 0.14 / denso ** 0.5, 'caixa': 0.14 / denso ** 0.5, 'chimbal': 0.17 / denso, 'prato': 0.6}[peca]
            idx = nms(ts, fs, gap)
            idx = [i for i in idx if fs[i] > 0.15]
        for i in idx:
            t2, _ = encaixa(ts[i], g16, 0.035)
            notas.append(dict(t=round(float(t2), 3), trilha=lanes[peca], peca=peca, dur=0.0))
    notas.sort(key=lambda n: (n['t'], n['trilha']))
    notas = dedup(notas)
    # viradas: 3 ou mais caixas bem rapidinhas seguidas descem pelos tons (caixa -> tom 1 -> tom 2)
    if dif != 'facil':
        cx = [n for n in notas if n['peca'] == 'caixa']
        k = 0
        while k < len(cx):
            j = k
            while j + 1 < len(cx) and cx[j + 1]['t'] - cx[j]['t'] <= 0.22: j += 1
            if j - k >= 2:
                run = cx[k:j + 1]
                for q, n in enumerate(run):
                    p = ['caixa', 'tom1', 'tom2'][min(2, q * 3 // len(run))]
                    n['peca'] = p; n['trilha'] = {'caixa': 1, 'tom1': 1, 'tom2': 2}[p]
            k = j + 1
    # no fácil e no médio, no máximo 2 ao mesmo tempo (e o prato manda)
    if True:
        out = []
        prio = {'prato': 0, 'bumbo': 1, 'caixa': 2, 'tom1': 2, 'tom2': 2, 'chimbal': 3}
        for n in sorted(notas, key=lambda n: (round(n['t'], 2), prio[n['peca']])):
            mesmos = [x for x in out if abs(x['t'] - n['t']) < 0.02]
            if len(mesmos) >= {'facil': 1, 'medio': 2, 'dificil': 2 if denso <= 1 else 3}[dif]: continue
            out.append(n)
        notas = sorted(out, key=lambda n: (n['t'], n['trilha']))
    # o Lucas achou a bateria difícil demais: fica só metade das notas (as mais importantes)
    peso_peca = {'prato': 3.0, 'caixa': 2.4, 'bumbo': 2.2, 'tom1': 2.0, 'tom2': 2.0, 'chimbal': 1.0}
    def peso(n):
        nob = np.min(np.abs(beats - n['t'])) < 0.04
        no8 = np.min(np.abs(g8 - n['t'])) < 0.04
        return peso_peca[n['peca']] + (2 if nob else 1 if no8 else 0)
    if notas:
        corte = sorted((peso(n) for n in notas), reverse=True)[len(notas) // 2]
        notas = [n for n in notas if peso(n) > corte] + [n for n in notas if peso(n) == corte][:max(0, len(notas) // 2 - sum(1 for n in notas if peso(n) > corte))]
        notas.sort(key=lambda n: (n['t'], n['trilha']))
    return notas

# ---------------- sabre (caixinhas) ----------------
def montar_sabre(D, beats, dif, denso):
    """Caixinhas no estilo Beat Saber, seguindo as regras de mapeamento:
    - cada mão alterna corte pra baixo / pra cima (paridade): o dedo desce antes de poder subir de novo;
    - depois de uma pausa longa a mão "reseta" e começa de novo pra baixo;
    - vermelha do lado esquerdo, azul do direito (sem cruzar as mãos);
    - no fácil quase tudo na fileira de baixo; no médio/difícil variam altura e coluna;
    - às vezes um trecho inteiro com cortes de lado (esquerda/direita), também alternando."""
    g8 = grade(beats, 2)
    bt = D['bumbo'][0]; ct = D['caixa'][0]; pt = D['prato'][0]
    perto = lambda arr, t, tol=0.06: len(arr) > 0 and np.min(np.abs(arr - t)) < tol
    if dif == 'facil': base = list(beats[::2])
    elif dif == 'medio': base = list(beats)
    else: base = [t for t in g8 if np.min(np.abs(beats - t)) < 0.02 or perto(bt, t) or perto(ct, t)]
    base = np.array(sorted(base))
    gap_total = {'facil': 0.8, 'medio': 0.4, 'dificil': 0.24}[dif]
    gap_mao = {'facil': 1.4, 'medio': 0.75, 'dificil': 0.42}[dif]
    out = []
    ult = {0: -9, 1: -9}; prox_dir = {0: 'baixo', 1: 'baixo'}; col = {0: 0, 1: 3}
    mao = 0; frase_h = False; frase_ant = -1
    for t in base:
        if out and t - out[-1]['t'] < gap_total: continue
        # escolhe a mão: alterna; se a outra ainda não "voltou", usa a mesma
        m = mao
        if t - ult[m] < gap_mao: m = 1 - m
        if t - ult[m] < gap_mao * 0.8: continue
        if t - ult[m] > 1.6: prox_dir[m] = 'baixo'   # pausa longa: reseta
        frase = int(np.searchsorted(beats, t) // 16)
        if frase != frase_ant:
            frase_ant = frase
            frase_h = dif != 'facil' and frase % 4 == 3      # 1 em cada 4 frases com cortes de lado
            col = {0: 0, 1: 3} if frase % 2 == 0 or dif == 'facil' else {0: 1, 1: 2}
        d = prox_dir[m]
        if frase_h: d = {'baixo': 'esq' if m == 0 else 'dir', 'cima': 'dir' if m == 0 else 'esq'}[d]
        c = col[m]
        if frase_h: c = (0 if d == 'esq' else 1) if m == 0 else (2 if d == 'esq' else 3)
        # altura: pra baixo começa mais alto, pra cima começa embaixo
        if dif == 'facil': row = 0
        elif d == 'baixo': row = 2 if perto(pt, t, 0.08) else 1
        elif d == 'cima': row = 0
        else: row = 1 if dif == 'dificil' else 0
        if c in (1, 2) and row == 1: row = {'cima': 0, 'baixo': 2}.get(d, 0)   # nada bem na frente do rosto
        out.append(dict(t=round(float(t), 3), lado=m, dir=d, col=int(c), row=int(row)))
        ult[m] = t; prox_dir[m] = 'cima' if prox_dir[m] == 'baixo' else 'baixo'
        mao = 1 - m
        # prato no difícil: as duas mãos juntas, cada uma no seu próprio movimento
        o = 1 - m
        if dif == 'dificil' and not frase_h and perto(pt, t, 0.08) and t - ult[o] >= gap_mao:
            if t - ult[o] > 1.6: prox_dir[o] = 'baixo'
            d2 = prox_dir[o]
            out.append(dict(t=round(float(t), 3), lado=o, dir=d2, col=0 if o == 0 else 3, row=2 if d2 == 'baixo' else 0))
            ult[o] = t; prox_dir[o] = 'cima' if d2 == 'baixo' else 'baixo'
    return out

# ---------------- áudio ----------------
def exportar_audio(sid, inst, pasta):
    import librosa as L
    mix, _ = L.load(f'raw/{sid}_mix.mp3', sr=44100, mono=False)
    gu, _ = L.load(f'raw/{sid}_{inst}.mp3', sr=44100, mono=False)
    dr, _ = L.load(f'raw/{sid}_drums.mp3', sr=44100, mono=False)
    n = min(mix.shape[1], gu.shape[1], dr.shape[1])
    fundo = mix[:, :n] - gu[:, :n] - dr[:, :n]
    for nome, x, kb in [('fundo', fundo, 128), ('guitarra', gu[:, :n], 96), ('bateria', dr[:, :n], 96)]:
        wav = f'/tmp/{sid}_{nome}.wav'
        sf.write(wav, x.T, 44100)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-b:a', f'{kb}k', '-ar', '44100', os.path.join(pasta, nome + '.mp3')], check=True)
        os.remove(wav)

def main(sid, so_mapa=False):
    S = SONGS[sid]
    pasta = os.path.join('out', sid); os.makedirs(pasta, exist_ok=True)
    mix = load(f'raw/{sid}_mix.mp3')
    gu = load(f'raw/{sid}_{S["inst"]}.mp3')
    dr = load(f'raw/{sid}_drums.mp3')
    n = min(len(mix), len(gu), len(dr)); mix, gu, dr = mix[:n], gu[:n], dr[:n]
    dur = len(mix) / SR
    tempo, bf = librosa.beat.beat_track(y=dr + 0.3 * mix, sr=SR, hop_length=HOP, units='time', tightness=200)
    beats = np.asarray(bf, float)
    print(sid, 'bpm', tempo, 'batidas', len(beats))
    import guit, pickle
    cachep = f'/tmp/{sid}_guit.pkl'
    if os.path.exists(cachep): A, E = pickle.load(open(cachep, 'rb'))
    else:
        yg = load(S['fonte']) if S.get('fonte') else gu
        A = guit.analisar(yg); pickle.dump((A, None), open(cachep, 'wb'))
    yg = load(S['fonte']) if S.get('fonte') else gu
    E = guit.segmentar_palhetadas(A, yg, S.get('deltaP', 0.18))
    g16 = grade(beats, 4); g8 = grade(beats, 2)
    fcorte = np.percentile([e['forca'] for e in E], S['acordeForca']) if S.get('acordeForca') else 1e9
    gd = guit.finalizar(guit.afinar(guit.montar(E, g16, 'dificil', lambda e: (e['poli'] >= S.get('poliAcorde', 3) and e['voz'] < 0.3) or e['forca'] >= fcorte), S.get('gapG', 0.1)))
    GUIT = {'dificil': gd, 'medio': guit.simplificar(gd, 'medio', g8, beats), 'facil': guit.simplificar(gd, 'facil', g8, beats)}
    D = notas_bateria(dr, beats)
    # partes: começo de cada parte encaixa na batida mais perto
    partes = [dict(t=round(float(encaixa(t, beats, 9)[0]) if t > 0 else 0.0, 3), instr=i) for t, i in S['partes']]
    notas = {}
    for dif in ('facil', 'medio', 'dificil'):
        notas[dif] = dict(guitarra=GUIT[dif], bateria=montar_bateria(D, beats, dif, S['denso']),
                          sabre=montar_sabre(D, beats, dif, S['denso']))
        print(' ', dif, {k: len(v) for k, v in notas[dif].items()})
    mapa = dict(v=2, id=sid, nome=S['nome'], emoji=S['emoji'], cor=S['cor'], desc=S['desc'], nomeGuitarra=S['nomeInst'],
                duracao=round(dur, 2), batidas=[round(float(b), 3) for b in beats], partes=partes, notas=notas)
    with open(os.path.join(pasta, 'mapa.json'), 'w') as f:
        json.dump(mapa, f, separators=(',', ':'), ensure_ascii=False)
    if not so_mapa:
        exportar_audio(sid, S['inst'], pasta)

if __name__ == '__main__':
    main(sys.argv[1], '--mapa' in sys.argv)
