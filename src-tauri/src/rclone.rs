use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use sysinfo::{Pid, System};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    pub rclone_installed: bool,
    pub rclone_version: Option<String>,
    pub fuse_installed: bool,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDrive {
    pub name: String,
    pub r#type: String,
    pub is_mounted: bool,
    pub mount_point: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Default)]
pub struct AppState {
    // Map remote_name -> (mount_point, Child process PID)
    pub mounted_remotes: Mutex<HashMap<String, (PathBuf, u32)>>,
}

/// Detects if rclone and fuse (fusermount) are installed
#[tauri::command]
pub fn check_system_environment() -> SystemStatus {
    let rclone_check = Command::new("rclone")
        .arg("version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    let (rclone_installed, rclone_version) = match rclone_check {
        Ok(output) if output.status.success() => {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let first_line = out_str.lines().next().unwrap_or("rclone unknown").to_string();
            (true, Some(first_line))
        }
        _ => (false, None),
    };

    let fuse_check = Command::new("which")
        .arg("fusermount3")
        .output()
        .or_else(|_| Command::new("which").arg("fusermount").output());

    let fuse_installed = match fuse_check {
        Ok(output) => output.status.success(),
        _ => false,
    };

    let config_path = get_rclone_config_path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    SystemStatus {
        rclone_installed,
        rclone_version,
        fuse_installed,
        config_path,
    }
}

/// Retrieves path of rclone configuration file
fn get_rclone_config_path() -> Option<PathBuf> {
    if let Ok(output) = Command::new("rclone").arg("config").arg("file").output() {
        if output.status.success() {
            let out = String::from_utf8_lossy(&output.stdout);
            for line in out.lines() {
                let trimmed = line.trim();
                if trimmed.ends_with(".conf") && Path::new(trimmed).exists() {
                    return Some(PathBuf::from(trimmed));
                }
            }
        }
    }

    dirs::config_dir().map(|c| c.join("rclone").join("rclone.conf"))
}

/// Returns list of remotes configured in rclone.conf along with their mount state
#[tauri::command]
pub fn list_remotes(state: State<'_, AppState>) -> Result<Vec<RemoteDrive>, String> {
    let output = Command::new("rclone")
        .arg("listremotes")
        .arg("--long")
        .output()
        .map_err(|e| format!("Falha ao executar rclone: {e}. Verifique se o rclone está instalado."))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro ao listar remotes: {err}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mounted = state.mounted_remotes.lock().unwrap();

    let mut remotes = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let name_with_colon = parts[0];
        let name = name_with_colon.trim_end_matches(':').to_string();
        let r#type = if parts.len() > 1 {
            parts[1].to_string()
        } else {
            "unknown".to_string()
        };

        let (is_mounted, mount_point, pid) = if let Some((mp, p)) = mounted.get(&name) {
            // Check if process is still alive
            let mut s = System::new();
            s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(*p)]), true);
            let alive = s.process(Pid::from_u32(*p)).is_some();
            if alive {
                (true, Some(mp.to_string_lossy().to_string()), Some(*p))
            } else {
                (false, None, None)
            }
        } else {
            (false, None, None)
        };

        remotes.push(RemoteDrive {
            name,
            r#type,
            is_mounted,
            mount_point,
            pid,
        });
    }

    Ok(remotes)
}

/// Mounts a remote to a specified or automatic mountpoint
#[tauri::command]
pub async fn mount_remote(
    remote: String,
    custom_mount_point: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mount_dir = match custom_mount_point {
        Some(p) => PathBuf::from(p),
        None => {
            let home = dirs::home_dir().ok_or("Não foi possível identificar a pasta Home do usuário")?;
            let rdrive_dir = home.join("Rdrive").join(&remote);
            rdrive_dir
        }
    };

    if !mount_dir.exists() {
        std::fs::create_dir_all(&mount_dir)
            .map_err(|e| format!("Não foi possível criar diretório de montagem: {e}"))?;
    }

    // Check if already mounted in state
    {
        let mut mounted = state.mounted_remotes.lock().unwrap();
        if let Some((_mp, pid)) = mounted.get(&remote) {
            let mut s = System::new();
            s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(*pid)]), true);
            if s.process(Pid::from_u32(*pid)).is_some() {
                return Ok(format!("Remote '{remote}' já está montado."));
            } else {
                mounted.remove(&remote);
            }
        }
    }

    let remote_arg = format!("{}:", remote);
    let mount_str = mount_dir.to_string_lossy().to_string();

    let child = Command::new("rclone")
        .arg("mount")
        .arg(&remote_arg)
        .arg(&mount_str)
        .arg("--vfs-cache-mode")
        .arg("full")
        .arg("--vfs-cache-max-age")
        .arg("24h")
        .arg("--buffer-size")
        .arg("64M")
        .arg("--vfs-read-chunk-size")
        .arg("32M")
        .arg("--vfs-read-chunk-size-limit")
        .arg("512M")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar processo rclone mount: {e}"))?;

    let pid = child.id();

    // Sleep briefly to check if it immediately crashed
    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;

    let mut s = System::new();
    s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    if s.process(Pid::from_u32(pid)).is_none() {
        return Err(format!(
            "O rclone mount falhou ao iniciar para '{remote}'. Certifique-se de ter o fuse/fusermount instalado."
        ));
    }

    // Save to active map
    {
        let mut mounted = state.mounted_remotes.lock().unwrap();
        mounted.insert(remote.clone(), (mount_dir.clone(), pid));
    }

    Ok(format!("Montado com sucesso em {}", mount_str))
}

