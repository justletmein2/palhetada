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

## Testar

- Sirva uma pasta com `palhetada/` (= public) e `forma-palavras/` lado a lado e abra
  `palhetada/index.html?local=1` em duas abas. `&robo=1` faz o jogo tocar sozinho.
