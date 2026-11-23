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

O neutro atribui 50% a ambos os lados. No modelo VRS, a diferença dos pontos é dividida por 340 em MD1 ou 255 em MD3 e convertida pela função logística. No Elo, a diferença é dividida por 170 e multiplicada por 0,73 nas MD1. No modelo pessoal, os componentes de cada equipe são centralizados pela média das 16 equipes e misturados na escala de log-odds. O peso efetivo do Elo é o peso global vezes a confiança individual. Um bônus hipotético de +5 p.p. soma logit(0,55) à força do time. Esse ajuste vale a fase inteira e sua magnitude em pontos percentuais varia com o adversário. O grupo pode experimentar um histórico regional pouco comparável ou um desempenho excepcional de Major. Os ajustes manuais começam neutros e não foram calibrados como efeitos históricos.

## Interpretação

A prévia usa 12 mil fases por modelo e uma semente fixa. Os quatro modelos recebem a mesma sequência de sorteios por posição na chave, mesmo após divergirem nos adversários. Para um cartão completo, conta-se a proporção com cinco ou mais acertos. A faixa de Wilson é nominal de 95% para uma amostra fixa. Parar seletivamente ao observar os resultados pode afetar a cobertura. A simulação contínua dura enquanto a aba puder executar. O navegador pode suspender abas em segundo plano.

A enumeração visita cada sequência possível de vencedores uma vez e soma sua massa segundo o modelo em destaque. No início são 2³³ caminhos. Fixar resultados reduz a dimensão e permite fechar casos tardios rapidamente. Até terminar, o site exibe limites válidos a partir da massa conhecida de sucesso e de fracasso. A chave começa com todos os confrontos em aberto. Os resultados são inseridos pelo usuário e tratados como dados. Trocar o vencedor de uma rodada invalida as rodadas seguintes.

O link de um cartão salvo abre o registro público em `/cartoes#<id>`. Cada cartão também publica uma cópia dos ajustes do modelo pessoal em `/modelos?modelo=<id>`, inclusive quando o autor escolhe um modelo predefinido para pontuar. O visitante pode usar e editar uma cópia desses ajustes. O cartão e os resultados hipotéticos do visitante são preservados. Links antigos de cenário continuam abrindo o simulador.

Em `/partidas`, um clique explora os próximos confrontos. Dois cliques fixam o resultado e recalculam o cartão. Ao fixar uma partida futura, o simulador fixa primeiro as rodadas anteriores da chave exibida. Uma mudança em rodada anterior solta os resultados dependentes. Resultados oficiais têm prioridade. A agenda da inicial é consultada a cada minuto com a página visível, usa horários de Cuiabá e avança pela rodada informada na agenda da PGL. Os links da HLTV correspondem aos jogos programados do Stage 1. O arquivo `dist/data/schedule.json` fornece a programação inicial em caso de indisponibilidade da fonte.
