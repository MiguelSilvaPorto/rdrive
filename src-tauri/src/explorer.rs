use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudEntry {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Size")]
    pub size: i64,
    #[serde(rename = "IsDir")]
    pub is_dir: bool,
    #[serde(rename = "ModTime")]
    pub mod_time: String,
}

fn run_rclone(args: &[&str]) -> Result<String, String> {
    let output = Command::new("rclone")
        .args(args)
        .output()
        .map_err(|e| format!("Falha ao executar rclone: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(err.trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Lists the contents of a cloud folder (non-recursive)
#[tauri::command]
pub fn list_cloud_files(remote: String, path: String) -> Result<Vec<CloudEntry>, String> {
    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    let out = run_rclone(&["lsjson", &target])?;
    let mut entries: Vec<CloudEntry> =
        serde_json::from_str(&out).map_err(|e| format!("Falha ao interpretar listagem: {e}"))?;
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Deletes one or more files/folders (folders are removed recursively)
#[tauri::command]
pub fn delete_cloud_paths(remote: String, paths: Vec<String>, is_dir: Vec<bool>) -> Result<String, String> {
    let mut errors = Vec::new();
    for (path, dir) in paths.iter().zip(is_dir.iter()) {
        let target = format!("{}:{}", remote, path.trim_start_matches('/'));
        let result = if *dir {
            run_rclone(&["purge", &target])
        } else {
            run_rclone(&["deletefile", &target])
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
pub fn transfer_cloud_path(
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

    run_rclone(&[verb, &src, &dst])?;
    let action = if move_instead_of_copy { "movido(s)" } else { "copiado(s)" };
    Ok(format!("Item {action} com sucesso."))
}

/// Creates a new folder inside the given cloud path
#[tauri::command]
pub fn create_cloud_folder(remote: String, path: String) -> Result<String, String> {
    let target = format!("{}:{}", remote, path.trim_start_matches('/'));
    run_rclone(&["mkdir", &target])?;
    Ok("Pasta criada com sucesso.".to_string())
}
