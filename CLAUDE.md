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
