# Pick’em dos Broxinhas · Planejamento até a final

Revisado em 27/11/2026. Horários de Cuiabá (UTC−4). As datas são referências para organizar o trabalho. A programação oficial e o prazo aplicado pelo servidor orientam cada virada. [Histórico das entregas](historico-do-projeto.md) · [Sugestões para avaliação](propostas-de-melhoria.md)

## 1. Stage 2 · Conferir o fechamento e apurar a fase

| Quando | Trabalho pendente | Como concluir |
| --- | --- | --- |
| 27/11 às 23h | **Conferir o fechamento real.** Verificar o prazo no servidor, em uma aba já aberta e em um navegador novo. | O estado muda para fechado, cartões e modelos salvos continuam consultáveis e os links públicos abrem os registros corretos. Exercitar tentativas de envio no limite do prazo em cópia isolada. |
| 28/11 a 01/12 | Acompanhar as 33 séries, com atenção à primeira MD3, à troca de mapa e a partidas simultâneas. Conciliar correções oficiais. | A agenda e a chave exibem a mesma série. Uma leitura antiga é identificada pela hora do dado. Reprocessar uma correção atualiza os picks afetados uma única vez. |
| Após os resultados da rodada 5 | Conciliar os oito classificados, fechar o ranking S2 e conferir o Geral com duas fases reais. | Recalcular as campanhas e os acertos de cada cartão. Conferir pelo menos um participante das duas fases, um ausente quando houver e os empates. O Geral soma acertos confirmados. Guardar a classificação final, as referências de cartões/modelos e o corte dos resultados antes da próxima virada. |
| Após a última série, em paralelo à virada | Avaliar as previsões congeladas do S2 e entregar os resultados à equipe do estudo S3. | Comparar os modelos ao Neutro com Brier, perda logarítmica e calibração por formato, informando o número de partidas. Pontuar o cartão sugerido e as alternativas, examinar oposição regional e mudanças de elenco e contar cada série uma vez. |

