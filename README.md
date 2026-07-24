# Flight Watcher Panel

Painel estático para listar, adicionar, atualizar e remover os voos monitorados
no repositório privado `tiagoirber/flight-watcher` por meio da API do GitHub.

Também lê o histórico persistente v1 para exibir:

- evolução de preços em gráfico SVG;
- preço atual, mínimo, máximo, média e mediana;
- variação entre o primeiro e o último preço do período;
- volatilidade como desvio-padrão populacional;
- comparação por companhia, quando o campo estiver disponível;
- filtros por período e tabela de todas as consultas.

O manifesto e os segmentos JSONL são lidos diretamente do repositório privado.
O painel não publica uma cópia dos dados e não usa backend ou serviço de
terceiros. Amostras curtas e ausência de companhia são indicadas na interface.

## Buscas flexíveis

Além de rotas e datas fixas, o formulário aceita uma definição flexível com
aeroportos principais e alternativos, região explícita, janela de partida,
intervalo de estadia, orçamento, máximo de escalas e prioridade.

A prévia local deduplica os códigos IATA e calcula o produto cartesiano. O envio
só é liberado após a autorização explícita da quantidade exibida, limitada a 64
combinações. Qualquer alteração nos campos invalida essa autorização. O
workflow privado valida e recalcula a definição antes de gravá-la.

O painel também permite pausar, retomar e remover monitoramentos. No histórico,
consultas concretas de uma busca flexível exibem o identificador do grupo sem
misturar séries de rotas e datas diferentes.

## Assistente de dados

O assistente responde a um conjunto explícito de perguntas usando somente o
histórico v1 já carregado:

- rota com maior queda recente;
- destino com menor preço atual;
- promoções identificadas hoje pelas regras históricas existentes;
- preços atuais abaixo da média da própria rota;
- melhor Flight Score;
- rotas com dados insuficientes.

Ele é determinístico e executado localmente no navegador. Não usa OpenAI ou
outro serviço de IA, não acessa fontes externas e não pode alterar
monitoramentos, comprar passagens ou enviar alertas. Perguntas desconhecidas são
recusadas e acompanhadas da lista de intenções suportadas.

Toda resposta apresenta período, quantidade de consultas e preços, providers
observados, limitações e confiança da amostra relevante. Respostas sobre uma
rota usam somente a amostra dessa rota; respostas com várias rotas adotam a
menor confiança entre elas. Quando uma lista excede o limite visual, o total e a
quantidade exibida são informados. A análise é histórica e não constitui
previsão nem garantia de economia.

## Flight Score

O Flight Score resume a atratividade do preço dentro do monitor e período
selecionados. Ele não é previsão nem garantia de economia.

A nota exige pelo menos três preços distribuídos em dois dias e considera:

- posição histórica do preço atual: 30%;
- distância da média: 15%;
- distância da mediana: 15%;
- distância do menor preço: 15%;
- tendência dos últimos cinco preços: 15%;
- volatilidade relativa: 10%.

A confiança usa quantidade de preços, dias distintos e proporção de consultas
com preço. Amostras menos confiáveis aproximam a nota de 50 para evitar extremos
artificiais. Quando o mínimo não é atingido, o painel não emite nota.

```text
score final = 50 + (score bruto - 50) × confiança
```

A confiança é classificada como baixa abaixo de 35%, moderada entre 35% e 69%
e alta a partir de 70%.

## Recomendações históricas

As recomendações são regras descritivas sobre o período selecionado. Elas não
preveem preços futuros nem garantem economia.

“Vale considerar comprar agora” exige simultaneamente:

- Flight Score de pelo menos 75;
- confiança de pelo menos 70%;
- preço atual pelo menos 1% abaixo da média.

Quando alguma condição não é atendida, o painel recomenda esperar e continuar
monitorando. Sem Flight Score elegível, informa que a amostra é insuficiente.

Um preço só é classificado como raro com pelo menos 10 preços em cinco dias,
posição entre os 10% menores e distância de até 5% do mínimo. A tendência usa
os últimos cinco preços: queda até -2%, alta a partir de 2% e estabilidade no
intervalo intermediário.

## Dashboard estatístico

O dashboard geral agrega todas as rotas no período próprio selecionado e exibe:

- ranking de promoções com as regras já usadas pelo Flight Score e recomendação;
- menores preços e maiores quedas ou altas entre os dois preços mais recentes;
- histórico de alertas e consultas com falha;
- médias por destino, companhia e mês da observação;
- rotas mais monitoradas;
- saúde, última execução e próxima execução prevista.

Registros migrados continuam nas estatísticas de preços, mas não contam como
execuções operacionais. A saúde usa a execução real mais recente: sem falhas é
saudável, com falha parcial requer atenção e sem sucesso ou com atraso superior
a três intervalos é crítica.

O intervalo é lido do cron `*/N * * * *` em `.github/workflows/monitor.yml`. A
próxima execução é uma estimativa do agendador e pode sofrer atraso no GitHub
Actions. Se o cron não puder ser lido, o histórico continua funcional e a
estimativa fica indisponível.

As médias sempre mostram o tamanho da amostra. Enquanto `carrier` não estiver
presente nas observações, a média por companhia exibe um estado indisponível em
vez de inferir ou inventar a empresa.

## Segurança do token

O token do GitHub permanece somente na memória da aba. Ele não é salvo em
`localStorage` ou `sessionStorage`. Para persistência entre visitas, use o
gerenciador de senhas do navegador.

Permissões mínimas do fine-grained PAT:

- Actions: Read and write
- Contents: Read-only

## Testes

Não há dependências npm. Execute com Node 22 ou superior:

```text
node --test
```

Os testes não acessam a API do GitHub e não modificam o repositório principal.
