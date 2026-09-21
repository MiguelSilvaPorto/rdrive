# Changelog

Notable user-facing changes to **Rdrive** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/). Dates use UTC.

> **Rule:** every feature addition, change, or removal must be recorded under
> `[Não lançado]` in the same task. During a release, `[Não lançado]` becomes the new
> dated version and a new empty `[Não lançado]` section is added at the top.

## [Não lançado]

### Added

- **Inicialização do Rdrive em Tauri v2 e Rust**: estrutura do aplicativo desktop configurada com arquitetura leve e alto desempenho utilizando Tauri v2 e motor em Rust com gerenciamento do `rclone`.
- **Atalho de Inicialização Simplificado**: adição do script `"app": "tauri dev"` ao `package.json`, permitindo iniciar o aplicativo de forma direta com `npm run app`.
- **Detecção do Ambiente do Sistema**:
  - Verificação automática da presença do binário `rclone` no PATH e captura da versão instalada.
  - Verificação de suporte a **FUSE** (`fusermount`/`fusermount3`) no Linux, com exibição de alertas explicativos e comandos de instalação caso faltem requisitos.
  - Localização e exibição dinâmica do caminho do arquivo de configuração `rclone.conf`.
- **Gerenciamento de Remotes da Nuvem**:
  - Listagem dos armazenamentos em nuvem configurados (Google Drive, OneDrive, Amazon S3, Nextcloud, Dropbox, WebDAV, SFTP, etc.) através do comando `rclone listremotes --long`.
  - Exibição de cards visuais com nome, tipo de nuvem, ponto de montagem ativo e PID do processo associado.
- **Montagem e Desmontagem como Disco Local**:
  - Comando de montagem (`mount_remote`) criando pontos de montagem automáticos em `~/Rdrive/<remote>` com flags de cache VFS total (`--vfs-cache-mode full`, buffers de 64M/512M e retenção de cache de 24h) para leitura e escrita nativas.
  - Comando de desmontagem limpa (`unmount_remote`) executando `fusermount -u` e finalização segura do processo em segundo plano.
  - Hook de encerramento do ciclo de vida da aplicação (`tauri::RunEvent::Exit`), garantindo a desmontagem automática de todos os discos ao fechar o app para evitar pontos de montagem zumbis.
  - Ação **"Abrir Pasta"** utilizando o plugin oficial `@tauri-apps/plugin-opener` para abrir a nuvem montada diretamente no gerenciador de arquivos nativo do sistema operacional.
- **Explorador de Arquivos na Nuvem Interativo**:
  - **Filtro e Busca em Tempo Real**: campo de busca rápida com filtragem instantânea de arquivos e pastas pelo nome.
  - **Alternância de Visualização**: suporte completo a modo **Lista detalhada** e modo **Grade de Cartões** (`Grid`), com prévias de ícones destacados.
  - **Ordenação Dinâmica**: ordenação inteligente com 1 clique por **Nome**, **Tamanho** ou **Data de Modificação** (com sentido ascendente e descendente).
  - **Identificação Visual por Tipo de Arquivo**: ícones e paletas de cores específicas para Imagens, Vídeos, Áudios, Documentos, Arquivos compactados e Código-fonte.
  - **Ações Rápidas por Item**:
    - **Visualizador / Prévia Rápida (`Eye`)**: leitura e exibição instantânea de arquivos de texto, código, logs e notas diretamente em modal nativo dentro do app via `rclone cat`.
    - **Download Direto (`Download`)**: download com 1 clique de qualquer arquivo remoto para a pasta de Downloads local do sistema.
    - **Link de Compartilhamento (`Link2`)**: geração e cópia direta do link público de compartilhamento para a área de transferência.
  - **Navegação Aprimorada**: botão "Subir Pasta" (`ArrowUp`), migalhas de pão interativas (`Breadcrumbs`) e contagem total de itens em tempo real.
- **Barra Lateral Dinâmica Inteligente (Estilo Google Drive)**:
  - Reconstrução dinâmica da barra lateral esquerda ao entrar no explorador de qualquer nuvem, espelhando a experiência completa do Google Drive (`Meu Drive`, `Drives compartilhados`, `Computadores`, `Compartilhados comigo`, `Recentes`, `Com estrela`, `Spam`, `Lixeira` e `Armazenamento`).
  - **Medidor de Cota em Tempo Real**: barra de progresso visual no rodapé da barra lateral exibindo exatamente o espaço ocupado e disponível (ex: *21,29 GB de 5 TB usados*) consultando dinamicamente o `rclone about`.
  - Transição fluida de retorno: ao clicar em **"Voltar aos Meus Drives"**, a barra lateral se restaura instantaneamente para o painel de status do sistema original.
- **Interface Gráfica Moderna**:
  - Layout escuro refinado com React, TypeScript, Tailwind CSS e ícones Lucide.
  - Polling periódico e botão manual de atualização para manter o estado sincronizado em tempo real.

### Changed

- **Navegação do Explorador**: redesenhado para preencher a tela com visual mais espaçoso, limpo e profissional, eliminando o aspecto claustrofóbico e simplificando operações de seleção múltipla, cópia e movimentação.

- N/A yet.

### Fixed

- N/A yet.
