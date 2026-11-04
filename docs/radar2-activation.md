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

Publicação e verificação pós-deploy serão registradas abaixo após execução, sem antecipar resultados.
