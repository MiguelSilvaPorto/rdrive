use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use sysinfo::{Pid, System};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransferStatus {
    Running,
    Paused,
    Interrupted,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferJob {
    pub id: String,
    pub remote: String,
    pub direction: String, // "upload" | "download"
    pub source: String,
    pub dest: String,
    pub status: TransferStatus,
    pub progress_pct: f32,
    pub bytes_done: String,
    pub bytes_total: String,
    pub speed: String,
    pub eta: String,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Default)]
pub struct TransferState {
    pub jobs: Mutex<HashMap<String, TransferJob>>,
    pub pids: Mutex<HashMap<String, u32>>,
}

fn transfers_file() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("rdrive");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("transfers.json")
}

fn persist(jobs: &HashMap<String, TransferJob>) {
    if let Ok(json) = serde_json::to_string_pretty(&jobs.values().collect::<Vec<_>>()) {
        let _ = std::fs::write(transfers_file(), json);
    }
}

/// Loads persisted jobs on startup, marking any still "Running" as "Interrupted"
/// since the process behind them died with the previous app session.
pub fn load_persisted_jobs() -> HashMap<String, TransferJob> {
    let mut map = HashMap::new();
    if let Ok(content) = std::fs::read_to_string(transfers_file()) {
        if let Ok(jobs) = serde_json::from_str::<Vec<TransferJob>>(&content) {
            for mut job in jobs {
                if job.status == TransferStatus::Running {
                    job.status = TransferStatus::Interrupted;
                }
                map.insert(job.id.clone(), job);
            }
        }
    }
    map
}

#[tauri::command]
pub fn list_transfers(state: State<'_, TransferState>) -> Vec<TransferJob> {
    let jobs = state.jobs.lock().unwrap();
    let mut list: Vec<TransferJob> = jobs.values().cloned().collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

/// Starts (or resumes) a transfer job. Resuming reuses the same rclone copy
/// invocation: rclone skips files already fully present at the destination and,
/// combined with --partial-suffix, never mistakes a half-uploaded file for a
/// finished one, so restarting never re-copies completed data.
#[tauri::command]
pub async fn start_transfer(
    app: AppHandle,
    remote: String,
    direction: String,
    source: String,
    dest: String,
    job_id: Option<String>,
    state: State<'_, TransferState>,
) -> Result<String, String> {
    let id = job_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    {
        let jobs = state.jobs.lock().unwrap();
        if let Some(existing) = jobs.get(&id) {
            if existing.status == TransferStatus::Running {
                return Err("Esta transferência já está em andamento.".to_string());
            }
        }
    }

    let job = TransferJob {
        id: id.clone(),
        remote: remote.clone(),
        direction: direction.clone(),
        source: source.clone(),
        dest: dest.clone(),
        status: TransferStatus::Running,
        progress_pct: 0.0,
        bytes_done: "0".to_string(),
        bytes_total: "?".to_string(),
        speed: "0 B/s".to_string(),
        eta: "-".to_string(),
        error: None,
        created_at: chrono::Local::now().to_rfc3339(),
    };

    {
        let mut jobs = state.jobs.lock().unwrap();
        jobs.insert(id.clone(), job.clone());
        persist(&jobs);
    }

    let mut child = Command::new("rclone")
        .arg("copy")
        .arg(&source)
        .arg(&dest)
        .arg("--progress")
        .arg("--stats")
        .arg("1s")
        .arg("--stats-one-line")
        .arg("--partial-suffix")
        .arg(".rdrive-partial")
        .arg("--transfers")
        .arg("4")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar rclone copy: {e}"))?;

    let pid = child.id().ok_or("Não foi possível obter o PID do processo")?;
    state.pids.lock().unwrap().insert(id.clone(), pid);

    let stderr = child.stderr.take().ok_or("stderr indisponível")?;
    let stats_re = Regex::new(
        r"Transferred:\s*([\d.,]+\s*\w+)\s*/\s*([\d.,]+\s*\w+),\s*(\d+)%,\s*([\d.,]+\s*\w+/s),\s*ETA\s*(\S+)",
    )
    .unwrap();

    let app_for_task = app.clone();
    let id_task = id.clone();

    tauri::async_runtime::spawn(async move {
        let jobs_handle = app_for_task.state::<TransferState>();
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(caps) = stats_re.captures(&line) {
                let updated = {
                    let mut jobs = jobs_handle.jobs.lock().unwrap();
                    match jobs.get_mut(&id_task) {
                        Some(job) => {
                            job.bytes_done = caps[1].trim().to_string();
                            job.bytes_total = caps[2].trim().to_string();
                            job.progress_pct = caps[3].parse().unwrap_or(job.progress_pct);
                            job.speed = caps[4].trim().to_string();
                            job.eta = caps[5].trim().to_string();
                        }
                        None => continue,
                    };
                    let cloned = jobs.get(&id_task).cloned();
                    persist(&jobs);
                    cloned
                };
                if let Some(updated) = updated {
                    let _ = app_for_task.emit("transfer-update", updated);
                }
            }
        }

        let status = child.wait().await;
        jobs_handle.pids.lock().unwrap().remove(&id_task);
        let updated = {
            let mut jobs = jobs_handle.jobs.lock().unwrap();
            match jobs.get_mut(&id_task) {
                Some(job) => {
                    match job.status {
                        TransferStatus::Paused => {}
                        _ => {
                            job.status = match status {
                                Ok(s) if s.success() => TransferStatus::Completed,
                                Ok(_) => TransferStatus::Failed,
                                Err(_) => TransferStatus::Failed,
                            };
                            if job.status == TransferStatus::Completed {
                                job.progress_pct = 100.0;
                            }
                        }
                    }
                }
                None => return,
            };
            let cloned = jobs.get(&id_task).cloned();
            persist(&jobs);
            cloned
        };
        if let Some(updated) = updated {
            let _ = app_for_task.emit("transfer-update", updated);
        }
    });

    Ok(id)
}

