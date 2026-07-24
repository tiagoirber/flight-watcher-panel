# Product

## Register

product

## Users

Um único usuário (o próprio dono do projeto), acessando pelo navegador tanto
em desktop quanto em celular, para checar preços de voos monitorados,
adicionar/remover/pausar monitoramentos e consultar histórico, score e
recomendações. Não é uma ferramenta multiusuário nem voltada para venda —
é utilidade pessoal.

## Product Purpose

Substituir a necessidade de editar `config/flights.json` direto no GitHub:
o painel lista os voos monitorados, permite gerenciá-los (fixos e buscas
flexíveis), mostra o histórico de preços com gráfico, Flight Score,
recomendações determinísticas e um dashboard estatístico agregando todas as
rotas. Sucesso é conseguir checar/ajustar tudo isso rapidamente pelo celular
ou desktop, sem fricção.

## Brand Personality

Utilitário, direto e confiável — como um painel de instrumentos, não um
produto de marca. Precisa passar confiança nos dados (preços, histórico,
score) mesmo sendo simples. Isso não significa abrir mão de uma estética
agradável: “sério e prático” não é desculpa para feio.

## Anti-references

Nenhuma referência positiva específica foi dada. Referência negativa
explícita: nada de "SaaS genérico" — evitar clichês de dashboard (cards de
ícone+título+texto idênticos repetidos, gradientes decorativos, o template
de hero-metric com número grande e estatísticas de apoio).

## Design Principles

- Dados antes de decoração: preço, tendência e status devem ser lidos em um
  olhar, sem precisar decifrar a interface.
- Confiança visual sem "corporativo": sobriedade não é sinônimo de dashboard
  SaaS genérico — buscar um caráter mais próprio, editorial ou técnico.
- Uma pessoa só, dois tamanhos de tela: cada decisão de layout precisa
  funcionar tanto em desktop quanto em celular, não só "responsivo por
  obrigação".
- Honestidade sobre incerteza: quando o dado é insuficiente (amostra curta,
  companhia ausente, Flight Score indisponível), a interface já assume isso
  e comunica em vez de mascarar ou inventar.

## Accessibility & Inclusion

Uso pessoal, sem requisito formal de WCAG, mas usado ativamente em desktop
**e** mobile — responsividade real (não só "não quebra"), contraste
adequado e HTML semântico continuam valendo por boa prática.
