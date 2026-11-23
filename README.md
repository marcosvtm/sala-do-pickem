# Sala do Pick’Em

Calculadora em português para montar um cartão do Stage 1 do PGL Major de Singapura, testar modelos pessoais e compartilhar cartões salvos e modelos por link. O cálculo roda no navegador em um Web Worker. O endereço de produção fica no campo **About** deste repositório.

## Rodar e contribuir

Use Node.js 22.13 ou mais recente, com SQLite nativo.

```sh
npm ci
npm run dev
```

Abra o endereço local impresso pelo servidor. Para conferir o motor:

```sh
npm test
```

Faça um fork, crie uma branch e envie o pull request contra `main`. Conte o que mudou e como reproduzir. Mudanças no pareamento, na pontuação ou nas fórmulas devem incluir um caso que verifique o comportamento. Para uma mudança de interface, vale conferir um cartão no celular. O mantenedor publica pelo Sites após escolher a revisão. Um merge por si só não publica o site.

## Organização

- `dist/` contém o frontend editável. `npm run build` empacota os recursos e a API em um Worker do Sites em `dist/server/`.
- `server/` valida e salva os cartões e consulta a chave da PGL. O banco público usa o binding D1 `DB`. O ambiente de desenvolvimento aplica as mesmas migrações a `.local/cards.sqlite`. Para alterar o esquema, edite `db/schema.js`, rode `npm run db:generate` e versione a migração.
- `dist/data/stage.json` guarda os 16 seeds, os ratings e o cartão de referência dos testes. Na primeira visita, as dez vagas começam vazias. O navegador guarda os picks conforme o visitante os escolhe. Os índices das equipes seguem a ordem dos seeds e fazem parte do formato dos links.
- `dist/js/swiss.js` monta cada rodada a partir dos resultados anteriores. O pareamento segue recorde, Buchholz, seed e as prioridades de revanche da Valve.
- `dist/js/models.js` calcula a probabilidade por confronto e formato. `simulation.js` pontua torneios completos, por amostragem ou enumeração. `worker.js` agenda o cálculo, `state.js` valida cartões e cenários e `app.js` cuida da interface.
- `tests/` contém o replay das 33 partidas de Cologne, verificações de probabilidades, pontuação, caminhos ponderados e consistência da amostragem.

## Modelos e dados

### Cartões da galera

O mural em `/cartoes` aceita um cartão definitivo por nick e fase, mesmo sem simulação anterior. O nick é público e autodeclarado. A regra de fechamento usa o horário da estreia em `dist/data/stage.json` menos uma hora. O servidor e a escrita no banco verificam o prazo. O cartão registra os dez times, a versão dos dados, o modelo e seus ajustes. Os resultados hipotéticos do simulador ficam fora da disputa.

Durante a fase, o mural consulta o servidor a cada minuto enquanto estiver aberto. O servidor limita consultas à PGL e guarda em D1 a última chave validada. Só entram séries encerradas, pareadas por adversários, rodada e formato. Se a fonte mudar ou ficar indisponível, o mural sinaliza a última leitura. Cada expansão mostra acerto, erro ou vaga em aberto. As probabilidades inicial e condicional usam os parâmetros congelados, 12 mil fases por estimativa e enumeração exata quando restam até nove jogos. O índice de Brier compara as probabilidades de vitória por confronto com os vencedores publicados. O ranking de cartões conta os acertos das dez vagas.

A fase usa o quadro de participantes e seeds da PGL. Os dados de força têm corte em **20 de novembro de 2026, 18h UTC**. Os pontos VRS vêm do ranking de 2 de novembro. O Elo de forma foi estimado no estudo original com resultados anteriores à fase, ajuste por adversário, meia-vida de 160 dias e redução da influência de elencos antigos. A extração histórica do projeto incluiu 14.148 séries. As forças estão congeladas durante a etapa. A foto de Singapura e as marcas das equipes são creditadas à página do evento e a seus respectivos titulares.