A estreia do Stage 3 exige preparação antes de o S2 terminar. As duas frentes abaixo podem avançar enquanto o grupo acompanha o S2. [Agenda oficial do Stage 2](https://news.pglesports.com/api/groupStageEndpoint?stage=2)

## 2. Stage 3 · Preparar agora, abrir após a rodada 5 do S2

1. **Desenvolvimento e testes com dados de ensaio.** Parametrizar o formato das séries pela fase. No S3, as **33 partidas são MD3 desde a primeira rodada**. O motor suíço atual escolhe MD1 antes dos jogos de classificação ou eliminação. Ensaiar um duelo cuja probabilidade de MD1 difere da de MD3 e conferir a agenda, a chave simulada, a chance do cartão, a comparação no ranking e a sugestão. Reproduzir os formatos originais de S1 e S2 como controle. [Motor suíço auditado](https://github.com/marcosvtm/sala-do-pickem/blob/8eb3e1ca85afa47791e06803b001c09ef870fbfb/dist/js/swiss.js) · [Programação do S3](https://news.pglesports.com/api/groupStageEndpoint?stage=3)
2. **Dados e abertura automática.** Preparar a edição para os oito convidados e os oito promovidos, registros de resultados e os quatro pontos de entrada do site. Estender a ativação hoje específica do S2. Liberar picks após a hora mínima calculada pela última série prevista do S2 mais três horas, o encerramento oficial do S2 e a conferência de 16 IDs, seeds e oito confrontos de R1. Repetir a leitura deve produzir a mesma edição. Prever atraso ou correção da fonte e uma atualização de fase em abas já abertas. [Ativação atual](https://github.com/marcosvtm/sala-do-pickem/blob/8eb3e1ca85afa47791e06803b001c09ef870fbfb/server/stages.js)
3. **Modelos e estudo próprio.** Coletar rankings Valve e HLTV válidos no corte e recalcular Forma recente com os jogos concluídos. Preparar o estudo de IA no fluxo dedicado e importar a edição congelada para as 16 equipes. Conferir identificadores, versão, data e probabilidades da série MD3. O cartão pode abrir com Neutro e Personalizado enquanto os demais modelos passam por validação. Cada modelo entra ao ser validado. Enquanto a IA estiver indisponível, manter o peso zero e a confirmação de salvamento em sequência com a do nick. A publicação da IA deve preservar as misturas já salvas.
4. **Ensaio do percurso real.** Testar em cópia isolada o cartão de dez picks, edição, duplicação de envio e bloqueio no horário. Em outro aparelho, selecionar um participante existente e confirmar o nick. Conferir rascunho independente, cópia opcional de ajustes apenas para equipes em comum, modelo salvo com versão e links antigos. Validar Inicial, Modelos, Partidas e Ranking em celular e computador.
5. **Fechar e apurar.** A estreia está prevista para **02/12 às 00h**. Se a primeira partida mantiver esse horário, o prazo do grupo é **01/12 às 23h**. Conferir o fechamento real. Ao final das 33 séries, conciliar classificados, pontos por cartão, pódio S3 e total S1 + S2 + S3. Arquivar a edição do estudo, seus resultados e as previsões usadas como entrada dos playoffs.

## 3. Playoffs · Definir as regras e entregar a chave de oito equipes

| Dependência | Próxima entrega | Critério de aceite |
| --- | --- | --- |
| Decisão do grupo antes da abertura | Fechar a pontuação, o tratamento do bronze e o objetivo de “Sugerir cartão”. A proposta anterior dá um ponto por vencedor na posição prevista, inclusive ao acertar o campeão com outro adversário na final. Deixa o bronze na agenda e soma até **37** no Major. Escolher se a sugestão prioriza média de acertos ou chance de 7/7. | Publicar a regra aprovada com um exemplo de finalista errado e campeão certo, um empate e um participante sem cartão. Registrar a decisão antes do primeiro envio. |
| Antes das quartas, usando uma chave de ensaio | Desenvolver o cartão de **quatro quartas, duas semis e uma final**. Implementar salvamento por fase, prazo e apuração por posição no mata-mata. Integrar a Inicial, Modelos, Partidas e Ranking. | Trocar um vencedor invalida só os palpites posteriores que dependem dele. Criar, revisar e acompanhar as sete escolhas funciona por teclado e celular. O Geral aceita a pontuação do mata-mata junto das três fases suíças. |
| Oito classificados do S3 e posições oficiais | Validar a chave com a PGL e concluir estudo próprio para os 28 pares possíveis. Tratar MD3 nas quartas e semis e **MD5 na final**. Incluir na agenda o bronze em MD3. | Conferir os lados da chave e as probabilidades de série. Para a disputa de sete picks pelo título, avaliar os 128 caminhos, a distribuição de acertos e a sugestão para o objetivo aprovado. |
| Chave oficial, edição disponível e prazo confirmado | Abrir a participação, manter o histórico das fases anteriores e conferir o bloqueio no servidor uma hora antes da primeira quarta. | Validar os links de cartão, a soma no Geral e o prazo em dois dispositivos. A primeira quarta está prevista para **10/12 às 05h**, o que projeta o fechamento em **10/12 às 04h**. Recalcular se a PGL mudar a programação. |

A agenda oficial prevê o bronze e a final para **13/12**. São oito partidas para acompanhar e sete duelos no caminho do título. [Agenda oficial dos playoffs](https://news.pglesports.com/api/playoffsEndpoint)

## 4. Aceites pendentes da revisão anterior

- **Navegação e simulação.** Revalidar a sequência cartão A → B → A, inclusive trocando de fase e de modelo. No celular, verificar a chegada ao resultado ao sair do chaveamento e o retorno à linha de origem ao voltar ao ranking. Corrigir apenas o que ainda falhar nessas sequências.
- **Leitura e teclado.** Testar ida e volta pelos atalhos de rodada sem atravessar todos os times com Tab. Em Modelos, conferir se o leitor de tela associa cada percentual à equipe, ao modelo e ao formato. Na Agenda, conferir o contraste do escudo da Liquid com o fundo, inclusive quando a equipe perde.
- **Erro de identificação.** Deixar documentado e ensaiado o procedimento do organizador para um cartão ligado ao participante errado. Conferir conflito de cartão na mesma fase e preservar picks, edição do modelo, horário e link. Registrar uma correção somente quando houver um caso confirmado.

## 5. Após a final · Encerrar a competição do grupo

1. Conferir o campeão do torneio e os resultados oficiais de cada posição pontuável. Reprocessar a apuração e comparar o resultado de cada participante à soma das quatro fases, inclusive quando pulou uma delas.
2. Divulgar no Ranking Broxas o resultado definitivo do Geral e os primeiros colocados de cada fase. Dar a mesma posição a participantes empatados e manter acessível o cartão que explica cada parcela. Identificar resultados provisórios enquanto alguma série ou correção aguardar confirmação.
3. Registrar a classificação final, as regras efetivamente usadas, os cartões, as edições dos modelos e a data da última conferência. Verificar a consulta por links já compartilhados e a recuperação a partir de cópia isolada. Publicar o balanço dos modelos por fase com as previsões que existiam antes dos jogos.
4. Transferir para o histórico as entregas verificadas, com data e evidência da conferência final.

Em cada publicação, conservar o domínio, o banco, os identificadores e os rascunhos dos participantes. Fazer ensaios de escrita em cópia isolada e conferir em produção a leitura dos cartões existentes e de seus links.
