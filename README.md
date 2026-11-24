# Pick'em dos Broxinhas

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

Publique atualizações no mesmo projeto Sites, com o endereço público e o banco D1 existentes. Mantenha a versão atual disponível enquanto prepara a próxima. Mudanças de formato devem continuar lendo os cartões, modelos e rascunhos já salvos, inclusive seus links e as chaves do navegador.

## Organização

- `dist/` contém o frontend editável. `npm run build` empacota os recursos e a API em um Worker do Sites em `dist/server/`.
- `server/` valida e salva os cartões e consulta a chave da PGL. O banco público usa o binding D1 `DB`. O ambiente de desenvolvimento aplica as mesmas migrações a `.local/cards.sqlite`. Para alterar o esquema, edite `db/schema.js`, rode `npm run db:generate` e versione a migração.
- `dist/data/stage.json` guarda os 16 seeds, os ratings e o cartão de referência dos testes. Na primeira visita, as dez vagas começam vazias. O navegador guarda os picks conforme o visitante os escolhe. Os índices das equipes seguem a ordem dos seeds e fazem parte do formato dos links.
- `dist/js/swiss.js` monta cada rodada a partir dos resultados anteriores. O pareamento segue recorde, Buchholz, seed e as prioridades de revanche da Valve.
- `dist/js/models.js` calcula a probabilidade por confronto e formato. `simulation.js` pontua torneios completos, por amostragem ou enumeração. `worker.js` agenda o cálculo, `state.js` valida cartões e cenários e `app.js` cuida da interface.
- `tests/` contém o replay das 33 partidas de Cologne, verificações de probabilidades, pontuação, caminhos ponderados e consistência da amostragem.

## Modelos e dados

### Ranking dos Broxas

Em `/ranking`, cada participante aparece com os acertos confirmados do cartão do Stage 1. Empates dividem posição, e as três primeiras posições com pontos recebem destaque. O placar usa a mesma pontuação do mural e consulta os resultados oficiais a cada minuto enquanto a página está visível.

