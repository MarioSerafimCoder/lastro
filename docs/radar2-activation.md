# Radar 2.0 — ativação autorizada em 04/11/2026

O proprietário autorizou nesta conversa o deploy e o envio de todo o código ao GitHub, substituindo a restrição inicial de apenas preparar a ativação. Sem upgrade, Billing, recurso remoto novo ou limpeza física.

## Preflight concluído

- Base `9bc85c5`; master remota `6174549`, já ancestral; preservadas as alterações Brain/Drive implantadas.
- Plano **Workers Free / Current plan**, conferido no dashboard. Limites: 100 mil requisições/dia, 10 ms CPU, 50 subrequests e 50 consultas D1 por invocação; três Crons existentes preservados.
- Suíte completa novamente **185/185**, tipagem e builds aprovados. Os 12 testes direcionados de retenção passaram novamente.
- Backup privado: `~/.codex/private-backups/lastro/20261104-radar2-activation.sql`; SHA-256 `8b5a57ac2482f6849c16fae25737feadae1631cbf926b6dda9e6d9bc015bbd4e`. Importação isolada e integridade verificadas. [Ensaio de retenção](radar2-activation-copy.json): 77 expiradas, 73 reduzidas, dez elegíveis antes/depois, vínculos e auditorias preservados; nenhuma limpeza remota.
- Bookmark imediatamente anterior à migration: `00001b60-00000004-00005119-0f6ac0568eb6408baca3f753d396f186`.
- `0014_radar_editorial.sql` aplicada remotamente após o ensaio: 18 comandos, 82,29 ms; operação aditiva. Worker anterior continua compatível.
- [Plano de fontes ensaiado](radar2-activation-sources.json): seis novas fontes com RSS 200, datas e autoria; seis existentes recebem classificação/temas sem alterar permissões, cadência, IDs, status ou política editorial. União: 19 fontes, 17 RSS e dois OpenAlex. Novas fontes sem sinopses, imagens ou IA. Fontes adiadas continuam adiadas.

## Medições e preservação

[Baseline](radar2-activation-before.json): plano confirmado pela UI; telemetria real da conta e inventário de 32 bindings, sem leitura de valores de Secrets. CPU histórica do Lastro: P50 7,523 ms, P99 43,799 ms, 1.019 invocações concluídas sem erro; estatística mistura rotas e não prova CPU por operação. Unidade confirmada pelo schema GraphQL: microssegundos. Tail real já registrou Cron de sinopses com CPU 6 ms, duração 915 ms, resultado `ok`. Limpeza está desativada e não terá medição remota fabricada.

## Rollback

Versão anterior do Worker: **`57bc80ee-c2f4-4ccb-bce0-b6d8d4ce09d3`**. Em falha de ativação, restaurar essa versão, mantendo as colunas aditivas, os dados e os Secrets atuais. Não executar DROP nem restauração global automática sobre dados novos. A limpeza física permanecerá com `RADAR_RETENTION_ENABLED=false`; nenhum payload precisa ser recuperado por rollback de código. Se necessário restaurar dados, usar o backup privado e o bookmark acima com avaliação das escritas posteriores.

## Publicação e verificação concluídas

- GitHub master e branch de homologação receberam o código validado, sem force push. Deploy autorizado concluído às **15h49 de Fortaleza**, versão **`d4e7057b-3009-4aef-a5e9-f9e44750d01a`**, em [lastro.marioserafim.com.br](https://lastro.marioserafim.com.br/).
- Migration remota concluída; consulta posterior confirmou **nenhuma migration pendente**. Plano de fontes aplicado: seis fontes novas e seis merges conservadores, 48 linhas escritas reportadas pelo D1. Todas as seis novas fontes tiveram coleta real bem-sucedida no Worker; as duas sem publicação semanal não preencheram o feed com artigos antigos.
- Navegador autenticado confirmou **15 artigos reais da semana**, três colunas e pulso editorial; nenhuma fonte em falha. [Screenshot real de produção](examples/radar2-activation/online.png). Brain abre e consulta memórias; a UI do Drive confirma conexão registrada. Não foram criadas memórias, arquivos Drive ou chamadas de IA para repetir a auditoria externa já aprovada.
- `/health` retornou 200; `/api/feed` e `/api/radar/status` sem sessão retornaram 401. Zero conteúdo sintético inserido em produção. [D1 pós-ativação](radar2-activation-live-db.json): integridade ok, zero violações FK, `expired_at` e `purged_at` ainda zerados. Nenhuma limpeza física executada.
- [Inventário posterior](radar2-activation-after.json): todos os 32 bindings anteriores preservados; única alteração anterior é a ampliação prevista de `ALLOWED_FETCH_HOSTS`; adicionado `RADAR_RETENTION_ENABLED=false`. Todos os Secrets, Brain/Drive, autenticação, AI/Studio e os três Crons preservados. Nenhum recurso ou plano novo.
- Cota compartilhada observada às 15h56: **729.199 linhas D1 lidas e 9.910 escritas** no dia UTC, incluindo migrations e testes reais; aproximadamente 14,6%/9,9% da franquia Free. Custo incremental **R$ 0**.

## Performance medida — aprovação integral bloqueada

[Analytics da versão publicada](radar2-activation-metrics.json): 75 invocações bem-sucedidas, zero erros e seis subrequests externos na amostra; CPU P50 **3,348 ms**, P99 **117,853 ms**; duração P50 **359,463 ms**, P99 **4.692,373 ms**. Os valores não são estimativas locais. [Tail real](radar2-activation-runtime.json): descoberta/classificação de étapes: 117 ms CPU / 5.749 ms de duração; coleta inicial Colossal 40 ms / 4.423 ms; demais coletas novas concluíram sem erro; processamento posterior em Cron 22 ms / 2.957 ms. Cron de sinopses preservado: 10 ms / 1.195 ms. A medição de limpeza remota não foi executada nem inventada, pois a limpeza permanece desligada.

**Operação: ONLINE. Aprovação integral de performance: BLOQUEADA.** As requisições observadas concluíram no Free, mas os picos excedem seu limite nominal de 10 ms; sucesso com tolerância de execução não comprova margem sustentável. A restrição de não reconstruir/refatorar módulos aprovados foi respeitada: não se fez uma otimização estrutural do parser durante a ativação. Não é correto declarar as três ressalvas integralmente resolvidas. Mantida a publicação solicitada pelo proprietário, sem erros observados e sem ativar limpeza. Uma certificação irrestrita requer reduzir esses picos e medir outra rodada; nenhum plano pago foi usado como solução.
