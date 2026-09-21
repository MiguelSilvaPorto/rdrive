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
- **Interface Gráfica Moderna**:
  - Layout escuro com React, TypeScript, Tailwind CSS e conjunto de ícones Lucide.
  - Polling periódico e botão manual de atualização para manter o estado sincronizado em tempo real.

### Changed

- N/A yet.

### Fixed

- N/A yet.
