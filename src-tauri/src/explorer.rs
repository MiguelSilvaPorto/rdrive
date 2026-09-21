use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::AsyncBufReadExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudEntry {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Path", default)]
    pub path: String,
    #[serde(rename = "Size")]
    pub size: i64,
    #[serde(rename = "IsDir")]
    pub is_dir: bool,
    #[serde(rename = "ModTime")]
    pub mod_time: String,
}

async fn run_rclone(args: &[&str]) -> Result<String, String> {
    let output = tokio::process::Command::new("rclone")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Falha ao executar rclone: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(err.trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Lists the contents of a cloud folder (non-recursive) or specific category
#[tauri::command]
pub async fn list_cloud_files(
    remote: String,
    path: String,
    category: Option<String>,
) -> Result<Vec<CloudEntry>, String> {
    let cat = category.unwrap_or_else(|| "mydrive".to_string());
    let mut args: Vec<String> = vec!["lsjson".to_string()];

    // Limita a profundidade para 1 nível (navegação rápida de diretório / categoria)
    args.push("--max-depth".to_string());
    args.push("1".to_string());

    match cat.as_str() {
        "shared_with_me" => {
            args.push("--drive-shared-with-me".to_string());
        }
        "trash" => {
            args.push("--drive-trashed-only".to_string());
        }
        "starred" => {
            args.push("--drive-starred-only".to_string());
        }
        _ => {}
    }

    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    args.push(target);

    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_rclone(&str_args).await?;
    let mut entries: Vec<CloudEntry> =
        serde_json::from_str(&out).map_err(|e| format!("Falha ao interpretar listagem: {e}"))?;

    if cat == "recent" {
        // Ordena por data mais recente
        entries.sort_by(|a, b| b.mod_time.cmp(&a.mod_time));
    } else {
        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    }

    Ok(entries)
}

/// Streams the contents of a cloud folder as they arrive from rclone, instead of
/// waiting for the whole listing to finish. Emits `explorer-entry-{request_id}`
/// for each item and `explorer-done-{request_id}` with the total count at the end,
/// so the UI can render files progressively rather than freezing on a spinner.
#[tauri::command]
pub async fn list_cloud_files_stream(
    app: tauri::AppHandle,
    request_id: String,
    remote: String,
    path: String,
    category: Option<String>,
) -> Result<usize, String> {
    let cat = category.unwrap_or_else(|| "mydrive".to_string());
    let entry_event = format!("explorer-entry-{request_id}");
    let done_event = format!("explorer-done-{request_id}");

    if cat == "shared" {
        let drives = list_shared_drives(remote).await?;
        for d in &drives {
            let entry = CloudEntry {
                name: d.name.clone(),
                path: d.name.clone(),
                size: 0,
                is_dir: true,
                mod_time: String::new(),
            };
            let _ = app.emit(&entry_event, entry);
        }
        let _ = app.emit(&done_event, drives.len());
        return Ok(drives.len());
    }

    if cat == "recent" || cat == "trash" {
        // lsjson's --max-depth 1 can't be combined with --drive-trashed-only
        // (it silently falls back to a normal, unfiltered folder listing), and
        // there's no reliable way to tell a genuinely trashed folder apart from
        // a path-scaffolding one in that output. Querying the Drive API
        // directly for `trashed = true`/`false` gives the real, unambiguous
        // set of items instead.
        let target = format!("{}:", remote);
        let query = if cat == "trash" {
            "trashed = true"
        } else {
            "trashed = false and mimeType != 'application/vnd.google-apps.folder'"
        };
        let out = match run_rclone(&["backend", "query", &target, query]).await {
            Ok(o) => o,
            Err(e) => return Err(e),
        };

        #[derive(Deserialize)]
        struct QueryItem {
            name: Option<String>,
            size: Option<serde_json::Value>,
            #[serde(rename = "mimeType")]
            mime_type: Option<String>,
            #[serde(rename = "modifiedTime")]
            modified_time: Option<String>,
        }

        let mut items: Vec<CloudEntry> = Vec::new();
        if let Some(start_idx) = out.find('[') {
            if let Ok(raw_items) = serde_json::from_str::<Vec<QueryItem>>(&out[start_idx..]) {
                for item in raw_items {
                    let name = item.name.unwrap_or_default();
                    if name.is_empty() {
                        continue;
                    }
                    let size = match item.size {
                        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0),
                        Some(serde_json::Value::String(s)) => s.parse::<i64>().unwrap_or(0),
                        _ => 0,
                    };
                    let is_dir = item.mime_type.as_deref() == Some("application/vnd.google-apps.folder");
                    let mod_time = item.modified_time.unwrap_or_default();
                    items.push(CloudEntry {
                        name: name.clone(),
                        path: name,
                        size,
                        is_dir,
                        mod_time,
                    });
                }
            }
        }

        // Ordena pelos modificados mais recentemente e limita a 300 itens
        items.sort_by(|a, b| b.mod_time.cmp(&a.mod_time));
        let total = items.len().min(300);
        for entry in items.into_iter().take(total) {
            let _ = app.emit(&entry_event, entry);
        }
        let _ = app.emit(&done_event, total);
        return Ok(total);
    }

    let mut args: Vec<String> = vec!["lsjson".to_string(), "--max-depth".to_string(), "1".to_string()];
    match cat.as_str() {
        "shared_with_me" => args.push("--drive-shared-with-me".to_string()),
        "starred" => args.push("--drive-starred-only".to_string()),
        _ => {}
    }
    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    args.push(target);

    let mut child = tokio::process::Command::new("rclone")
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao executar rclone: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout indisponível")?;
    let mut reader = tokio::io::BufReader::new(stdout).lines();
    let mut count = 0usize;

    while let Ok(Some(line)) = reader.next_line().await {
        let trimmed = line.trim().trim_end_matches(',');
        if trimmed.is_empty() || trimmed == "[" || trimmed == "]" {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<CloudEntry>(trimmed) {
            count += 1;
            let _ = app.emit(&entry_event, entry);
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Falha ao aguardar rclone: {e}"))?;

    if !status.success() {
        let mut stderr_buf = String::new();
        if let Some(mut se) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let _ = se.read_to_string(&mut stderr_buf).await;
        }
        let msg = if stderr_buf.trim().is_empty() {
            "Falha ao listar arquivos.".to_string()
        } else {
            stderr_buf.trim().to_string()
        };
        return Err(msg);
    }

    let _ = app.emit(&done_event, count);
    Ok(count)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedDriveEntry {
    pub id: String,
    pub name: String,
}

/// Lists shared team drives for Google Drive
#[tauri::command]
pub async fn list_shared_drives(remote: String) -> Result<Vec<SharedDriveEntry>, String> {
    let target = format!("{}:", remote);
    let out = match run_rclone(&["backend", "drives", &target]).await {
        Ok(o) => o,
        Err(_) => return Ok(vec![]),
    };

    // Parse JSON array of drives
    let drives: Vec<SharedDriveEntry> = serde_json::from_str(&out).unwrap_or_default();
    Ok(drives)
}

/// Restores / untrashes files from Google Drive trash
#[tauri::command]
pub async fn untrash_cloud_paths(remote: String, paths: Vec<String>) -> Result<String, String> {
    let mut count = 0;
    for path in &paths {
        let p = path.trim_start_matches('/');
        let _ = run_rclone(&["backend", "untrash", &format!("{}:", remote), p]).await;
        count += 1;
    }
    Ok(format!("{count} item(ns) restaurado(s) com sucesso."))
}

/// Empties trash for cloud remotes supporting cleanup (e.g. Google Drive)
#[tauri::command]
pub async fn empty_cloud_trash(remote: String) -> Result<String, String> {
    let target = format!("{}:", remote);
    run_rclone(&["cleanup", &target]).await?;
    Ok("Lixeira esvaziada com sucesso.".to_string())
}

/// Deletes one or more files/folders (folders are removed recursively)
#[tauri::command]
pub async fn delete_cloud_paths(remote: String, paths: Vec<String>, is_dir: Vec<bool>) -> Result<String, String> {
    let mut errors = Vec::new();
    for (path, dir) in paths.iter().zip(is_dir.iter()) {
        let target = format!("{}:{}", remote, path.trim_start_matches('/'));
        let result = if *dir {
            run_rclone(&["purge", &target]).await
        } else {
            run_rclone(&["deletefile", &target]).await
        };
        if let Err(e) = result {
            errors.push(format!("{path}: {e}"));
        }
    }

    if errors.is_empty() {
        Ok(format!("{} item(ns) removido(s).", paths.len()))
    } else {
        Err(errors.join("; "))
    }
}

/// Copies or moves a file/folder to a new destination path within the same remote
#[tauri::command]
pub async fn transfer_cloud_path(
    remote: String,
    source: String,
    destination: String,
    is_dir: bool,
    move_instead_of_copy: bool,
) -> Result<String, String> {
    let src = format!("{}:{}", remote, source.trim_start_matches('/'));
    let dst = format!("{}:{}", remote, destination.trim_start_matches('/'));

    let verb_file = if move_instead_of_copy { "moveto" } else { "copyto" };
    let verb_dir = if move_instead_of_copy { "move" } else { "copy" };
    let verb = if is_dir { verb_dir } else { verb_file };

    run_rclone(&[verb, &src, &dst]).await?;
    let action = if move_instead_of_copy { "movido(s)" } else { "copiado(s)" };
    Ok(format!("Item {action} com sucesso."))
}

/// Creates a new folder inside the given cloud path
#[tauri::command]
pub async fn create_cloud_folder(remote: String, path: String) -> Result<String, String> {
    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    run_rclone(&["mkdir", &target]).await?;
    Ok("Pasta criada com sucesso.".to_string())
}

/// Generates a public share link for a file/folder (only works for providers
/// that support it, e.g. Drive, Dropbox, OneDrive, Box)
#[tauri::command]
pub async fn create_share_link(remote: String, path: String) -> Result<String, String> {
    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    let out = run_rclone(&["link", &target]).await?;
    Ok(out.trim().to_string())
}

/// Downloads a single file from cloud to local user Downloads folder
#[tauri::command]
pub async fn download_cloud_file(remote: String, path: String) -> Result<String, String> {
    let dest_dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir);

    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    let dest = dest_dir.to_string_lossy().to_string();

    let output = tokio::process::Command::new("rclone")
        .arg("copyto")
        .arg(&target)
        .arg(format!("{}/{}", dest, path.split('/').last().unwrap_or("arquivo")))
        .output()
        .await
        .map_err(|e| format!("Falha ao baixar: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro ao baixar: {}", err.trim()));
    }

    Ok(format!("Arquivo salvo em {}", dest))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePreview {
    pub name: String,
    pub is_text: bool,
    pub content: Option<String>,
    pub size: i64,
}

/// Reads small text files (< 512KB) from cloud to preview directly in the UI
#[tauri::command]
pub async fn preview_cloud_file(remote: String, path: String) -> Result<FilePreview, String> {
    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    let name = path.split('/').last().unwrap_or("arquivo").to_string();

    // Fetch cat limited to 512KB
    let output = tokio::process::Command::new("rclone")
        .arg("cat")
        .arg("--head")
        .arg("262144") // 256 KB max preview
        .arg(&target)
        .output()
        .await
        .map_err(|e| format!("Falha ao ler arquivo: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro ao ler arquivo: {}", err.trim()));
    }

    let is_text = match std::str::from_utf8(&output.stdout) {
        Ok(text) => return Ok(FilePreview {
            name,
            is_text: true,
            content: Some(text.to_string()),
            size: output.stdout.len() as i64,
        }),
        Err(_) => false,
    };

    Ok(FilePreview {
        name,
        is_text,
        content: None,
        size: output.stdout.len() as i64,
    })
}
