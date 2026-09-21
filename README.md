# Rdrive ☁️💽

> **Rdrive** é um aplicativo desktop moderno construído com **Tauri v2**, **Rust** e **React**, projetado para montar seus serviços de armazenamento em nuvem favoritos como discos locais nativos utilizando o poder e a flexibilidade do **rclone**.

---

## ✨ Funcionalidades

- ⚡ **Desempenho Nativo com Rust e Tauri v2**: consumo mínimo de memória e CPU.
- 🌐 **Suporte Amplo a Nuvens**: Compatível com todos os provedores suportados pelo Rclone (Google Drive, Microsoft OneDrive, Dropbox, Nextcloud, Amazon S3, WebDAV, SFTP, etc.).
- 📁 **Montagem VFS Completa**: Monta os provedores em `~/Rdrive/<remote>` com suporte a leitura, escrita e streaming em tempo real (`--vfs-cache-mode full`).
- 🛡️ **Desmontagem Segura**: Desmontagem limpa de pontos FUSE (`fusermount`) com hook automático que encerra com segurança todas as montagens ativas ao fechar o app.
- 📂 **Integração com o Sistema**: Botão "Abrir Pasta" que direciona instantaneamente para o gerenciador de arquivos nativo do seu sistema operacional.
- 🎨 **Interface Gráfica Moderna**: Desenvolvida com React, Tailwind CSS e ícones Lucide no tema escuro.

---

## 📋 Pré-requisitos

Para que o Rdrive consiga montar as nuvens no seu sistema operacional, certifique-se de que as seguintes dependências estão instaladas:

### Linux
```bash
# Ubuntu / Debian / Pop!_OS
sudo apt update
sudo apt install rclone fuse3

# Arch Linux
sudo pacman -S rclone fuse3

# Fedora
sudo dnf install rclone fuse3
```

> No Linux, o usuário precisa ter permissão para usar FUSE (geralmente padrão nas distribuições modernas).

---

## 🚀 Como Executar em Desenvolvimento

1. **Instale as dependências Node**:
   ```bash
   npm install
   ```

2. **Inicie o aplicativo (recomendado)**:
   ```bash
   npm run app
   ```
   *(ou alternativamente `npm run tauri dev`)*

3. **Compilar para Produção**:
   ```bash
   npm run tauri build
   ```

---

## ⚙️ Configurando Provedores de Nuvem

O Rdrive utiliza os armazenamentos configurados pelo próprio rclone. Para cadastrar um novo serviço de nuvem:

```bash
rclone config
```

Siga as instruções interativas para autenticar sua conta (ex: Google Drive ou OneDrive). Assim que concluído, clique no botão **Atualizar** no Rdrive para que o novo drive apareça na tela e fique pronto para ser montado!

---

## 📖 Documentação & Changelog

- O registro completo de alterações, adições e correções pode ser encontrado em [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