[Evento e equipes da PGL](https://www.pglesports.com/cs2/pgl-major-singapore-2026/) · [Regras de pareamento](https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/745a40758ed7877483d5544605cda6c6e1a1cd65/major-supplemental-rulebook.md) · [Rankings Valve](https://github.com/ValveSoftware/counter-strike_regional_standings) · [Arquivo de resultados de partidas](https://bo3.gg/matches/finished)

O neutro atribui 50% a ambos os lados. No modelo VRS, a diferença dos pontos é dividida por 340 em MD1 ou 255 em MD3 e convertida pela função logística. No Elo, a diferença é dividida por 170 e multiplicada por 0,73 nas MD1. O editor aceita de 0 a 100 pontos por modelo e calcula a média ponderada das quatro probabilidades de vitória de cada confronto. Os pontos são relativos ao total. Por exemplo, 40 pontos Valve e 20 HLTV dão participações de 2/3 e 1/3 quando os demais pesos estão zerados. Com todos os pesos em zero, a chance é 50/50. A confiança individual aproxima o sinal de cada time da média das 16 equipes (pontos Valve, Elo ou log da posição HLTV). O ajuste de Major soma a diferença de bônus na escala de log-odds da série antes da mistura. A parcela neutra vale sempre 50%. A força exibida é a média das probabilidades contra os outros 15 adversários no formato selecionado. Cartões e modelos anteriores conservam sua fórmula de origem.

O botão **Salvar modelo** publica os ajustes diretamente, mesmo com o cartão vazio. Cada versão tem um link próprio e horário de publicação; salvar outra vez o mesmo conjunto de ajustes com o mesmo nick recupera a versão existente. O prazo competitivo continua aplicado ao registro dos cartões. O mural reúne modelos independentes e cópias registradas com cartões.

### Ranking HLTV

O modelo usa a posição mundial das 16 equipes na [edição de 16/11/2026 da HLTV](https://www.hltv.org/ranking/teams/2026/november/16), a última disponível no corte de 20/11. Para a equipe A, a chance de vencer um mapa é `p = 1 / (1 + (posiçãoA / posiçãoB) ** 0.306262)`. Em MD3, a chance de ganhar dois mapas primeiro é `p² (3 − 2p)`, assumindo mapas independentes com a mesma chance. Os pontos do VRS e os ajustes pessoais pertencem aos outros modelos.

Para reproduzir o ajuste, execute `node scripts/calibrate-hltv.js`. O arquivo `research/hltv-series.csv` registra a edição semanal, a data da partida, o identificador textual no [histórico de resultados da BO3](https://bo3.gg/matches/finished), o formato, as posições e o vencedor. Em 14 edições entre março e novembro de 2026, cruzamos as equipes do top 64 com as séries do acervo disputadas da terça ao domingo seguintes. Entraram as MD1 e MD3 com vencedor confirmado pelos mapas e ambas as equipes identificadas.

O coeficiente minimiza a perda logarítmica nas 318 séries anteriores a outubro. Nas 174 séries reservadas de outubro e novembro, o Brier foi 0,2495 (50/50: 0,2500) e a perda logarítmica foi 0,6938 (50/50: 0,6931). Só três séries dessa avaliação eram MD1. Os resultados sustentam uma leitura cautelosa, especialmente para esse formato.

### Sugestão de cartão

Na Sala, a busca usa o modelo ativo, seus ajustes e os resultados fixados para maximizar a chance de cinco ou mais acertos. O Web Worker testa trocas de equipes entre as três categorias e os seis times de fora. Na busca rápida, oito pontos de partida usam 8.192 torneios simulados. Uma segunda amostra de 16.384 compara finalistas entre rodadas de busca. As porcentagens exibidas para o cartão atual e o sugerido usam os mesmos 32.768 torneios de validação, com uma terceira semente. A busca é heurística.

O refinamento conserva o candidato mais bem pontuado na seleção, renova a amostra de busca a cada oito pontos de partida e continua por 10, 30 ou 60 segundos, ou até a pessoa parar. Cada refinamento concluído acrescenta 32.768 cenários de validação até 131.072. Com a chave inteira fixada, o resultado é calculado diretamente. Aplicar altera apenas o rascunho.

## Interpretação

A prévia usa 12 mil fases por modelo e uma semente fixa. Todos os modelos recebem a mesma sequência de sorteios por posição na chave, mesmo após divergirem nos adversários. Para um cartão completo, conta-se a proporção com cinco ou mais acertos. A faixa de Wilson é nominal de 95% para uma amostra fixa. Parar seletivamente ao observar os resultados pode afetar a cobertura. A simulação contínua dura enquanto a aba puder executar. O navegador pode suspender abas em segundo plano.

A enumeração visita cada sequência possível de vencedores uma vez e soma sua massa segundo o modelo em destaque. No início são 2³³ caminhos. Fixar resultados reduz a dimensão e permite fechar casos tardios rapidamente. Até terminar, o site exibe limites válidos a partir da massa conhecida de sucesso e de fracasso. A chave começa com todos os confrontos em aberto. Os resultados são inseridos pelo usuário e tratados como dados. Trocar o vencedor de uma rodada invalida as rodadas seguintes.

O link de um cartão salvo abre o registro público em `/cartoes#<id>`. Cada cartão também publica uma cópia dos ajustes do modelo pessoal em `/modelos?modelo=<id>`, inclusive quando o autor escolhe um modelo predefinido para pontuar. O visitante pode usar e editar uma cópia desses ajustes. O cartão e os resultados hipotéticos do visitante são preservados. Links antigos de cenário continuam abrindo o simulador.

Em `/partidas`, um clique explora os próximos confrontos. Dois cliques fixam o resultado e recalculam o cartão. Ao fixar uma partida futura, o simulador fixa primeiro as rodadas anteriores da chave exibida. Uma mudança em rodada anterior solta os resultados dependentes. Resultados oficiais têm prioridade. A agenda da inicial é consultada a cada minuto com a página visível, usa horários de Cuiabá e avança pela rodada informada na agenda da PGL. Os links da HLTV correspondem aos jogos programados do Stage 1. O arquivo `dist/data/schedule.json` fornece a programação inicial em caso de indisponibilidade da fonte.
