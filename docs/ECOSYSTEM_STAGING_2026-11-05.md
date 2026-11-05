# Homologação remota das fases 0–4

05/11/2026 · São Paulo. A release de staging contém o commit de código `16fd402`, publicado no Worker `lastro-ecosystem-staging` na versão `7821bebf-5e58-4825-a4fd-dacddd7c1aef`.

| Área                   | Estado                                     | Evidência                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventário e D1        | Homologada                                 | Bindings do Lastro e Studio de staging conferidos contra os definitivos. Backup de 59.460 bytes restaurado em SQLite em memória, com nove migrations e nenhuma violação de FK. Staging recebeu 0010–0016, somando 16 migrations, com `quick_check=ok`.                                                            |
| Radar                  | Parcialmente homologada                    | Quatro RSS existentes responderam e registraram fila real. O OpenAlex respondeu 429. Primeira rodada com 28 invocações, zero erros do Worker e cinco subrequests na janela observada. A correção que separa descoberta RSS da classificação já está publicada em staging. Falta amostra equivalente dessa versão. |
| Saúde                  | Parcialmente homologada                    | Sessão autenticada abriu o painel e gerou um snapshot real. A segunda solicitação reutilizou o snapshot e manteve a janela de 30 minutos. Métricas sem credencial de leitura apareceram como indisponíveis.                                                                                                       |
| Oficina → Studio       | Parcialmente homologada                    | Pacote sintético submetido em staging. A reconciliação da tarefa e a abertura do novo rascunho ainda precisam ser confirmadas.                                                                                                                                                                                    |
| Blog → CRM e CRM → GA4 | Parcialmente homologadas                   | Token exclusivo do CRM de staging renovado por 24 horas, mesma identidade. A rota humana respondeu 403 com token de serviço. A leitura assinada de `/integration/v1/newsletter-summary` respondeu 404 no CRM de staging. O fluxo completo requer verificar a versão implantada do CRM e revalidar GA4.            |
| Portfólio → Lastro     | Parcialmente homologada                    | Contrato HMAC validado localmente. Staging ainda precisa de um segredo exclusivo para enviar o payload sintético.                                                                                                                                                                                                 |
| Search Console         | Bloqueada por configuração e consentimento | A migration foi aplicada. O cliente OAuth Web separado ainda precisa ser criado, configurado e autorizado pelo titular.                                                                                                                                                                                           |

## Telemetria real

| Amostra                            | CPU P50  | CPU P95      | CPU P99    | Duração P50 | Duração P95  | Duração P99  |
| ---------------------------------- | -------- | ------------ | ---------- | ----------- | ------------ | ------------ |
| Ativação de 04/11 · produção       | 3,348 ms | Indisponível | 117,853 ms | 359,463 ms  | Indisponível | 4.692,373 ms |
| Primeira rodada de 05/11 · staging | 1,677 ms | 29,802 ms    | 60,568 ms  | 279,711 ms  | 4.377,278 ms | 4.960,315 ms |

A amostra de staging mistura rotas e tem menor volume. Os picos ainda excederam o orçamento de 10 ms. A medição após a correção e a atribuição por rotina continuam pendentes.

Workers Free confirmado no painel. Na consulta de 05/11, a conta compartilhada registrou 212.972 linhas D1 lidas de 5 milhões e 1.362 escritas de 100 mil. O banco do Lastro de staging registrou 2.239 leituras e 131 escritas no mesmo dia UTC. Nenhum serviço pago contratado.

## Validação e promoção

A revisão final passou em 189 testes de backend, TypeScript e build em dry-run. A suíte integrada do Radar passou em sete cenários Playwright antes do ajuste de separação de fila. O ajuste passou nos 28 testes direcionados e na revisão final de backend.

O rollback de staging pode apontar para a versão anterior ao ensaio `6684f355-65ad-41fa-9043-f7d27afa38fc`, preservando as migrations aditivas. Produção segue na versão observada no preflight `f7fe9e1f-719a-4284-9d7c-5836e09afd28`. As migrations 0015 e 0016 estavam pendentes no D1 definitivo. A promoção aguarda as evidências acima, conforme o roteiro. [Configuração e procedimento](ECOSYSTEM_OBSERVABILITY.md)
