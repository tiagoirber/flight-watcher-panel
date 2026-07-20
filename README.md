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
node --test tests/validation.test.mjs tests/security.test.mjs tests/history.test.mjs
```

Os testes não acessam a API do GitHub e não modificam o repositório principal.