/// Stops the underlying process but keeps the job so it can be resumed later
/// without losing the files already copied.
#[tauri::command]
pub fn pause_transfer(job_id: String, state: State<'_, TransferState>) -> Result<String, String> {
    let pid = state.pids.lock().unwrap().remove(&job_id);
    if let Some(pid) = pid {
        let mut s = System::new();
        s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if let Some(proc) = s.process(Pid::from_u32(pid)) {
            proc.kill();
        }
    }

    let mut jobs = state.jobs.lock().unwrap();
    if let Some(job) = jobs.get_mut(&job_id) {
        job.status = TransferStatus::Paused;
        persist(&jobs);
        Ok("Transferência pausada. Os arquivos já copiados foram preservados.".to_string())
    } else {
        Err("Transferência não encontrada.".to_string())
    }
}

#[tauri::command]
pub fn cancel_transfer(job_id: String, state: State<'_, TransferState>) -> Result<String, String> {
    let pid = state.pids.lock().unwrap().remove(&job_id);
    if let Some(pid) = pid {
        let mut s = System::new();
        s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if let Some(proc) = s.process(Pid::from_u32(pid)) {
            proc.kill();
        }
    }

    let mut jobs = state.jobs.lock().unwrap();
    jobs.remove(&job_id);
    persist(&jobs);
    Ok("Transferência removida.".to_string())
}

/// Kills every running transfer process (e.g. on app exit) while keeping their
/// job records marked as interrupted so they can be resumed on next launch.
pub fn interrupt_all(state: &TransferState) {
    let mut pids = state.pids.lock().unwrap();
    let mut s = System::new();
    for (_, pid) in pids.drain() {
        s.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if let Some(proc) = s.process(Pid::from_u32(pid)) {
            proc.kill();
        }
    }

    let mut jobs = state.jobs.lock().unwrap();
    for job in jobs.values_mut() {
        if job.status == TransferStatus::Running {
            job.status = TransferStatus::Interrupted;
        }
    }
    persist(&jobs);
}
