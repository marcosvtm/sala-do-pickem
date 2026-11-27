# Histórico do Pick’em dos Broxinhas

Singapura 2026 · Entregas verificadas até 27 de novembro de 2026 · Horários de Cuiabá (UTC−4).

Este registro acompanha o site do grupo. A data de cada entrada é a da entrega ou conferência. Quando uma etapa passar nos critérios de aceite em produção, acrescentar aqui a data, a mudança observada e a evidência, e retirá-la do [planejamento ativo](planejamento-stage-2-e-playoffs.md).

## Até 23/11 · Primeiro cartão do Major

- Entrou no ar o cartão suíço do Stage 1, com duas vagas para 3–0, seis para 3–1 ou 3–2 e duas para 0–3. O grupo passou a poder salvar, consultar e compartilhar cartões. O servidor passou a aplicar o prazo de edição. Novos visitantes começaram com um cartão vazio. [Primeiro sistema de cartões](https://github.com/marcosvtm/sala-do-pickem/commit/c56aec6) · [Estado inicial de um novo visitante](https://github.com/marcosvtm/sala-do-pickem/commit/b4f9463)
- O simulador passou a estimar a chance de acertar pelo menos cinco picks, comparar modelos e sugerir cartões. Entraram Neutro, Ranking Valve, Ranking HLTV, Forma recente, o estudo de IA do S1 e o modelo personalizado com pesos e ajustes por equipe. Cartões e modelos publicados ganharam links próprios. [Mistura dos modelos](https://github.com/marcosvtm/sala-do-pickem/commit/73929e9) · [Estudo do Stage 1](https://singapore-major-pickem-2026-br.marcosvtm.chatgpt.site)
- A identidade visual passou a reunir o banner do FalleN, fotos do grupo, o escudo do leão e a imagem de compartilhamento. [Banners](https://github.com/marcosvtm/sala-do-pickem/commit/27e0028) · [Prévia dos links](https://github.com/marcosvtm/sala-do-pickem/commit/44c8b27)

## 24/11 · Agenda, chaveamento e participação entre fases

- A agenda passou a distinguir o placar de rounds do placar em mapas. As MD3 ganharam histórico expansível por mapa. O placar ao vivo usa CT/TR quando há evidência do lado, acompanha a troca de lados e identifica a atualização. Ao encerrar, o vencedor ganha destaque. O chaveamento distingue resultados oficiais, projeções e partidas ao vivo. Links da HLTV abrem em outra aba. [Lados por mapa](https://github.com/marcosvtm/sala-do-pickem/commit/557f398) · [Agenda MD3](https://github.com/marcosvtm/sala-do-pickem/commit/8693533) · [Chaveamento](https://github.com/marcosvtm/sala-do-pickem/commit/e39aab8)
- Cartões e Ranking se uniram em **Ranking Broxas**, com classificação geral, visão por fase e acesso ao cartão e modelo de cada pessoa. A consulta de nicks ao Chopp saiu desse percurso. Os links antigos de cartões continuaram funcionando. O ranking conservou a sua foto, e a foto do grupo no bar passou para Partidas. [Unificação](https://github.com/marcosvtm/sala-do-pickem/commit/8e75a18)
- Depois do prazo, um visitante pode escolher um cartão público para acompanhar e simular no celular ou em outro navegador. Para salvar em uma nova fase, escolhe o participante e confirma o nick antes do envio. O vínculo permite somar as fases no Geral. O ensaio em cópia isolada cobriu segundo aparelho, edição e repetição do envio. [Acompanhar cartão](https://github.com/marcosvtm/sala-do-pickem/commit/adb390a) · [Confirmação de nick](https://github.com/marcosvtm/sala-do-pickem/commit/9dd665c)
- Os seletores entraram nos banners da Inicial, Modelos, Partidas e Ranking. As fases disponíveis alternam o conteúdo na própria página. Na Inicial, cada fase tem cartão, simulação, agenda e prazo próprios. A versão visual escolhida para Modelos foi a da primeira entrega integrada. [Navegação da Inicial](https://github.com/marcosvtm/sala-do-pickem/commit/34eeeb8) · [Demais abas](https://github.com/marcosvtm/sala-do-pickem/commit/e4b90a0) · [Restauração do banner](https://github.com/marcosvtm/sala-do-pickem/commit/2738511)

## 25/11 · Preparação do Stage 2 e acompanhamento dos cartões

- A preparação cobriu os oito convidados e os 16 possíveis promovidos. A abertura do S2 passou a conferir a hora mínima, os classificados oficiais e os oito confrontos da primeira rodada. A prontidão de cada modelo passou a ser tratada separadamente. O editor permite copiar explicitamente um modelo anterior, reaproveitando ajustes das equipes em comum. A agenda passou a buscar sinais de partidas próximas mesmo com atraso na atualização do calendário. [Preparação da edição](https://github.com/marcosvtm/sala-do-pickem/commit/a2ac4ec) · [Abertura e placares](https://github.com/marcosvtm/sala-do-pickem/commit/8c67172)
- O ranking da fase ganhou **Vivos**, **Acertos** e uma faixa compacta com os dez escudos por categoria. A chance de 5+ é calculada com os resultados disponíveis. É possível expandir vários participantes, comparar os picks e abrir o modelo salvo por uma ação secundária. [Cartões compactos](https://github.com/marcosvtm/sala-do-pickem/commit/7530ae2) · [Ação Ver modelo](https://github.com/marcosvtm/sala-do-pickem/commit/23afcae)

## 27/11 · Resultado do Stage 1 e abertura do Stage 2

As 33 séries oficiais do S1 foram conciliadas com a apuração do grupo. **LighT. venceu o Stage 1 com 5/10.** Na conferência da virada, os oito cartões e nove modelos do S1 preservaram o conteúdo, o Geral reproduziu os acertos e um link de cartão anterior abriu o participante correto. [Ranking do Stage 1](https://pickem-dos-broxinhas.marcosvtm.chatgpt.site/ranking?fase=stage-1)

A versão 56 reconheceu os identificadores de Nemiga Gaming e The One usados pela PGL. Após a confirmação dos oito promovidos e dos oito confrontos, o S2 abriu às **11h27**, com fechamento programado para **27/11 às 23h**. A Inicial passou a abrir nessa fase. A edição disponibilizou Neutro, Valve (ranking de 02/11), HLTV (23/11), Forma recente atualizada com as séries do S1 e Personalizado. A IA entrou na versão seguinte, no mesmo dia. [Virada para S2](https://github.com/marcosvtm/sala-do-pickem/commit/00bfd6c) · [Agenda oficial](https://news.pglesports.com/api/groupStageEndpoint?stage=2)

### Versão 57 · Cinco entregas conferidas

| ID | Entrega publicada | Conferência registrada |
| --- | --- | --- |
| 005 | Modelo IA do S2 integrado. Edição `sg26-s2-regional-v2-20261127`, corte em 27/11 às 11h30. | Os 16 IDs e os 120 pares em cada formato coincidiram com o estudo. A MD3 usou a probabilidade da série diretamente. A seleção em Modelos, a comparação, a chance de passar, a sugestão e a mistura usaram a mesma edição. Uma aba já aberta recebeu a IA e manteve o peso zero. O salvamento com a identificação da edição foi conferido em cópia isolada. |
| 001 | Foto final dos sete integrantes aplicada a Partidas. | Arquivo conferido com a entrega do editor. Enquadramento e legibilidade verificados no celular e no computador. |
| 002 | Subtítulo “Acompanhe os jogos e explore os próximos confrontos.” e alinhamento dos banners de Partidas e Ranking. | Altura e alinhamento conferidos em 11 larguras entre 280 e 1280 px, inclusive com aviso de fase indisponível. |
| 003 | “Aberto” nos seletores das quatro páginas. | Texto conferido em 390 e 1280 px e prazo conferido no servidor. |
| 004 | Proporção do escudo da FUT corrigida. | No cartão expandido, escudos e siglas ficaram alinhados em 390 e 1280 px. A proporção também foi conferida no chaveamento. |

Na entrega da v57, passaram 74 testes automatizados. A conferência após a publicação comparou cartões, picks e configurações das duas fases e a soma do Geral. O estudo S1 continuou vinculado à sua fase. [Publicação da v57](https://github.com/marcosvtm/sala-do-pickem/commit/8eb3e1ca85afa47791e06803b001c09ef870fbfb) · [Estudo do Stage 2](https://singapore-major-pickem-2026-br.marcosvtm.chatgpt.site/stage-2)

Na revisão documental de 27/11, o catálogo público indicava S1 encerrado, S2 aberto como fase padrão e S3 e playoffs em preparação. As agendas futuras já têm leitura da PGL. A conferência encontrou 33 MD3 para o S3 e oito séries nos playoffs, incluindo o terceiro lugar e a final MD5. [Catálogo do site](https://pickem-dos-broxinhas.marcosvtm.chatgpt.site/api/stages) · [Agenda do S3](https://news.pglesports.com/api/groupStageEndpoint?stage=3) · [Agenda dos playoffs](https://news.pglesports.com/api/playoffsEndpoint)