Ao abrir um nick, o servidor procura uma correspondência única nas estatísticas públicas do [Ranking Broxas](https://rankingbroxas.duckdns.org/). A comparação tolera maiúsculas, acentos e pontuação. O painel mostra a nota e os jogos do mês vigente em Cuiabá e o nível GC da última partida com esse dado. Somente cartões registrados têm um perfil consultável. Uma indisponibilidade da fonte externa afeta apenas os dados complementares.

### Cartões dos Broxas

O mural em `/cartoes` aceita um cartão por nick e fase, mesmo sem simulação anterior. Até o contador zerar, o visitante pode editar ou excluir os cartões que salvou nesse navegador. Uma chave aleatória local autoriza as mudanças e o banco guarda apenas seu hash. O mural confere a revisão do registro a cada alteração. A exclusão libera o nick, remove os dados do cartão e retira do mural a cópia do modelo vinculada a ele. O identificador fica reservado para que uma requisição antiga não restaure o cartão. Cartões criados antes da emissão dessas chaves permanecem disponíveis para consulta e compartilhamento. O nick é público e autodeclarado. A regra de fechamento usa o horário da estreia em `dist/data/stage.json` menos uma hora. O servidor e a escrita no banco verificam o prazo. O cartão registra os dez times, a versão dos dados, o modelo e seus ajustes. Os resultados hipotéticos do simulador ficam fora da disputa.

Durante a fase, o mural consulta o servidor a cada minuto enquanto estiver aberto. O servidor limita consultas à PGL e guarda em D1 a última chave validada. Só entram séries encerradas, pareadas por adversários, rodada e formato. Se a fonte mudar ou ficar indisponível, o mural sinaliza a última leitura. Cada expansão mostra acerto, erro ou vaga em aberto. As probabilidades inicial e condicional usam os parâmetros congelados, 12 mil fases por estimativa e enumeração exata quando restam até nove jogos. O índice de Brier compara as probabilidades de vitória por confronto com os vencedores publicados. O ranking de cartões conta os acertos das dez vagas.

A fase usa o quadro de participantes e seeds da PGL. Os dados de força têm corte em **20 de novembro de 2026, 18h UTC**. Os pontos VRS vêm do ranking de 2 de novembro. A forma recente é calculada com resultados anteriores à fase, ajuste por adversário, meia-vida de 160 dias e redução da influência de elencos antigos. A extração histórica do projeto incluiu 14.148 séries. As forças estão congeladas durante a etapa.

As fotos de Cartões e Ranking são do grupo dos Broxas. A capa de FalleN é uma montagem criada com IA, com uma interpretação artística da taça. O emblema é da PGL e as marcas das equipes pertencem aos respectivos titulares. [Emblema do Major na Liquipedia](https://liquipedia.net/counterstrike/File:PGL_Major_Singapore_2026_darkmode.png)

[Evento e equipes da PGL](https://www.pglesports.com/cs2/pgl-major-singapore-2026/) · [Regras de pareamento](https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/745a40758ed7877483d5544605cda6c6e1a1cd65/major-supplemental-rulebook.md) · [Rankings Valve](https://github.com/ValveSoftware/counter-strike_regional_standings) · [Arquivo de resultados de partidas](https://bo3.gg/matches/finished)

O neutro atribui 50% a ambos os lados. No modelo VRS, a diferença dos pontos é dividida por 340 em MD1 ou 255 em MD3 e convertida pela função logística. No Elo, a diferença é dividida por 170 e multiplicada por 0,73 nas MD1. O editor aceita de 0 a 100 pontos por modelo e calcula a média ponderada das cinco probabilidades de vitória de cada confronto. Os pontos são relativos ao total. Por exemplo, 40 pontos Valve e 20 HLTV dão participações de 2/3 e 1/3 quando os demais pesos estão zerados. Com todos os pesos em zero, a chance é 50/50. A confiança individual aproxima o sinal de cada time da média das 16 equipes nos modelos de ranking e forma. O Modelo IA traz uma probabilidade por confronto. Para aplicar confiança parcial, o simulador interpola entre a previsão do duelo e a chance média de um time do grupo contra aquele adversário, separadamente para cada lado e formato. Com confiança zero de ambos os lados, a base do confronto é 50%. O ajuste de Major soma a diferença de bônus na escala de log-odds da série antes da mistura. A parcela neutra vale sempre 50%. A força exibida é a média das probabilidades contra os outros 15 adversários no formato selecionado. Cartões e modelos anteriores conservam sua fórmula de origem.

O botão **Salvar modelo** publica os ajustes diretamente, mesmo com o cartão vazio. Cada versão tem um link próprio e horário de publicação; salvar outra vez o mesmo conjunto de ajustes com o mesmo nick recupera a versão existente. O prazo competitivo continua aplicado ao registro dos cartões. O mural reúne modelos independentes e cópias registradas com cartões.

### Forma recente e exposição regional

A revisão usa os mesmos 14.148 resultados do estudo. O incremento original é `K × (resultado − probabilidade)`, com K de 32 em MD1 e 43 nas séries mais longas. Na nova edição, vitórias e derrotas recebem o mesmo multiplicador de evidência:

- Cada encontro anterior do par contribui para R com meia-vida de 60 dias. O fator de repetição é `1 / √(1 + R)`.
- Para cada equipe, E soma **rivais distintos de outras regiões** enfrentados nos 120 dias anteriores, com meia-vida de 60 dias desde o último confronto com cada um. Um jogo inter-regional confirmado recebe fator 1. Os demais recebem `0,25 + 0,75 × min(1, max(Ea, Eb)/4)`. Assim, um adversário com calendário variado também pode conectar dois circuitos.
- As regiões vêm da edição mensal da Valve que já era pública na data do jogo: Américas, Europa e Ásia (incluindo Oceania). Uma equipe ausente da tabela deixa a região daquele confronto indeterminada. As duas informações são calculadas **antes** de incorporar o resultado. O peso final é o produto dos fatores. O valor dos pontos VRS não entra nesse Elo.

Escolhemos o piso entre 0,25, 0,50 e 0,75 e o coeficiente de R entre 0,5 e 1, minimizando log loss nas 237 séries de junho a agosto. Nos 324 jogos posteriores (setembro até o corte), Brier anterior/revisado foi 0,2489/0,2430 e log loss foi 0,6921/0,6792. Nos 120 duelos inter-regionais confirmados, o Brier foi 0,2317/0,2311. Houve somente 20 jogos inter-regionais em que pelo menos uma equipe tinha menos de dois rivais externos distintos nos 120 dias anteriores. Esses testes históricos não demonstram a força de uma região específica.

Execute `python scripts/calibrate-form.py` para reproduzir a seleção, os indicadores e as forças, ou acrescente `--write` para atualizar o JSON da fase. O replay offline usa `research/form-history.json.gz`, que reúne as séries limpas, a continuidade dos elencos, as regiões publicadas e os cortes temporais por torneio. Para reextrair esse arquivo a partir do diretório `forecast/` do estudo congelado, use `python scripts/prepare-form-history.py CAMINHO_PARA_FORECAST` com Python 3.11 ou posterior. O script consulta as tabelas regionais nos mesmos commits históricos da [Valve](https://github.com/ValveSoftware/counter-strike_regional_standings).

Novos rascunhos e registros incluem `formVersion: 2`. Registros publicados antes da revisão continuam com o Elo arquivado, inclusive nas misturas, nos links e no mural. Um rascunho de uma cópia histórica pode adotar a nova edição pela aba Modelos.

### Modelo IA do estudo de Singapura

O preset `study` usa a matriz `central` da edição T1-v1 da [análise pré-Major dos 16 times do Stage 1](https://singapore-major-pickem-2026-br.marcosvtm.chatgpt.site/). O arquivo `dist/data/study-v1.js` contém os nomes de `forecast/v1/teams.json` e as duas matrizes de `forecast/v1/matrices.json` com a precisão original. A consulta associa as equipes pelo nome e escolhe a matriz conforme o formato da série. Essa mesma consulta alimenta as simulações, a sugestão, os confrontos e o mural.

Na MD1, o estudo calcula a média entre a previsão de força por mapa (55% Valve e 45% Elo original em log-odds) e a previsão com veto. Na MD3, aplica a força por mapa à série de três mapas independentes. O estudo também é a quinta opção na mistura pessoal. Novas misturas começam com 20 pontos por modelo. Cartões e modelos antigos atribuem zero pontos ao estudo. Com todo o peso no estudo e os ajustes individuais no padrão, cada confronto reproduz a matriz publicada. O teste do Modelo IA confere a assinatura SHA-256 da matriz central serializada em ordem de seed com `JSON.stringify`.

### Ranking HLTV

O modelo usa a posição mundial das 16 equipes na [edição de 16/11/2026 da HLTV](https://www.hltv.org/ranking/teams/2026/november/16), a última disponível no corte de 20/11. Para a equipe A, a chance de vencer um mapa é `p = 1 / (1 + (posiçãoA / posiçãoB) ** 0.306262)`. Em MD3, a chance de ganhar dois mapas primeiro é `p² (3 − 2p)`, assumindo mapas independentes com a mesma chance. Os pontos do VRS e os ajustes pessoais pertencem aos outros modelos.

Para reproduzir o ajuste, execute `node scripts/calibrate-hltv.js`. O arquivo `research/hltv-series.csv` registra a edição semanal, a data da partida, o identificador textual no [histórico de resultados da BO3](https://bo3.gg/matches/finished), o formato, as posições e o vencedor. Em 14 edições entre março e novembro de 2026, cruzamos as equipes do top 64 com as séries do acervo disputadas da terça ao domingo seguintes. Entraram as MD1 e MD3 com vencedor confirmado pelos mapas e ambas as equipes identificadas.

O coeficiente minimiza a perda logarítmica nas 318 séries anteriores a outubro. Nas 174 séries reservadas de outubro e novembro, o Brier foi 0,2495 (50/50: 0,2500) e a perda logarítmica foi 0,6938 (50/50: 0,6931). Só três séries dessa avaliação eram MD1. Os resultados sustentam uma leitura cautelosa, especialmente para esse formato.

### Sugestão de cartão

Na página inicial, a busca usa o modelo ativo, seus ajustes e os resultados fixados para maximizar a chance de cinco ou mais acertos. O Web Worker testa trocas de equipes entre as três categorias e os seis times de fora. Na busca rápida, oito pontos de partida usam 8.192 torneios simulados. Uma segunda amostra de 16.384 compara finalistas entre rodadas de busca. As porcentagens exibidas para o cartão atual e o sugerido usam os mesmos 32.768 torneios de validação, com uma terceira semente. A busca é heurística.

O refinamento conserva o candidato mais bem pontuado na seleção, renova a amostra de busca a cada oito pontos de partida e continua por 10, 30 ou 60 segundos, ou até a pessoa parar. Cada refinamento concluído acrescenta 32.768 cenários de validação até 131.072. Com a chave inteira fixada, o resultado é calculado diretamente. Aplicar altera apenas o rascunho.

## Interpretação

A prévia usa 12 mil fases por modelo e uma semente fixa. Todos os modelos recebem a mesma sequência de sorteios por posição na chave, mesmo após divergirem nos adversários. Para um cartão completo, conta-se a proporção com cinco ou mais acertos. A faixa de Wilson é nominal de 95% para uma amostra fixa. Parar seletivamente ao observar os resultados pode afetar a cobertura. A simulação contínua dura enquanto a aba puder executar. O navegador pode suspender abas em segundo plano.

A enumeração visita cada sequência possível de vencedores uma vez e soma sua massa segundo o modelo em destaque. No início são 2³³ caminhos. Fixar resultados reduz a dimensão e permite fechar casos tardios rapidamente. Até terminar, o site exibe limites válidos a partir da massa conhecida de sucesso e de fracasso. A chave começa com todos os confrontos em aberto. Os resultados são inseridos pelo usuário e tratados como dados. Trocar o vencedor de uma rodada invalida as rodadas seguintes.

O link de um cartão salvo abre o registro público em `/cartoes#<id>`. Cada cartão também publica uma cópia dos ajustes do modelo pessoal em `/modelos?modelo=<id>`, inclusive quando o autor escolhe um modelo predefinido para pontuar. O visitante pode usar e editar uma cópia desses ajustes. O cartão e os resultados hipotéticos do visitante são preservados. Links antigos de cenário continuam abrindo o simulador.

Em `/partidas`, um clique explora os próximos confrontos. Dois cliques fixam o resultado e recalculam o cartão. Ao fixar uma partida futura, o simulador fixa primeiro as rodadas anteriores da chave exibida. Uma mudança em rodada anterior solta os resultados dependentes. Resultados oficiais têm prioridade. O selo verde AO VIVO abre a partida correspondente na HLTV. A agenda da inicial consulta o feed da PGL a cada 30 segundos com a página visível, usa horários de Cuiabá e avança pela rodada oficial. Quando a DRAFT5 publica a contagem dos rounds, a agenda indica a hora do último placar recebido. Os links da HLTV correspondem aos jogos programados do Stage 1. O arquivo `dist/data/schedule.json` fornece a programação inicial em caso de indisponibilidade da fonte.
