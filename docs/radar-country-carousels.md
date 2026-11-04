# Radar — seções por país

Alteração solicitada pelo proprietário em 04/11/2026, com publicação autorizada.

- As três colunas de triagem deram lugar a seções horizontais por país. Em desktop, cada carrossel acomoda três cards completos e permite arraste com mouse, setas, teclado, Home e End. Arrastar não abre detalhes por acidente.
- Novidades, Para avaliar e Favoritos são estados dos cards e opções do filtro Estado. Favoritos persistentes, Oficina, detalhes, filtros e expiração foram preservados.
- Países aparecem por extenso; Brasil vem primeiro quando disponível, seguido dos países com mais matérias. País ausente não é presumido: fica em “País não informado”, também disponível no filtro. Se houver menos de três matérias, exibem-se apenas as existentes.
- A alteração usa rolagem nativa, CSS e Pointer Events, sem dependência nova, consulta extra, migration ou configuração de produção. Limpeza física continua desabilitada. As observações anteriores sobre CPU do backend continuam válidas.
- Verificações: 185 testes de backend, seis cenários Chrome com API/D1 isolados e cinco regressões compartilhadas aprovados; TypeScript, build e formatação. Três cards completos medidos em 1024, 1280, 1440 e 1920 px; temas claro/escuro, arraste, teclado, poucos resultados e país ausente.

[Prévia das seções](examples/radar-country-carousels/country-sections.png). Capturas de homologação usam dados sintéticos identificados. A publicação será conferida com o conteúdo real do domínio definitivo.