/// Unmounts a remote cleanly
#[tauri::command]
pub fn unmount_remote(remote: String, state: State<'_, AppState>) -> Result<String, String> {
    let mut mounted = state.mounted_remotes.lock().unwrap();
    let entry = mounted.remove(&remote);

    if let Some((mount_point, pid)) = entry {
        let mount_str = mount_point.to_string_lossy().to_string();

        // Attempt fusermount -u first
        let _ = Command::new("fusermount")
            .arg("-u")
            .arg(&mount_str)
            .output()
            .or_else(|_| Command::new("fusermount3").arg("-u").arg(&mount_str).output());

        // Also terminate the rclone process if still alive
        let mut s = System::new();
        s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if let Some(proc) = s.process(Pid::from_u32(pid)) {
            proc.kill();
        }

        Ok(format!("Drive '{remote}' desmontado com sucesso."))
    } else {
        Err(format!("Drive '{remote}' não consta como montado."))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudProvider {
    pub id: String,
    pub label: String,
}

/// Cloud providers supported through rclone's built-in OAuth flow
#[tauri::command]
pub fn list_oauth_providers() -> Vec<CloudProvider> {
    vec![
        ("drive", "Google Drive"),
        ("dropbox", "Dropbox"),
        ("onedrive", "OneDrive"),
        ("box", "Box"),
        ("pcloud", "pCloud"),
        ("yandex", "Yandex Disk"),
        ("google photos", "Google Photos"),
        ("hidrive", "HiDrive"),
        ("mega", "Mega"),
    ]
    .into_iter()
    .map(|(id, label)| CloudProvider {
        id: id.to_string(),
        label: label.to_string(),
    })
    .collect()
}

/// Creates a new remote and runs rclone's OAuth flow, opening the system browser
/// for the user to authorize access. Blocks until the flow completes or times out.
#[tauri::command]
pub async fn create_remote_oauth(name: String, r#type: String) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Informe um nome para o remote.".to_string());
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err("O nome do remote só pode conter letras, números, '-' e '_'.".to_string());
    }

    let existing = Command::new("rclone")
        .arg("listremotes")
        .output()
        .map_err(|e| format!("Falha ao executar rclone: {e}"))?;
    let existing_out = String::from_utf8_lossy(&existing.stdout);
    if existing_out.lines().any(|l| l.trim_end_matches(':') == name) {
        return Err(format!("Já existe um remote chamado '{name}'."));
    }

    let child = tokio::process::Command::new("rclone")
        .arg("config")
        .arg("create")
        .arg(&name)
        .arg(&r#type)
        .arg("--auto-confirm")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar rclone config create: {e}"))?;

    let wait_result = tokio::time::timeout(tokio::time::Duration::from_secs(180), child.wait_with_output()).await;

    let output = match wait_result {
        Ok(res) => res.map_err(|e| format!("Erro ao aguardar autorização: {e}"))?,
        Err(_) => {
            return Err(
                "Tempo esgotado aguardando autorização no navegador. Tente novamente.".to_string(),
            )
        }
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Falha ao autorizar '{name}': {}", err.trim()));
    }

    Ok(format!("Nuvem '{name}' autorizada e adicionada com sucesso."))
}

/// Removes a configured remote (does not affect data stored in the cloud)
#[tauri::command]
pub fn delete_remote(remote: String, state: State<'_, AppState>) -> Result<String, String> {
    {
        let mounted = state.mounted_remotes.lock().unwrap();
        if mounted.contains_key(&remote) {
            return Err("Desmonte o drive antes de removê-lo.".to_string());
        }
    }

    let output = Command::new("rclone")
        .arg("config")
        .arg("delete")
        .arg(&remote)
        .output()
        .map_err(|e| format!("Falha ao executar rclone: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro ao remover '{remote}': {}", err.trim()));
    }

    Ok(format!("Remote '{remote}' removido."))
}

/// Helper to unmount all active drives before exiting
pub fn unmount_all(state: &AppState) {
    let mut mounted = state.mounted_remotes.lock().unwrap();
    for (remote, (mount_point, pid)) in mounted.drain() {
        let mount_str = mount_point.to_string_lossy().to_string();
        let _ = Command::new("fusermount")
            .arg("-u")
            .arg(&mount_str)
            .output()
            .or_else(|_| Command::new("fusermount3").arg("-u").arg(&mount_str).output());

        let mut s = System::new();
        s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if let Some(proc) = s.process(Pid::from_u32(pid)) {
            proc.kill();
        }
        println!("[Rdrive] Desmontado {} ao sair.", remote);
    }
}
