# Flight Watcher Panel

Painel estático para listar, adicionar, atualizar e remover os voos monitorados
no repositório privado `tiagoirber/flight-watcher` por meio da API do GitHub.

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
node --test tests/validation.test.mjs tests/security.test.mjs
```

Os testes não acessam a API do GitHub e não modificam o repositório principal.
