# Instruções para o Claude neste repositório

- Fale em português com o Lucas. Ele não é programador: explique em termos simples
  e diga o que ele precisa fazer, se houver algo. Ele prefere que você discorde com franqueza.
- Palhetada é um jogo de ritmo estilo "guitarra de plástico" pelo navegador (celular em pé, 4 trilhas).
  Tudo original: as músicas são compostas pelo código (sem arquivos de áudio).
- Usa o MESMO projeto Firebase do Forma Palavras (`caca-palavras-6cd16`), num caminho próprio
  (`palhetada/rooms/...`), e o mesmo perfil/boneco. Não quebre os outros jogos.
- Nunca mexa no Aura Battle (`duels-game`) nem no Firebase dele.
- `main` é o que está no ar: todo push em `main` publica o site no GitHub Pages.

## Como funciona

- `public/js/musica.js`: as 4 músicas (semente fixa = mesmas notas pra todo mundo), a "partitura"
  de cada dificuldade e a banda sintetizada. A melodia só soa quando o jogador acerta.
- `public/js/jogo.js`: tela, toques, pontuação, combo, energia ⚡, salas.
- Multiplayer: o anfitrião escolhe a música e marca um horário de início (relógio do servidor);
  cada um escolhe a própria dificuldade. Cada celular manda `estado/{uid}` (pontos ao vivo) e
  `resultado/{uid}` no fim.
- `database.rules.json` tem as regras do projeto INTEIRO (Forma Palavras + Pé na Tábua + Torre Bamba
  + Cripta + Palhetada). Ao mudar, peça pro Lucas colar no Console do Firebase.

## Troca de instrumento (opção do anfitrião)

- `meta.instr` = `{ troca, guitarra, bateria, teclado }` (no modo sozinho, `escolha.instr`). Com `troca`
  ligado, cada parte da música tem um instrumento (A guitarra, B bateria, A2 teclado, C guitarra);
  instrumento desligado é trocado por outro ligado. Tudo determinístico: todo mundo recebe as mesmas trocas.
- `musica.js`: `partitura(m, dif, instr)` gera notas com `instr` (bateria: trilhas = bumbo, caixa, chimbal, prato;
  teclado: as 4 notas do acorde). A banda não toca a parte do jogador e toca a melodia sozinha quando ele
  não está na guitarra. `trocas` = onde o instrumento muda (a tela troca 0,9 s antes).
- Custom songs (arquivo) por enquanto só guitarra; as do Suno com faixas separadas são o próximo passo.

## Testar

- Sirva uma pasta com `palhetada/` (= public) e `forma-palavras/` lado a lado e abra
  `palhetada/index.html?local=1` em duas abas. `&robo=1` faz o jogo tocar sozinho.

## Músicas extras (custom songs, trancadas por senha)

- Músicas de artistas NÃO vão pro GitHub (é público). Ficam no Firebase em `palhetada/extras/` e só
  quem digitou a senha consegue ler (`extras/vip/{uid}`). A senha real fica SÓ nas regras coladas no
  Console do Firebase; aqui no `database.rules.json` ela aparece como `SENHA_SO_NO_CONSOLE`.
  Ao mandar regras novas pro Lucas, troque esse texto pela senha antes (ele sabe qual é).
- `public/js/extras.js`: lista, baixa (e guarda no celular, IndexedDB) e envia músicas.
- Converter custom song do Clone Hero (.sng) em pacote `.palhetada.json`: desempacotar o .sng,
  converter `notes.chart`/`notes.mid` em mapa de 4 trilhas (Difícil = Expert; Médio = Hard ou Expert
  simplificado; Fácil = Medium ou simplificado), áudio em MP3 112k, capa 160px. O Lucas envia o pacote
  pela tela "🔒 Músicas extras → Enviar músicas".
- `public/musicas/` fica fora do git (só pra testes/prévia local).

## Músicas do Suno (faixas separadas)

- Ficam em `public/faixas/<pasta>/`: `fundo.mp3` (música sem guitarra e sem bateria), `guitarra.mp3`, `bateria.mp3`
  e `mapa.json` (v2: `batidas`, `partes` [{t, instr}], `notas[dif][guitarra|bateria|sabre]`). A lista fica em `SUNO` (musica.js).
- São do Lucas (feitas no Suno Pro dele), por isso podem ficar no repositório público.
- Como fazer uma nova: no Suno, separar as faixas (12 partes), baixar a música + a faixa do instrumento principal
  (guitarra; no forró a sanfona veio em "brass") + bateria (cada arquivo gasta 1 download do mês: pergunte antes).
  O computador do Claude não alcança os servidores do Suno: o navegador do app do Lucas baixa na pasta Downloads
  e o Claude pega de lá. Depois `tools/gerar_mapas_suno.py <id>` (precisa de librosa) gera mapa + áudios; as
  `partes` (que instrumento em cada trecho) são escolhidas à mão no SONGS do script.
- Guitarra (`tools/guit.py`, método do Lucas): só tem nota onde a faixa está soando; UMA nota por palhetada de verdade
  (subida rápida de energia nos agudos, `palhetadas()`), nada de nota extra em vibrato/bend; som sustentado (>0,42 s) = nota longa; mesma nota = mesma trilha, subiu = direita,
  desceu = esquerda; acorde de verdade (vários sons juntos) = 2 notas com a mesma forma enquanto o acorde se repete.
  O Difícil sai do som; Médio e Fácil são simplificações dele (palhetada rápida na mesma nota vira nota longa).
  O forró usa a sanfona da mistura (música − bateria, sem graves), porque a faixa "brass" só tinha parte dela.
- Sabre: grade 4 colunas x 3 alturas (`col`, `row`), caixinhas pequenas; cada mão alterna baixo/cima (paridade do
  Beat Saber), reseta pra baixo depois de pausa; vermelha à esquerda, azul à direita; 1 em cada 4 frases com cortes
  de lado. O corte vale pra caixinha mais perto do risco do dedo (tipo Fruit Ninja).
- No jogo: `BandaFaixas` toca as 3 faixas juntas; errar abaixa a faixa do seu instrumento até acertar de novo.
- Bateria (em todas as músicas): uma bateria de verdade desenhada (`geoKit`): 2 pratos elevados, caixa, tom 1, tom 2
  e bumbo (com metade das notas que o detector acha: o Lucas achou difícil demais). As notas caem em trilhas até a peça (o bumbo é uma barra roxa atravessando a tela) e a peça acende na hora. Toque na peça (faixa de baixo = bumbo); no PC: S D F J K + espaço (bumbo).
  Energia no PC também com E. `chimbal` do mapa = prato da esquerda; `prato` = prato da direita.
- Zoom do navegador bloqueado (pinça e toque duplo) pra não atrapalhar os gestos.
- "Sabre" (caixinhas estilo Beat Saber) só existe nessas músicas: corte arrastando o polegar na direção da seta
  (metade esquerda da tela = caixa vermelha, direita = azul). No PC: W A S D (esquerda) e setas (direita).
  Só aparece com "Trocar de instrumento" ligado.
