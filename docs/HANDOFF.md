# Rdrive — Handoff

Estado do projeto e ideias por implementar, para retomar depois. Ver `CHANGELOG.md` para o histórico do que já foi feito.

## Já implementado

- OAuth multi-nuvem (Google Drive, Dropbox, OneDrive, Box, pCloud, Yandex, Mega, HiDrive, Google Photos)
- Montagem FUSE com cache VFS configurável (tamanho máx., pasta de cache, LRU automático), somente-leitura, limite de bandwidth
- Auto-remontagem (self-healing) se a montagem cair, com toggle "Manter sempre montado"
- Explorador de nuvem completo: navegação, busca, ordenação, vista lista/grade, copiar/mover/apagar/nova pasta, preview de texto, download, link de partilha
- Categorias estilo Google Drive: Meu Drive, Drives compartilhados, Recentes, Com estrela, Compartilhados comigo, Lixeira (via consulta direta à API `trashed = true`, não `lsjson`), Armazenamento
- Listagem progressiva (streaming) do explorador, com otimização para ler direto da pasta montada quando disponível (evita 2º pedido à API)
- Fila de transferências resumíveis (pausar/retomar/cancelar), não perde progresso se interromper
- Tray/segundo plano: fechar minimiza, ícone na bandeja, atalho global `Shift+Alt+D`
- Autostart no arranque do SO
- Notificações do sistema (auto-remontagem)
- Tema claro/escuro/sistema
- Tour de onboarding na primeira execução
- Agrupamento visual de nuvens por provedor
- Instalação do rclone com um clique (`pkexec` + install.sh oficial)
- Velocidade de rede no tooltip da bandeja (opcional, baseado na fila de transferências)

## Por implementar

### 1. Sincronização automática (bisync)
Pasta local espelha uma pasta da nuvem automaticamente via `rclone bisync`, com resolução de conflitos. Maior risco/complexidade — `bisync` pode apagar dados dos dois lados se mal configurado; precisa de UI clara de "primeira sincronização" e avisos.

### 2. Encriptação de nuvem (crypt backend)
Usar o backend `crypt` do rclone para cifrar ficheiros antes de subir. Precisa de wizard dedicado para gerar/guardar a password de encriptação (nunca em texto simples), e aviso claro de que perder a password = perder os dados.

### 3. Client ID próprio do Google Drive
O rclone usa por omissão um client_id **partilhado e sujeito a throttling** (aviso que aparece sempre nos logs). Isto já causou pelo menos um falso positivo de "bug" nesta sessão — na realidade era contenção de API. Vale a pena:
- Guiar o utilizador a criar o seu client_id no Google Cloud Console (~10 min, gratuito)
- Adicionar campos opcionais `client_id`/`client_secret` no fluxo "Nova Nuvem" para quem já tem

### 4. Dispositivo de bloco real (NBD)
Expor a nuvem como `/dev/nbdX` formatável via `rclone serve nbd`. Rejeitado por agora pelo utilizador — exige privilégios de admin sempre e é mais frágil (risco de precisar `fsck`). Só retomar se pedido explicitamente.

### 5. Atalho fixo na barra lateral do gestor de ficheiros
Alternativa mais leve ao NBD para "parecer um disco": adicionar a montagem aos bookmarks do Dolphin/Nautilus automaticamente ao montar. Não aparece em "Dispositivos" (isso exige udisks2/bloco real), mas fica fixo e acessível.

### 6. Estender o streaming/otimização de montagem a mais categorias
Hoje só a categoria "Meu Drive" lê da pasta montada quando disponível. "Recentes"/"Lixeira" continuam a usar `rclone backend query` (rápido mas não fazem streaming progressivo real — emitem tudo de uma vez no fim). Podia-se aplicar a mesma otimização de leitura local onde fizer sentido.

### 7. Corrigir possível imprecisão no "Restaurar" (untrash) de itens aninhados
`untrash_cloud_paths` (em `explorer.rs`) recebe nomes/paths dos itens da lixeira, mas a consulta à API devolve itens de qualquer profundidade da árvore sem um "path" fiável relativo à raiz — `rclone backend untrash remote:path` pode não localizar corretamente itens que não estejam na raiz. Vale a pena testar restaurar um ficheiro trashed que estava numa subpasta e confirmar/corrigir.

## Notas técnicas importantes

- **rclone.conf / client_id partilhado**: fonte de lentidão intermitente e não-determinística na API do Drive. Não é bug do Rdrive — ver secção 3 acima.
- **Nunca fazer I/O bloqueante (`std::fs::*`) dentro de uma função `#[tauri::command] async fn`** sem `tokio::task::spawn_blocking` — já causou um bug real nesta sessão (leitura da pasta montada travava a thread assíncrona quando o FUSE estava lento a responder). Qualquer nova leitura de pasta montada deve seguir o padrão em `list_cloud_files_stream` (`explorer.rs`): `spawn_blocking` + `tokio::time::timeout` com fallback.
- **`--drive-trashed-only` do `lsjson` não é fiável** combinado com `--max-depth`; a app usa `rclone backend query "trashed = true"` para a Lixeira, que é a fonte fiável.
- Há um log de diagnóstico temporário no explorador (`explorerDebugLog` em `App.tsx`) usado para depurar o problema de lentidão. Pode ser removido quando já não for necessário, ou mantido como ferramenta de debug (está escondido, só aparece durante o carregamento).
