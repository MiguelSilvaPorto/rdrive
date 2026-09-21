import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from "@tauri-apps/plugin-autostart";
import {
  Cloud,
  HardDrive,
  RefreshCw,
  FolderOpen,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Square,
  Plus,
  Trash2,
  X,
  Loader2,
  ShieldCheck,
  Settings,
  Check,
  Sun,
  Moon,
  Monitor,
  Minus,
  Square as SquareIcon,
  Download,
  SlidersHorizontal,
  FolderTree,
  File as FileIcon,
  Folder as FolderIcon,
  ChevronRight,
  Copy,
  Move,
  FolderPlus,
  CheckSquare,
  Square as SquareEmptyIcon,
  Search,
  LayoutGrid,
  List,
  Eye,
  Link2,
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  Archive,
  Code as CodeIcon,
  ArrowUp,
  Users,
  Clock,
  Star,
  AlertCircle,
  Database,
  Trash,
  Laptop,
  RotateCcw,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ArrowUpDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pause,
  PlayCircle,
} from "lucide-react";
import "./App.css";

const appWindow = getCurrentWindow();

interface MountSettings {
  customMountPoint: string;
  vfsCacheMode: "full" | "writes" | "minimal" | "off";
  readOnly: boolean;
  cacheMaxSizeGb: number;
  cacheDir: string;
  autoRemount: boolean;
  bwLimitMbps: number;
}

const DEFAULT_MOUNT_SETTINGS: MountSettings = {
  customMountPoint: "",
  vfsCacheMode: "full",
  readOnly: false,
  cacheMaxSizeGb: 10,
  cacheDir: "",
  autoRemount: false,
  bwLimitMbps: 0,
};

const CACHE_MODES: { id: MountSettings["vfsCacheMode"]; label: string; hint: string }[] = [
  { id: "off", label: "Desligado", hint: "Sem cache local, tudo passa pela rede a cada acesso" },
  { id: "minimal", label: "Mínimo", hint: "Cache apenas de metadados" },
  { id: "writes", label: "Escritas", hint: "Cacheia arquivos sendo escritos" },
  { id: "full", label: "Completo (disco)", hint: "Comportamento mais próximo de um disco local" },
];

const loadMountSettings = (remote: string): MountSettings => {
  try {
    const raw = localStorage.getItem(`rdrive-mount-${remote}`);
    if (raw) return { ...DEFAULT_MOUNT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_MOUNT_SETTINGS };
};

const saveMountSettings = (remote: string, settings: MountSettings) => {
  try {
    localStorage.setItem(`rdrive-mount-${remote}`, JSON.stringify(settings));
  } catch {}
};

type ThemeId = "light" | "dark" | "system";

const THEMES: { id: ThemeId; label: string; icon: typeof Sun; bg: string; surface: string; accent: string }[] = [
  { id: "light", label: "Claro", icon: Sun, bg: "#f8f9fa", surface: "#ffffff", accent: "#1a73e8" },
  { id: "dark", label: "Escuro", icon: Moon, bg: "#202124", surface: "#2d2e30", accent: "#8ab4f8" },
  { id: "system", label: "Sistema", icon: Monitor, bg: "linear-gradient(135deg,#f8f9fa 50%,#202124 50%)", surface: "#ffffff", accent: "#1a73e8" },
];

interface SystemStatus {
  rclone_installed: boolean;
  rclone_version: string | null;
  fuse_installed: boolean;
  config_path: string;
}

interface RemoteDrive {
  name: string;
  type: string;
  is_mounted: boolean;
  mount_point: string | null;
  pid: number | null;
}

interface CloudProvider {
  id: string;
  label: string;
}

interface CloudEntry {
  Name: string;
  Path: string;
  Size: number;
  IsDir: boolean;
  ModTime: string;
}

type TransferStatus = "Running" | "Paused" | "Interrupted" | "Completed" | "Failed";

interface TransferJob {
  id: string;
  remote: string;
  direction: "upload" | "download";
  source: string;
  dest: string;
  status: TransferStatus;
  progress_pct: number;
  bytes_done: string;
  bytes_total: string;
  speed: string;
  eta: string;
  error: string | null;
  created_at: string;
}

const formatBytes = (bytes: number) => {
  if (bytes < 0) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export default function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [remotes, setRemotes] = useState<RemoteDrive[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [providers, setProviders] = useState<CloudProvider[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRemoteName, setNewRemoteName] = useState("");
  const [newRemoteType, setNewRemoteType] = useState("");
  const [authorizing, setAuthorizing] = useState(false);
  const [installingRclone, setInstallingRclone] = useState(false);

  const [showTransfers, setShowTransfers] = useState(false);
  const [transferJobs, setTransferJobs] = useState<TransferJob[]>([]);
  const [showNewTransfer, setShowNewTransfer] = useState(false);
  const [newTransferRemote, setNewTransferRemote] = useState("");
  const [newTransferDirection, setNewTransferDirection] = useState<"upload" | "download">("upload");
  const [newTransferSource, setNewTransferSource] = useState("");
  const [newTransferDest, setNewTransferDest] = useState("");
  const [startingTransfer, setStartingTransfer] = useState(false);

  const activeTransferCount = transferJobs.filter((j) => j.status === "Running").length;

  const [showTraySpeed, setShowTraySpeed] = useState(() => localStorage.getItem("rdrive-tray-speed") === "1");
  const sessionBytesTotal = useRef(0);
  const completedJobIds = useRef<Set<string>>(new Set());

  const parseSizeToBytes = (text: string): number => {
    const match = text.trim().match(/^([\d.,]+)\s*([A-Za-z]+)/);
    if (!match) return 0;
    const value = parseFloat(match[1].replace(",", "."));
    const unit = match[2].toLowerCase();
    const multipliers: Record<string, number> = {
      b: 1,
      kb: 1e3,
      kib: 1024,
      mb: 1e6,
      mib: 1024 ** 2,
      gb: 1e9,
      gib: 1024 ** 3,
      tb: 1e12,
      tib: 1024 ** 4,
    };
    return value * (multipliers[unit] || 1);
  };

  useEffect(() => {
    localStorage.setItem("rdrive-tray-speed", showTraySpeed ? "1" : "0");
  }, [showTraySpeed]);

  useEffect(() => {
    for (const job of transferJobs) {
      if (job.status === "Completed" && !completedJobIds.current.has(job.id)) {
        completedJobIds.current.add(job.id);
        sessionBytesTotal.current += parseSizeToBytes(job.bytes_total);
      }
    }
  }, [transferJobs]);

  useEffect(() => {
    if (!showTraySpeed) {
      invoke("update_tray_status", { text: "" }).catch(() => {});
      return;
    }

    const push = () => {
      const running = transferJobs.filter((j) => j.status === "Running");
      const downloadJobs = running.filter((j) => j.direction === "download");
      const uploadJobs = running.filter((j) => j.direction === "upload");
      const sumSpeed = (jobs: TransferJob[]) => jobs.reduce((acc, j) => acc + parseSizeToBytes(j.speed), 0);
      const downSpeed = sumSpeed(downloadJobs);
      const upSpeed = sumSpeed(uploadJobs);
      const totalGb = (sessionBytesTotal.current / 1e9).toFixed(2);

      const text =
        running.length === 0
          ? `Sem transferências ativas · ${totalGb} GB nesta sessão`
          : `↓ ${formatBytes(downSpeed)}/s  ↑ ${formatBytes(upSpeed)}/s · ${totalGb} GB nesta sessão`;

      invoke("update_tray_status", { text }).catch(() => {});
    };

    push();
    const interval = setInterval(push, 2000);
    return () => clearInterval(interval);
  }, [showTraySpeed, transferJobs]);

  const refreshTransfers = async () => {
    try {
      const jobs = await invoke<TransferJob[]>("list_transfers");
      setTransferJobs(jobs);
    } catch {}
  };

  useEffect(() => {
    refreshTransfers();
    const unlistenPromise = listen<TransferJob>("transfer-update", (event) => {
      setTransferJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === event.payload.id);
        if (idx === -1) return [event.payload, ...prev];
        const next = [...prev];
        next[idx] = event.payload;
        return next;
      });
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  const openNewTransfer = () => {
    setNewTransferRemote(remotes[0]?.name || "");
    setNewTransferDirection("upload");
    setNewTransferSource("");
    setNewTransferDest("");
    setShowNewTransfer(true);
  };

  const handleStartTransfer = async () => {
    if (!newTransferRemote || !newTransferSource.trim() || !newTransferDest.trim()) return;
    setStartingTransfer(true);
    try {
      const source =
        newTransferDirection === "upload" ? newTransferSource.trim() : `${newTransferRemote}:${newTransferSource.trim()}`;
      const dest =
        newTransferDirection === "upload" ? `${newTransferRemote}:${newTransferDest.trim()}` : newTransferDest.trim();
      await invoke<string>("start_transfer", {
        remote: newTransferRemote,
        direction: newTransferDirection,
        source,
        dest,
        jobId: null,
      });
      setShowNewTransfer(false);
      await refreshTransfers();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setStartingTransfer(false);
    }
  };

  const handlePauseTransfer = async (jobId: string) => {
    try {
      await invoke<string>("pause_transfer", { jobId });
      await refreshTransfers();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    }
  };

  const handleResumeTransfer = async (job: TransferJob) => {
    try {
      await invoke<string>("start_transfer", {
        remote: job.remote,
        direction: job.direction,
        source: job.source,
        dest: job.dest,
        jobId: job.id,
      });
      await refreshTransfers();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    }
  };

  const handleCancelTransfer = async (jobId: string) => {
    try {
      await invoke<string>("cancel_transfer", { jobId });
      setTransferJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    }
  };

  const [showSettings, setShowSettings] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<number | null>(() =>
    localStorage.getItem("rdrive-onboarding-done") ? null : 0
  );
  const finishOnboarding = () => {
    localStorage.setItem("rdrive-onboarding-done", "1");
    setOnboardingStep(null);
  };
  const [autostartOn, setAutostartOn] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    isAutostartEnabled().then(setAutostartOn).catch(() => {});
  }, []);

  const toggleAutostart = async () => {
    setAutostartBusy(true);
    try {
      if (autostartOn) {
        await disableAutostart();
        setAutostartOn(false);
      } else {
        await enableAutostart();
        setAutostartOn(true);
      }
    } catch (err: any) {
      setMessage({ type: "error", text: `Falha ao alterar início automático: ${err}` });
    } finally {
      setAutostartBusy(false);
    }
  };
  const [mountSettingsFor, setMountSettingsFor] = useState<string | null>(null);
  const [mountSettingsDraft, setMountSettingsDraft] = useState<MountSettings>(DEFAULT_MOUNT_SETTINGS);

  const [explorerFor, setExplorerFor] = useState<string | null>(null);
  const [explorerPath, setExplorerPath] = useState<string>("");
  const [explorerEntries, setExplorerEntries] = useState<CloudEntry[]>([]);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerSelected, setExplorerSelected] = useState<Set<string>>(new Set());
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [explorerTransferMode, setExplorerTransferMode] = useState<"copy" | "move" | null>(null);
  const [explorerDestInput, setExplorerDestInput] = useState("");
  const [explorerNewFolder, setExplorerNewFolder] = useState<string | null>(null);
  const [explorerSearch, setExplorerSearch] = useState("");
  const [explorerViewMode, setExplorerViewMode] = useState<"list" | "grid">("list");
  const [explorerSortField, setExplorerSortField] = useState<"name" | "size" | "date">("name");
  const [explorerSortOrder, setExplorerSortOrder] = useState<"asc" | "desc">("asc");
  const [explorerPreview, setExplorerPreview] = useState<{
    name: string;
    path: string;
    is_text: boolean;
    content: string | null;
    size: number;
    loading: boolean;
  } | null>(null);
  const [explorerActiveCategory, setExplorerActiveCategory] = useState<string>("mydrive");
  const [explorerQuota, setExplorerQuota] = useState<{ total: number | null; used: number | null; free: number | null } | null>(null);
  const [theme, setTheme] = useState<ThemeId>(() => (localStorage.getItem("rdrive-theme") as ThemeId) || "light");

  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      const isDark =
        theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", isDark);
    };
    applyTheme();
    localStorage.setItem("rdrive-theme", theme);

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", applyTheme);
      return () => mq.removeEventListener("change", applyTheme);
    }
  }, [theme]);

  const autoRemountInFlight = useRef<Set<string>>(new Set());

  const everMounted = useRef<Set<string>>(new Set());

  const notify = async (title: string, body: string) => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    } catch {}
  };

  const fetchStatusAndRemotes = async () => {
    setLoading(true);
    try {
      const sysStatus = await invoke<SystemStatus>("check_system_environment");
      setStatus(sysStatus);

      if (sysStatus.rclone_installed) {
        const remoteList = await invoke<RemoteDrive[]>("list_remotes");
        setRemotes(remoteList);

        for (const remote of remoteList) {
          if (remote.is_mounted) {
            everMounted.current.add(remote.name);
            continue;
          }
          if (autoRemountInFlight.current.has(remote.name)) continue;
          const settings = loadMountSettings(remote.name);
          if (!settings.autoRemount) continue;

          const wasMounted = everMounted.current.has(remote.name);
          if (wasMounted) {
            notify("Rdrive", `A nuvem "${remote.name}" caiu. Tentando remontar automaticamente...`);
          }

          autoRemountInFlight.current.add(remote.name);
          handleMount(remote.name, { silent: true })
            .then(() => {
              if (wasMounted) notify("Rdrive", `Nuvem "${remote.name}" remontada com sucesso.`);
            })
            .finally(() => {
              autoRemountInFlight.current.delete(remote.name);
            });
        }
      }
    } catch (err: any) {
      console.error(err);
      setMessage({ type: "error", text: String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatusAndRemotes();
    const interval = setInterval(fetchStatusAndRemotes, 6000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    invoke<CloudProvider[]>("list_oauth_providers")
      .then((list) => {
        setProviders(list);
        if (list.length > 0) setNewRemoteType(list[0].id);
      })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const openAddModal = () => {
    if (!status?.rclone_installed) {
      setMessage({ type: "error", text: "Instale o rclone primeiro para conectar uma nuvem." });
      return;
    }
    setNewRemoteName("");
    setMessage(null);
    setShowAddModal(true);
  };

  const handleAuthorize = async () => {
    if (!newRemoteName.trim() || !newRemoteType) return;
    setAuthorizing(true);
    setMessage(null);
    try {
      const res = await invoke<string>("create_remote_oauth", {
        name: newRemoteName.trim(),
        type: newRemoteType,
      });
      setMessage({ type: "success", text: res });
      setShowAddModal(false);
      await fetchStatusAndRemotes();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setAuthorizing(false);
    }
  };

  const handleDelete = async (remoteName: string) => {
    setActionLoading(remoteName);
    setMessage(null);
    try {
      const res = await invoke<string>("delete_remote", { remote: remoteName });
      setMessage({ type: "success", text: res });
      await fetchStatusAndRemotes();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setActionLoading(null);
    }
  };

  const handleMount = async (remoteName: string, opts?: { silent?: boolean }): Promise<boolean> => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setActionLoading(remoteName);
      setMessage(null);
    }
    const settings = loadMountSettings(remoteName);
    try {
      const res = await invoke<string>("mount_remote", {
        remote: remoteName,
        customMountPoint: settings.customMountPoint.trim() || null,
        vfsCacheMode: settings.vfsCacheMode,
        readOnly: settings.readOnly,
        vfsCacheMaxSizeGb: settings.vfsCacheMode === "off" ? null : settings.cacheMaxSizeGb,
        cacheDir: settings.cacheDir.trim() || null,
        bwlimitMbps: settings.bwLimitMbps > 0 ? settings.bwLimitMbps : null,
      });
      if (silent) {
        const remoteList = await invoke<RemoteDrive[]>("list_remotes");
        setRemotes(remoteList);
      } else {
        setMessage({ type: "success", text: res });
        await fetchStatusAndRemotes();
      }
      return true;
    } catch (err: any) {
      setMessage({ type: "error", text: silent ? `Auto-remontagem falhou para '${remoteName}': ${err}` : String(err) });
      return false;
    } finally {
      if (!silent) setActionLoading(null);
    }
  };

  const openMountSettings = (remoteName: string) => {
    setMountSettingsDraft(loadMountSettings(remoteName));
    setMountSettingsFor(remoteName);
  };

  const saveMountSettingsAndClose = () => {
    if (mountSettingsFor) saveMountSettings(mountSettingsFor, mountSettingsDraft);
    setMountSettingsFor(null);
  };

  const explorerJoin = (base: string, name: string) => (base ? `${base}/${name}` : name);
  const explorerBreadcrumbs = () => (explorerPath ? explorerPath.split("/").filter(Boolean) : []);

  const explorerRequestId = useRef(0);
  const explorerUnlisten = useRef<UnlistenFn[]>([]);
  const explorerBuffer = useRef<CloudEntry[]>([]);
  const explorerFlushScheduled = useRef(false);
  const [explorerDebugLog, setExplorerDebugLog] = useState<string[]>([]);

  const loadExplorer = async (remote: string, path: string, categoryOverride?: string) => {
    // Cancel any listeners from a previous, still-streaming navigation so its
    // late-arriving entries don't leak into the folder the user is viewing now.
    explorerUnlisten.current.forEach((fn) => fn());
    explorerUnlisten.current = [];

    const requestId = String(++explorerRequestId.current);
    explorerBuffer.current = [];
    setExplorerLoading(true);
    setExplorerEntries([]);
    setExplorerSelected(new Set());
    setExplorerDebugLog([]);
    const cat = categoryOverride !== undefined ? categoryOverride : explorerActiveCategory;

    const t0 = performance.now();
    const log = (msg: string) => {
      const line = `+${((performance.now() - t0) / 1000).toFixed(2)}s ${msg}`;
      setExplorerDebugLog((prev) => [...prev.slice(-30), line]);
    };
    log(`invoke list_cloud_files_stream (${cat})`);

    const flush = () => {
      if (explorerRequestId.current !== Number(requestId)) return;
      setExplorerEntries([...explorerBuffer.current]);
      explorerFlushScheduled.current = false;
    };

    const scheduleFlush = () => {
      if (explorerFlushScheduled.current) return;
      explorerFlushScheduled.current = true;
      requestAnimationFrame(flush);
    };

    try {
      const unEntry = await listen<CloudEntry>(`explorer-entry-${requestId}`, (event) => {
        if (explorerRequestId.current !== Number(requestId)) return;
        if (explorerBuffer.current.length < 3 || explorerBuffer.current.length % 20 === 0) {
          log(`entry event #${explorerBuffer.current.length + 1}: ${event.payload.Name}`);
        }
        explorerBuffer.current.push(event.payload);
        scheduleFlush();
      });
      const unDone = await listen<number>(`explorer-done-${requestId}`, (event) => {
        if (explorerRequestId.current !== Number(requestId)) return;
        log(`done event, total=${event.payload}`);
        flush();
        setExplorerLoading(false);
      });
      explorerUnlisten.current = [unEntry, unDone];

      log("listeners registered, calling invoke...");
      await invoke<number>("list_cloud_files_stream", { requestId, remote, path, category: cat });
      log("invoke() promise resolved");
    } catch (err: any) {
      log(`error: ${err}`);
      if (explorerRequestId.current === Number(requestId)) {
        setMessage({ type: "error", text: String(err) });
        setExplorerLoading(false);
      }
    }
  };

  const openExplorer = (remote: string) => {
    setExplorerFor(remote);
    setExplorerPath("");
    setExplorerActiveCategory("mydrive");
    setExplorerTransferMode(null);
    setExplorerNewFolder(null);
    loadExplorer(remote, "", "mydrive");

    // Busca cota / armazenamento do drive em segundo plano
    invoke<{ total: number | null; used: number | null; free: number | null }>("get_remote_about", { remote })
      .then((res) => setExplorerQuota(res))
      .catch(() => setExplorerQuota(null));
  };

  const handleSelectCategory = (cat: string) => {
    setExplorerActiveCategory(cat);
    setExplorerPath("");
    if (cat === "recent") {
      setExplorerSortField("date");
      setExplorerSortOrder("desc");
    }
    if (explorerFor) {
      loadExplorer(explorerFor, "", cat);
    }
  };

  const handleEmptyTrash = async () => {
    if (!explorerFor) return;
    if (!confirm("Esvaziar permanentemente todos os itens da lixeira da nuvem? Esta ação não pode ser desfeita.")) return;
    setExplorerBusy(true);
    try {
      const res = await invoke<string>("empty_cloud_trash", { remote: explorerFor });
      setMessage({ type: "success", text: res });
      await loadExplorer(explorerFor, "", "trash");
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setExplorerBusy(false);
    }
  };

  const handleRestoreFromTrash = async (names: string[]) => {
    if (!explorerFor || names.length === 0) return;
    setExplorerBusy(true);
    try {
      const res = await invoke<string>("untrash_cloud_paths", {
        remote: explorerFor,
        paths: names,
      });
      setMessage({ type: "success", text: res });
      await loadExplorer(explorerFor, "", "trash");
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setExplorerBusy(false);
    }
  };

  const explorerNavigate = (path: string) => {
    setExplorerPath(path);
    if (explorerFor) loadExplorer(explorerFor, path);
  };

  const toggleExplorerSelect = (name: string) => {
    setExplorerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const visibleExplorerEntries = (() => {
    let list = explorerEntries;
    if (explorerSearch.trim()) {
      const q = explorerSearch.trim().toLowerCase();
      list = list.filter((e) => e.Name.toLowerCase().includes(q));
    }
    const dir = explorerSortOrder === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (a.IsDir !== b.IsDir) return a.IsDir ? -1 : 1;
      if (explorerSortField === "size") return (a.Size - b.Size) * dir;
      if (explorerSortField === "date") return (new Date(a.ModTime).getTime() - new Date(b.ModTime).getTime()) * dir;
      return a.Name.toLowerCase().localeCompare(b.Name.toLowerCase()) * dir;
    });
  })();


  const toggleExplorerSelectAll = () => {
    setExplorerSelected((prev) =>
      prev.size === visibleExplorerEntries.length ? new Set() : new Set(visibleExplorerEntries.map((e) => e.Name))
    );
  };

  const handleExplorerDelete = async () => {
    if (!explorerFor || explorerSelected.size === 0) return;
    const items = explorerEntries.filter((e) => explorerSelected.has(e.Name));
    if (!confirm(`Remover ${items.length} item(ns) da nuvem? Esta ação não pode ser desfeita.`)) return;

    setExplorerBusy(true);
    try {
      const res = await invoke<string>("delete_cloud_paths", {
        remote: explorerFor,
        paths: items.map((i) => explorerJoin(explorerPath, i.Name)),
        isDir: items.map((i) => i.IsDir),
      });
      setMessage({ type: "success", text: res });
      await loadExplorer(explorerFor, explorerPath);
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setExplorerBusy(false);
    }
  };

  const handleExplorerTransfer = async () => {
    if (!explorerFor || explorerSelected.size === 0 || !explorerTransferMode || !explorerDestInput.trim()) return;
    const items = explorerEntries.filter((e) => explorerSelected.has(e.Name));
    setExplorerBusy(true);
    try {
      for (const item of items) {
        const dest = explorerJoin(explorerDestInput.trim(), item.Name);
        await invoke<string>("transfer_cloud_path", {
          remote: explorerFor,
          source: explorerJoin(explorerPath, item.Name),
          destination: dest,
          isDir: item.IsDir,
          moveInsteadOfCopy: explorerTransferMode === "move",
        });
      }
      setMessage({ type: "success", text: `${items.length} item(ns) ${explorerTransferMode === "move" ? "movido(s)" : "copiado(s)"}.` });
      setExplorerTransferMode(null);
      setExplorerDestInput("");
      await loadExplorer(explorerFor, explorerPath);
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setExplorerBusy(false);
    }
  };

  const handleExplorerCreateFolder = async () => {
    if (!explorerFor || !explorerNewFolder?.trim()) return;
    setExplorerBusy(true);
    try {
      await invoke<string>("create_cloud_folder", {
        remote: explorerFor,
        path: explorerJoin(explorerPath, explorerNewFolder.trim()),
      });
      setExplorerNewFolder(null);
      await loadExplorer(explorerFor, explorerPath);
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setExplorerBusy(false);
    }
  };

  const handleExplorerDownload = async (fileName: string) => {
    if (!explorerFor) return;
    setExplorerBusy(true);
    try {
      const fullPath = explorerJoin(explorerPath, fileName);
      const res = await invoke<string>("download_cloud_file", { remote: explorerFor, path: fullPath });
      setMessage({ type: "success", text: res });
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setExplorerBusy(false);
    }
  };

  const handleExplorerShareLink = async (fileName: string) => {
    if (!explorerFor) return;
    try {
      const fullPath = explorerJoin(explorerPath, fileName);
      const link = await invoke<string>("create_share_link", { remote: explorerFor, path: fullPath });
      if (link && navigator.clipboard) {
        await navigator.clipboard.writeText(link);
        setMessage({ type: "success", text: `Link copiado para a área de transferência: ${link}` });
      } else {
        setMessage({ type: "success", text: `Link gerado: ${link}` });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: `Compartilhamento: ${err}` });
    }
  };

  const handleExplorerPreview = async (fileName: string) => {
    if (!explorerFor) return;
    const fullPath = explorerJoin(explorerPath, fileName);
    setExplorerPreview({
      name: fileName,
      path: fullPath,
      is_text: true,
      content: null,
      size: 0,
      loading: true,
    });
    try {
      const preview = await invoke<{ name: string; is_text: boolean; content: string | null; size: number }>(
        "preview_cloud_file",
        { remote: explorerFor, path: fullPath }
      );
      setExplorerPreview({
        name: preview.name,
        path: fullPath,
        is_text: preview.is_text,
        content: preview.content,
        size: preview.size,
        loading: false,
      });
    } catch (err: any) {
      setExplorerPreview((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              is_text: false,
              content: `Não foi possível carregar a prévia: ${err}`,
            }
          : null
      );
    }
  };

  const getFileCategory = (name: string): "image" | "video" | "audio" | "archive" | "code" | "document" | "generic" => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
    if (["mp4", "mkv", "avi", "mov", "webm", "flv"].includes(ext)) return "video";
    if (["mp3", "wav", "flac", "ogg", "m4a", "aac"].includes(ext)) return "audio";
    if (["zip", "tar", "gz", "7z", "rar", "bz2", "xz"].includes(ext)) return "archive";
    if (["rs", "ts", "tsx", "js", "jsx", "py", "json", "html", "css", "c", "cpp", "go", "java", "sh"].includes(ext)) return "code";
    if (["pdf", "docx", "doc", "txt", "md", "pptx", "xlsx", "csv", "odt"].includes(ext)) return "document";
    return "generic";
  };

  const handleUnmount = async (remoteName: string) => {
    setActionLoading(remoteName);
    setMessage(null);
    try {
      const res = await invoke<string>("unmount_remote", { remote: remoteName });
      setMessage({ type: "success", text: res });
      await fetchStatusAndRemotes();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setActionLoading(null);
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await openPath(path);
    } catch (err: any) {
      setMessage({ type: "error", text: `Falha ao abrir pasta: ${err}` });
    }
  };

  const handleDownload = async (url: string) => {
    try {
      await openUrl(url);
    } catch (err: any) {
      setMessage({ type: "error", text: `Falha ao abrir link: ${err}` });
    }
  };

  const handleInstallRclone = async () => {
    setInstallingRclone(true);
    setMessage(null);
    try {
      const res = await invoke<string>("install_rclone");
      setMessage({ type: "success", text: res });
      await fetchStatusAndRemotes();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setInstallingRclone(false);
    }
  };

  const PROVIDER_STYLE: Record<string, { color: string; gradient: string; label: string }> = {
    drive: { color: "#1a73e8", gradient: "linear-gradient(135deg,#4285f4,#34a853 60%,#fbbc05)", label: "GD" },
    dropbox: { color: "#0061ff", gradient: "linear-gradient(135deg,#0061ff,#1e88ff)", label: "DB" },
    onedrive: { color: "#0364b8", gradient: "linear-gradient(135deg,#0364b8,#0f9ff5)", label: "OD" },
    box: { color: "#0061d5", gradient: "linear-gradient(135deg,#0061d5,#2196f3)", label: "BX" },
    pcloud: { color: "#17bed0", gradient: "linear-gradient(135deg,#17bed0,#0fd1a5)", label: "PC" },
    yandex: { color: "#cc0000", gradient: "linear-gradient(135deg,#ffcc00,#ff3333)", label: "YD" },
    "google photos": { color: "#ea4335", gradient: "linear-gradient(135deg,#4285f4,#ea4335 50%,#fbbc05)", label: "GP" },
    hidrive: { color: "#e2001a", gradient: "linear-gradient(135deg,#e2001a,#ff5e5e)", label: "HD" },
    mega: { color: "#d9272e", gradient: "linear-gradient(135deg,#d9272e,#ff5a5f)", label: "MG" },
  };

  const providerStyle = (type: string) =>
    PROVIDER_STYLE[type] || { color: "#5f6368", gradient: "linear-gradient(135deg,#5f6368,#9aa0a6)", label: "??" };

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fa] dark:bg-[#202124] text-[#202124] dark:text-[#e8eaed] font-sans select-none overflow-hidden transition-colors duration-300">
      {/* Top App Bar - Google style */}
      <header
        data-tauri-drag-region
        className="flex items-center justify-between pl-3 pr-0 h-9 bg-white dark:bg-[#2d2e30] border-b border-[#e8eaed] dark:border-white/10 shrink-0 z-20 transition-colors duration-300"
      >
        <div data-tauri-drag-region className="flex items-center space-x-2 flex-1 h-full">
          <div className="w-5 h-5 flex items-center justify-center pointer-events-none">
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path d="M8.5 3L1 15.5 4.5 21.5 12 9z" fill="#0066da" />
              <path d="M8.5 3H16l7.5 12.5H16z" fill="#00ac47" />
              <path d="M4.5 21.5h15L23 15.5H8z" fill="#ffba00" />
              <path d="M16 3l7.5 12.5L20 21.5 12 9z" fill="#ea4335" />
            </svg>
          </div>
          <span className="text-[13px] text-[#5f6368] dark:text-[#e8eaed] font-medium tracking-tight pointer-events-none">
            Rdrive
          </span>
        </div>

        <div className="flex items-center h-full">
          <button
            onClick={fetchStatusAndRemotes}
            disabled={loading}
            className="gdrive-btn h-full px-2.5 flex items-center justify-center text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 transition disabled:opacity-50 cursor-pointer"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#1a73e8]" : ""}`} />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="gdrive-btn h-full px-2.5 flex items-center justify-center text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 transition cursor-pointer"
            title="Configurações"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-4 bg-[#e8eaed] dark:bg-white/10 mx-1" />

          <button
            onClick={() => appWindow.minimize()}
            className="gdrive-btn h-full px-3 flex items-center justify-center text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 transition cursor-pointer"
            title="Minimizar"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            className="gdrive-btn h-full px-3 flex items-center justify-center text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 transition cursor-pointer"
            title="Maximizar"
          >
            <SquareIcon className="w-3 h-3" />
          </button>
          <button
            onClick={() => appWindow.close()}
            className="gdrive-btn h-full px-3 flex items-center justify-center text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#d93025] hover:text-white transition cursor-pointer"
            title="Fechar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Dinâmica: Modo Início vs Modo Explorador Google Drive */}
        <aside className="w-64 bg-[#f8f9fa] dark:bg-[#171b22] px-3 py-4 shrink-0 flex flex-col justify-between overflow-y-auto border-r border-[#e8eaed] dark:border-white/10 transition-colors duration-300">
          {explorerFor ? (
            /* Painel Lateral do Explorador estilo Google Drive */
            <div className="flex flex-col h-full justify-between">
              <div className="space-y-1">
                {/* Botão Novo no estilo Google Drive */}
                <button
                  onClick={() => setExplorerNewFolder("")}
                  className="gdrive-btn flex items-center space-x-3 px-5 py-3 mb-4 bg-white dark:bg-[#2d2e30] hover:shadow-md rounded-2xl shadow-[0_1px_3px_0_rgba(60,64,67,0.3)] text-sm font-medium text-[#3c4043] dark:text-[#e8eaed] transition cursor-pointer w-fit"
                >
                  <Plus className="w-5 h-5 text-[#1a73e8] dark:text-[#8ab4f8]" />
                  <span>Novo</span>
                </button>

                {/* Itens de Navegação estilo Google Drive */}
                <div className="space-y-0.5 text-xs font-medium">
                  <button
                    onClick={() => handleSelectCategory("mydrive")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "mydrive"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <HardDrive className="w-4.5 h-4.5 shrink-0" />
                    <span className="truncate">Meu Drive ({explorerFor})</span>
                  </button>

                  <button
                    onClick={() => handleSelectCategory("shared")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "shared"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <Users className="w-4.5 h-4.5 shrink-0" />
                    <span>Drives compartilhados</span>
                  </button>

                  <button
                    onClick={() => handleSelectCategory("computers")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "computers"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <Laptop className="w-4.5 h-4.5 shrink-0" />
                    <span>Computadores</span>
                  </button>

                  <div className="pt-2 pb-1">
                    <div className="h-px bg-[#e8eaed] dark:bg-white/10 mx-2" />
                  </div>

                  <button
                    onClick={() => handleSelectCategory("shared_with_me")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "shared_with_me"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <Users className="w-4.5 h-4.5 shrink-0" />
                    <span>Compartilhados comigo</span>
                  </button>

                  <button
                    onClick={() => handleSelectCategory("recent")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "recent"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <Clock className="w-4.5 h-4.5 shrink-0" />
                    <span>Recentes</span>
                  </button>

                  <button
                    onClick={() => handleSelectCategory("starred")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "starred"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <Star className="w-4.5 h-4.5 shrink-0" />
                    <span>Com estrela</span>
                  </button>

                  <button
                    onClick={() => handleSelectCategory("spam")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "spam"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <AlertCircle className="w-4.5 h-4.5 shrink-0" />
                    <span>Spam</span>
                  </button>

                  <button
                    onClick={() => handleSelectCategory("trash")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "trash"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <Trash className="w-4.5 h-4.5 shrink-0" />
                    <span>Lixeira</span>
                  </button>

                  <button
                    onClick={() => handleSelectCategory("storage")}
                    className={`w-full flex items-center space-x-3 px-3.5 py-2 rounded-full transition cursor-pointer text-left ${
                      explorerActiveCategory === "storage"
                        ? "bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff] font-semibold"
                        : "text-[#444746] dark:text-[#c4c7c5] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                    }`}
                  >
                    <Database className="w-4.5 h-4.5 shrink-0" />
                    <span>Armazenamento</span>
                  </button>
                </div>
              </div>

              {/* Barra de Armazenamento e Cota no Rodapé da Barra Lateral */}
              <div className="pt-4 pb-1 border-t border-[#e8eaed] dark:border-white/10 px-2">
                <div className="flex items-center space-x-2 text-xs font-medium text-[#444746] dark:text-[#c4c7c5] mb-2">
                  <Cloud className="w-4 h-4 text-[#1a73e8] dark:text-[#8ab4f8]" />
                  <span>Armazenamento</span>
                </div>

                {explorerQuota && explorerQuota.total ? (
                  <div className="space-y-1.5">
                    {/* Barra de Progresso */}
                    <div className="w-full h-1.5 bg-[#e8eaed] dark:bg-white/15 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1a73e8] dark:bg-[#8ab4f8] rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((explorerQuota.used || 0) / explorerQuota.total) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-[#5f6368] dark:text-[#9aa0a6]">
                      {formatBytes(explorerQuota.used || 0)} de {formatBytes(explorerQuota.total)} usados
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-[#5f6368] dark:text-[#9aa0a6]">
                    Calculando cota de disco...
                  </p>
                )}

                {/* Botão Voltar ao Início */}
                <button
                  onClick={() => setExplorerFor(null)}
                  className="gdrive-btn mt-3 w-full py-1.5 px-3 rounded-full text-xs font-medium text-[#1a73e8] dark:text-[#8ab4f8] hover:bg-[#1a73e8]/10 border border-[#1a73e8]/30 transition cursor-pointer text-center"
                >
                  ← Voltar aos Meus Drives
                </button>
              </div>
            </div>
          ) : (
            /* Painel Lateral Padrão do Modo Início */
            <div>
              <button
                onClick={openAddModal}
                className="gdrive-btn flex items-center space-x-3 px-5 py-3.5 mb-4 bg-white dark:bg-[#2d2e30] hover:shadow-md rounded-2xl shadow-[0_1px_3px_0_rgba(60,64,67,0.3)] text-sm font-medium text-[#3c4043] dark:text-[#e8eaed] transition cursor-pointer w-fit"
              >
                <Plus className="w-5 h-5 text-[#1a73e8] dark:text-[#8ab4f8]" />
                <span>Nova Nuvem</span>
              </button>

              <button
                onClick={() => setShowTransfers(false)}
                className={`w-full px-3 py-2 flex items-center space-x-3 rounded-r-full text-sm font-medium transition cursor-pointer text-left ${
                  !showTransfers
                    ? "bg-[#e8f0fe] dark:bg-[#3c4142] text-[#1a73e8] dark:text-[#8ab4f8]"
                    : "text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/5"
                }`}
              >
                <Cloud className="w-4.5 h-4.5" />
                <span>Meu Drive</span>
              </button>

              <button
                onClick={() => setShowTransfers(true)}
                className={`w-full mt-1 px-3 py-2 flex items-center space-x-3 rounded-r-full text-sm font-medium transition cursor-pointer text-left ${
                  showTransfers
                    ? "bg-[#e8f0fe] dark:bg-[#3c4142] text-[#1a73e8] dark:text-[#8ab4f8]"
                    : "text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/5"
                }`}
              >
                <ArrowUpDown className="w-4.5 h-4.5" />
                <span className="flex-1">Transferências</span>
                {activeTransferCount > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#1a73e8] text-white">
                    {activeTransferCount}
                  </span>
                )}
              </button>

              <div className="mt-6 px-3">
                <p className="text-xs font-semibold text-[#5f6368] dark:text-[#9aa0a6] uppercase tracking-wide mb-2">Status do Sistema</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#5f6368] dark:text-[#9aa0a6]">rclone</span>
                    {status?.rclone_installed ? (
                      <span className="flex items-center text-[#188038] font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> OK
                      </span>
                    ) : (
                      <span className="flex items-center text-[#d93025] font-medium">
                        <XCircle className="w-3.5 h-3.5 mr-1" /> Ausente
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#5f6368] dark:text-[#9aa0a6]">FUSE</span>
                    {status?.fuse_installed ? (
                      <span className="flex items-center text-[#188038] font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> OK
                      </span>
                    ) : (
                      <span className="flex items-center text-[#f9ab00] font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Falta
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#5f6368] dark:text-[#9aa0a6]">Montados</span>
                    <span className="font-medium text-[#3c4043] dark:text-[#e8eaed]">
                      {remotes.filter((r) => r.is_mounted).length}/{remotes.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className={`flex-1 overflow-y-auto ${explorerFor ? "flex flex-col" : "px-8 py-6"}`}>
          {explorerFor ? (
          <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#1e232d] transition-colors">
            {/* Header com Nome do Remote e Estatísticas */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#e8eaed] dark:border-white/10 shrink-0 bg-[#f8f9fa] dark:bg-[#171b22]">
              <div className="flex items-center space-x-3 min-w-0">
                <button
                  onClick={() => setExplorerFor(null)}
                  className="gdrive-btn p-2 -ml-2 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#e8eaed] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                  title="Voltar para os drives"
                >
                  <ChevronRight className="w-5 h-5 rotate-180" />
                </button>
                <div className="p-2 rounded-xl bg-[#1a73e8]/10 text-[#1a73e8] dark:text-[#8ab4f8]">
                  <FolderTree className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-base font-semibold text-[#202124] dark:text-[#e8eaed] flex items-center gap-2">
                    <span>{explorerFor}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#1a73e8]/10 text-[#1a73e8] dark:text-[#8ab4f8] font-normal flex items-center gap-1">
                      {explorerLoading && explorerEntries.length > 0 && (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      )}
                      {explorerEntries.length} item(ns){explorerLoading && explorerEntries.length > 0 ? "..." : ""}
                    </span>
                  </h1>
                  <p className="text-[11px] text-[#5f6368] dark:text-[#9aa0a6]">
                    Nuvem remota conectada via Rclone
                  </p>
                </div>
              </div>

              {/* Botão de Atualizar e Fechar rápido */}
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => explorerFor && loadExplorer(explorerFor, explorerPath)}
                  disabled={explorerLoading}
                  className="gdrive-btn p-2 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#e8eaed] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                  title="Recarregar pasta"
                >
                  <RefreshCw className={`w-4 h-4 ${explorerLoading ? "animate-spin text-[#1a73e8]" : ""}`} />
                </button>
                <button
                  onClick={() => setExplorerFor(null)}
                  className="gdrive-btn p-2 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#e8eaed] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                  title="Fechar explorador"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Breadcrumbs Interativo com Botão Subir Pasta */}
            <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[#e8eaed] dark:border-white/10 text-xs shrink-0 bg-white/50 dark:bg-[#1a1f29] backdrop-blur-sm">
              <button
                onClick={() => {
                  const segments = explorerBreadcrumbs();
                  if (segments.length > 0) {
                    explorerNavigate(segments.slice(0, -1).join("/"));
                  }
                }}
                disabled={!explorerPath}
                className="gdrive-btn p-1.5 rounded-lg border border-[#e8eaed] dark:border-white/10 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                title="Subir um nível (pasta anterior)"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center flex-wrap gap-1 flex-1 overflow-x-auto py-0.5">
                <button
                  onClick={() => handleSelectCategory("mydrive")}
                  className={`gdrive-btn px-2.5 py-1 rounded-lg text-xs transition cursor-pointer font-medium ${
                    !explorerPath && explorerActiveCategory === "mydrive"
                      ? "bg-[#1a73e8]/10 text-[#1a73e8] dark:text-[#8ab4f8] font-semibold"
                      : "text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10"
                  }`}
                >
                  {explorerFor} (raiz)
                </button>
                {explorerActiveCategory !== "mydrive" && (
                  <div className="flex items-center gap-1">
                    <ChevronRight className="w-3.5 h-3.5 text-[#9aa0a6] shrink-0" />
                    <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#c2e7ff] dark:bg-[#004a77] text-[#001d35] dark:text-[#c2e7ff]">
                      {explorerActiveCategory === "shared_with_me" && "Compartilhados comigo"}
                      {explorerActiveCategory === "recent" && "Recentes"}
                      {explorerActiveCategory === "starred" && "Com estrela"}
                      {explorerActiveCategory === "trash" && "Lixeira"}
                      {explorerActiveCategory === "shared" && "Drives compartilhados"}
                      {explorerActiveCategory === "computers" && "Computadores"}
                      {explorerActiveCategory === "spam" && "Spam"}
                      {explorerActiveCategory === "storage" && "Armazenamento"}
                    </span>
                  </div>
                )}
                {explorerBreadcrumbs().map((segment, idx) => {
                  const path = explorerBreadcrumbs().slice(0, idx + 1).join("/");
                  const isLast = idx === explorerBreadcrumbs().length - 1;
                  return (
                    <div key={path} className="flex items-center gap-1">
                      <ChevronRight className="w-3.5 h-3.5 text-[#9aa0a6] shrink-0" />
                      <button
                        onClick={() => explorerNavigate(path)}
                        className={`gdrive-btn px-2.5 py-1 rounded-lg text-xs transition cursor-pointer ${
                          isLast
                            ? "bg-[#1a73e8]/10 text-[#1a73e8] dark:text-[#8ab4f8] font-semibold"
                            : "text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10"
                        }`}
                      >
                        {segment}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Barra de Ferramentas, Busca e Filtros */}
            <div className="flex items-center flex-wrap gap-2.5 px-6 py-2.5 border-b border-[#e8eaed] dark:border-white/10 shrink-0 bg-white dark:bg-[#1e232d]">
              {/* Campo de Busca Rápida */}
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9aa0a6]" />
                <input
                  type="text"
                  value={explorerSearch}
                  onChange={(e) => setExplorerSearch(e.target.value)}
                  placeholder="Filtrar arquivos nesta pasta..."
                  className="w-full pl-9 pr-7 py-1.5 text-xs bg-[#f1f3f4] dark:bg-white/5 border border-transparent dark:border-white/10 rounded-full focus:bg-white dark:focus:bg-transparent focus:border-[#1a73e8] dark:focus:border-[#8ab4f8] focus:outline-none transition dark:text-[#e8eaed]"
                />
                {explorerSearch && (
                  <button
                    onClick={() => setExplorerSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9aa0a6] hover:text-[#5f6368] dark:hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {explorerActiveCategory === "trash" && (
                <button
                  onClick={handleEmptyTrash}
                  className="gdrive-btn flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-[#d93025] bg-[#fce8e6] hover:bg-[#fad2cf] border border-[#fad2cf] dark:border-[#d93025]/30 rounded-full transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Esvaziar lixeira</span>
                </button>
              )}

              {/* Botões de Ação Básica */}
              <button
                onClick={toggleExplorerSelectAll}
                className="gdrive-btn flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-[#3c4043] dark:text-[#e8eaed] bg-[#f1f3f4] dark:bg-white/5 hover:bg-[#e8eaed] dark:hover:bg-white/10 border border-[#e8eaed] dark:border-white/10 rounded-full transition cursor-pointer"
              >
                {explorerSelected.size > 0 && explorerSelected.size === explorerEntries.length ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[#1a73e8] dark:text-[#8ab4f8]" />
                ) : (
                  <SquareEmptyIcon className="w-3.5 h-3.5" />
                )}
                <span>{explorerSelected.size > 0 ? `${explorerSelected.size} marcados` : "Selecionar tudo"}</span>
              </button>

              {explorerActiveCategory !== "trash" && (
                <button
                  onClick={() => setExplorerNewFolder("")}
                  className="gdrive-btn flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-[#3c4043] dark:text-[#e8eaed] bg-[#f1f3f4] dark:bg-white/5 hover:bg-[#e8eaed] dark:hover:bg-white/10 border border-[#e8eaed] dark:border-white/10 rounded-full transition cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-[#1a73e8] dark:text-[#8ab4f8]" />
                  <span>Nova pasta</span>
                </button>
              )}

              <span className="w-px h-5 bg-[#e8eaed] dark:bg-white/10 mx-1 hidden sm:block" />

              {/* Seletor de Ordenação */}
              <div className="flex items-center space-x-1 bg-[#f1f3f4] dark:bg-white/5 p-0.5 rounded-full border border-[#e8eaed] dark:border-white/10">
                <button
                  onClick={() => {
                    if (explorerSortField === "name") setExplorerSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                    else {
                      setExplorerSortField("name");
                      setExplorerSortOrder("asc");
                    }
                  }}
                  className={`px-2.5 py-1 text-xs rounded-full transition cursor-pointer ${
                    explorerSortField === "name"
                      ? "bg-white dark:bg-white/20 text-[#1a73e8] dark:text-white font-semibold shadow-xs"
                      : "text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-white"
                  }`}
                  title="Ordenar por Nome"
                >
                  Nome {explorerSortField === "name" && (explorerSortOrder === "asc" ? "↑" : "↓")}
                </button>
                <button
                  onClick={() => {
                    if (explorerSortField === "size") setExplorerSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                    else {
                      setExplorerSortField("size");
                      setExplorerSortOrder("desc");
                    }
                  }}
                  className={`px-2.5 py-1 text-xs rounded-full transition cursor-pointer ${
                    explorerSortField === "size"
                      ? "bg-white dark:bg-white/20 text-[#1a73e8] dark:text-white font-semibold shadow-xs"
                      : "text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-white"
                  }`}
                  title="Ordenar por Tamanho"
                >
                  Tamanho {explorerSortField === "size" && (explorerSortOrder === "asc" ? "↑" : "↓")}
                </button>
                <button
                  onClick={() => {
                    if (explorerSortField === "date") setExplorerSortOrder((o) => (o === "asc" ? "desc" : "asc"));
                    else {
                      setExplorerSortField("date");
                      setExplorerSortOrder("desc");
                    }
                  }}
                  className={`px-2.5 py-1 text-xs rounded-full transition cursor-pointer ${
                    explorerSortField === "date"
                      ? "bg-white dark:bg-white/20 text-[#1a73e8] dark:text-white font-semibold shadow-xs"
                      : "text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-white"
                  }`}
                  title="Ordenar por Data"
                >
                  Data {explorerSortField === "date" && (explorerSortOrder === "asc" ? "↑" : "↓")}
                </button>
              </div>

              {/* Alternar Visualização: Lista ou Grade */}
              <div className="flex items-center space-x-0.5 bg-[#f1f3f4] dark:bg-white/5 p-0.5 rounded-full border border-[#e8eaed] dark:border-white/10">
                <button
                  onClick={() => setExplorerViewMode("list")}
                  className={`p-1.5 rounded-full transition cursor-pointer ${
                    explorerViewMode === "list"
                      ? "bg-white dark:bg-white/20 text-[#1a73e8] dark:text-white shadow-xs"
                      : "text-[#5f6368] dark:text-[#9aa0a6]"
                  }`}
                  title="Visualização em Lista"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setExplorerViewMode("grid")}
                  className={`p-1.5 rounded-full transition cursor-pointer ${
                    explorerViewMode === "grid"
                      ? "bg-white dark:bg-white/20 text-[#1a73e8] dark:text-white shadow-xs"
                      : "text-[#5f6368] dark:text-[#9aa0a6]"
                  }`}
                  title="Visualização em Grade de Ícones"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Ações em lote para seleção */}
              {explorerSelected.size > 0 && (
                <div className="flex items-center space-x-1.5 ml-auto animate-scaleIn">
                  {explorerActiveCategory === "trash" ? (
                    <button
                      onClick={() => handleRestoreFromTrash(Array.from(explorerSelected))}
                      disabled={explorerBusy}
                      className="gdrive-btn flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-[#1a73e8] dark:text-[#8ab4f8] bg-[#e8f0fe] dark:bg-[#1a73e8]/20 hover:bg-[#d2e3fc] rounded-full transition cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restaurar ({explorerSelected.size})</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setExplorerTransferMode("copy");
                          setExplorerDestInput(explorerPath);
                        }}
                        disabled={explorerBusy}
                        className="gdrive-btn flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-[#1a73e8] dark:text-[#8ab4f8] bg-[#e8f0fe] dark:bg-[#1a73e8]/20 hover:bg-[#d2e3fc] rounded-full transition cursor-pointer disabled:opacity-50"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar</span>
                      </button>
                      <button
                        onClick={() => {
                          setExplorerTransferMode("move");
                          setExplorerDestInput(explorerPath);
                        }}
                        disabled={explorerBusy}
                        className="gdrive-btn flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-[#1a73e8] dark:text-[#8ab4f8] bg-[#e8f0fe] dark:bg-[#1a73e8]/20 hover:bg-[#d2e3fc] rounded-full transition cursor-pointer disabled:opacity-50"
                      >
                        <Move className="w-3.5 h-3.5" />
                        <span>Mover</span>
                      </button>
                    </>
                  )}
                  {explorerActiveCategory !== "trash" && (
                    <button
                      onClick={handleExplorerDelete}
                      disabled={explorerBusy}
                      className="gdrive-btn flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-[#d93025] bg-[#fce8e6] dark:bg-[#d93025]/20 hover:bg-[#fad2cf] rounded-full transition cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Deletar</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Input inline para Nova Pasta */}
            {explorerNewFolder !== null && (
              <div className="animate-fadeIn flex items-center gap-2 px-6 py-2.5 border-b border-[#e8eaed] dark:border-white/10 bg-[#f8f9fa] dark:bg-[#171b22] shrink-0">
                <FolderPlus className="w-4 h-4 text-[#1a73e8] dark:text-[#8ab4f8]" />
                <input
                  autoFocus
                  type="text"
                  value={explorerNewFolder}
                  onChange={(e) => setExplorerNewFolder(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleExplorerCreateFolder()}
                  placeholder="Digite o nome da nova pasta..."
                  className="flex-1 px-3.5 py-1.5 text-xs border border-[#dadce0] dark:border-white/15 dark:bg-transparent dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40"
                />
                <button
                  onClick={handleExplorerCreateFolder}
                  disabled={!explorerNewFolder.trim() || explorerBusy}
                  className="gdrive-btn px-4 py-1.5 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full transition cursor-pointer disabled:opacity-50"
                >
                  Criar
                </button>
                <button
                  onClick={() => setExplorerNewFolder(null)}
                  className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Input inline para Copiar / Mover */}
            {explorerTransferMode && (
              <div className="animate-fadeIn flex items-center gap-2 px-6 py-2.5 border-b border-[#e8eaed] dark:border-white/10 bg-[#e8f0fe]/50 dark:bg-[#171b22] shrink-0">
                <span className="text-xs font-medium text-[#1a73e8] dark:text-[#8ab4f8] shrink-0">
                  {explorerTransferMode === "copy" ? "Copiar para pasta:" : "Mover para pasta:"}
                </span>
                <input
                  autoFocus
                  type="text"
                  value={explorerDestInput}
                  onChange={(e) => setExplorerDestInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleExplorerTransfer()}
                  placeholder="ex: Fotos/2026 ou deixe vazio para a raiz"
                  className="flex-1 px-3 py-1.5 text-xs border border-[#dadce0] dark:border-white/15 dark:bg-transparent dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40"
                />
                <button
                  onClick={handleExplorerTransfer}
                  disabled={explorerBusy}
                  className="gdrive-btn px-4 py-1.5 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full transition cursor-pointer disabled:opacity-50"
                >
                  Confirmar
                </button>
                <button
                  onClick={() => setExplorerTransferMode(null)}
                  className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Lista e Grade de Arquivos */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Visualização Especial: Painel de Armazenamento */}
              {explorerActiveCategory === "storage" && explorerQuota && (
                <div className="mb-6 p-6 rounded-2xl bg-[#f8f9fa] dark:bg-white/5 border border-[#e8eaed] dark:border-white/10 animate-fadeIn">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="p-3 rounded-2xl bg-[#1a73e8]/10 text-[#1a73e8] dark:text-[#8ab4f8]">
                      <Database className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-[#202124] dark:text-[#e8eaed]">
                        Gerenciamento de Armazenamento
                      </h2>
                      <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6]">
                        Uso total de espaço na nuvem do Google Drive
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-[#3c4043] dark:text-[#e8eaed]">
                        {formatBytes(explorerQuota.used || 0)} utilizados
                      </span>
                      <span className="text-[#5f6368] dark:text-[#9aa0a6]">
                        {formatBytes(explorerQuota.total || 0)} disponíveis
                      </span>
                    </div>
                    <div className="w-full h-3 bg-[#e8eaed] dark:bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#1a73e8] to-[#4285f4] rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((explorerQuota.used || 0) / (explorerQuota.total || 1)) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#5f6368] dark:text-[#9aa0a6] pt-1">
                      <span>
                        Livre: {formatBytes(explorerQuota.free || (explorerQuota.total || 0) - (explorerQuota.used || 0))}
                      </span>
                      <span>
                        {Math.round(((explorerQuota.used || 0) / (explorerQuota.total || 1)) * 100)}% ocupado
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-[#5f6368] dark:text-[#9aa0a6] pt-2 border-t border-[#e8eaed] dark:border-white/10">
                    💡 Abaixo você encontra os arquivos listados na raiz da sua nuvem ordenados por tamanho para facilitar a liberação de espaço.
                  </div>
                </div>
              )}

              {explorerLoading && explorerEntries.length === 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center space-x-2 text-xs text-[#9aa0a6] mb-1 animate-fadeIn">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Consultando a nuvem...</span>
                  </div>
                  {explorerDebugLog.length > 0 && (
                    <div className="font-mono text-[10px] text-[#9aa0a6] bg-black/20 dark:bg-black/30 rounded-lg p-2.5 max-h-40 overflow-y-auto space-y-0.5">
                      {explorerDebugLog.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  )}
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="skeleton h-12 rounded-xl" style={{ animationDelay: `${i * 60}ms` }} />
                  ))}
                </div>
              ) : (() => {
                // Filtragem e Ordenação
                let filtered = explorerEntries.filter((e) =>
                  e.Name.toLowerCase().includes(explorerSearch.trim().toLowerCase())
                );
                filtered.sort((a, b) => {
                  if (a.IsDir !== b.IsDir) return a.IsDir ? -1 : 1;
                  let cmp = 0;
                  if (explorerSortField === "name") cmp = a.Name.localeCompare(b.Name);
                  else if (explorerSortField === "size") cmp = (a.Size || 0) - (b.Size || 0);
                  else if (explorerSortField === "date") cmp = (a.ModTime || "").localeCompare(b.ModTime || "");
                  return explorerSortOrder === "asc" ? cmp : -cmp;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center py-16 animate-fadeIn">
                      {explorerActiveCategory === "trash" ? (
                        <>
                          <div className="w-16 h-16 rounded-full bg-[#fce8e6] dark:bg-[#d93025]/10 flex items-center justify-center text-[#d93025] mb-3">
                            <Trash className="w-8 h-8" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed] mb-1">
                            A lixeira está vazia
                          </h3>
                          <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] max-w-sm">
                            Os itens excluídos da sua nuvem aparecerão aqui antes de serem permanentemente removidos.
                          </p>
                        </>
                      ) : explorerActiveCategory === "shared" ? (
                        <>
                          <div className="w-16 h-16 rounded-full bg-[#e8f0fe] dark:bg-[#1a73e8]/10 flex items-center justify-center text-[#1a73e8] dark:text-[#8ab4f8] mb-3">
                            <Users className="w-8 h-8" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed] mb-1">
                            Nenhum drive compartilhado
                          </h3>
                          <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] max-w-sm">
                            Esta conta de nuvem não possui Team Drives ou Drives Compartilhados vinculados no momento.
                          </p>
                        </>
                      ) : explorerActiveCategory === "computers" ? (
                        <>
                          <div className="w-16 h-16 rounded-full bg-[#f1f3f4] dark:bg-white/10 flex items-center justify-center text-[#5f6368] dark:text-[#e8eaed] mb-3">
                            <Laptop className="w-8 h-8" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed] mb-1">
                            Nenhum computador sincronizando
                          </h3>
                          <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] max-w-sm">
                            Pastas locais sincronizadas automaticamente através do aplicativo de backup do Google Drive aparecerão aqui.
                          </p>
                        </>
                      ) : explorerActiveCategory === "starred" ? (
                        <>
                          <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center text-amber-500 mb-3">
                            <Star className="w-8 h-8" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed] mb-1">
                            Nenhum item com estrela
                          </h3>
                          <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] max-w-sm">
                            Adicione estrelas a arquivos e pastas no seu Google Drive para encontrá-los facilmente aqui.
                          </p>
                        </>
                      ) : explorerActiveCategory === "spam" ? (
                        <>
                          <div className="w-16 h-16 rounded-full bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-orange-500 mb-3">
                            <AlertCircle className="w-8 h-8" />
                          </div>
                          <h3 className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed] mb-1">
                            Nenhum spam encontrado
                          </h3>
                          <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] max-w-sm">
                            Arquivos marcados como spam ou suspeitos compartilhados com você são filtrados para cá.
                          </p>
                        </>
                      ) : (
                        <>
                          <FolderIcon className="w-12 h-12 text-[#dadce0] dark:text-white/10 mb-3" />
                          <p className="text-sm font-medium text-[#5f6368] dark:text-[#9aa0a6]">
                            {explorerSearch ? `Nenhum arquivo correspondente a "${explorerSearch}"` : "Esta pasta está vazia."}
                          </p>
                        </>
                      )}
                    </div>
                  );
                }

                // Renderização em Grade
                if (explorerViewMode === "grid") {
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
                      {filtered.map((entry, entryIdx) => {
                        const selected = explorerSelected.has(entry.Name);
                        const category = getFileCategory(entry.Name);
                        return (
                          <div
                            key={`${entry.Name}-${entryIdx}`}
                            onClick={() => toggleExplorerSelect(entry.Name)}
                            onDoubleClick={() => entry.IsDir && explorerNavigate(explorerJoin(explorerPath, entry.Name))}
                            className={`group relative p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col items-center text-center ${
                              selected
                                ? "bg-[#e8f0fe] dark:bg-[#1a73e8]/20 border-[#1a73e8] dark:border-[#8ab4f8] shadow-sm"
                                : "bg-white dark:bg-white/5 border-[#e8eaed] dark:border-white/10 hover:border-[#1a73e8]/50 hover:shadow-md"
                            }`}
                          >
                            {/* Checkbox no topo */}
                            <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ opacity: selected ? 1 : undefined }}>
                              {selected ? (
                                <CheckSquare className="w-4 h-4 text-[#1a73e8] dark:text-[#8ab4f8]" />
                              ) : (
                                <SquareEmptyIcon className="w-4 h-4 text-[#9aa0a6]" />
                              )}
                            </div>

                            {/* Ícone */}
                            <div className="w-12 h-12 my-2 rounded-2xl flex items-center justify-center bg-[#f1f3f4] dark:bg-white/10 text-[#5f6368] dark:text-[#e8eaed] group-hover:scale-105 transition-transform">
                              {entry.IsDir ? (
                                <FolderIcon className="w-7 h-7 text-[#1a73e8] dark:text-[#8ab4f8] fill-[#1a73e8]/20" />
                              ) : category === "image" ? (
                                <ImageIcon className="w-6 h-6 text-emerald-500" />
                              ) : category === "video" ? (
                                <VideoIcon className="w-6 h-6 text-purple-500" />
                              ) : category === "audio" ? (
                                <MusicIcon className="w-6 h-6 text-amber-500" />
                              ) : category === "code" ? (
                                <CodeIcon className="w-6 h-6 text-blue-500" />
                              ) : category === "archive" ? (
                                <Archive className="w-6 h-6 text-orange-500" />
                              ) : (
                                <FileText className="w-6 h-6 text-[#9aa0a6]" />
                              )}
                            </div>

                            {/* Nome e Tamanho */}
                            <span className="w-full text-xs font-medium text-[#202124] dark:text-[#e8eaed] truncate mb-0.5">
                              {entry.Name}
                            </span>
                            <span className="text-[11px] text-[#9aa0a6]">
                              {entry.IsDir ? "Pasta" : formatBytes(entry.Size)}
                            </span>

                            {/* Ações rápidas ao passar o mouse */}
                            <div className="mt-2 pt-2 border-t border-[#e8eaed]/50 dark:border-white/5 w-full flex items-center justify-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {explorerActiveCategory === "trash" ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRestoreFromTrash([entry.Name]);
                                  }}
                                  className="p-1 rounded-full text-[#1a73e8] dark:text-[#8ab4f8] hover:bg-[#e8f0fe] dark:hover:bg-[#1a73e8]/20"
                                  title="Restaurar este item"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              ) : !entry.IsDir ? (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleExplorerPreview(entry.Name);
                                    }}
                                    className="p-1 rounded-full text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                                    title="Prévia"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleExplorerDownload(entry.Name);
                                    }}
                                    className="p-1 rounded-full text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                                    title="Baixar para Downloads"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleExplorerShareLink(entry.Name);
                                    }}
                                    className="p-1 rounded-full text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#e8eaed] dark:hover:bg-white/10"
                                    title="Copiar Link"
                                  >
                                    <Link2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                // Renderização em Lista
                return (
                  <div className="overflow-hidden rounded-2xl border border-[#e8eaed] dark:border-white/10 bg-white dark:bg-white/5 shadow-xs">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#e8eaed] dark:border-white/10 bg-[#f8f9fa] dark:bg-white/5 text-[#5f6368] dark:text-[#9aa0a6] font-medium">
                          <th className="pl-4 py-3 w-10"></th>
                          <th className="py-3 w-10"></th>
                          <th className="py-3">Nome</th>
                          <th className="py-3 w-28">Tamanho</th>
                          <th className="py-3 w-36">Modificado</th>
                          <th className="pr-4 py-3 w-32 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e8eaed]/60 dark:divide-white/5">
                        {filtered.map((entry, entryIdx) => {
                          const selected = explorerSelected.has(entry.Name);
                          const category = getFileCategory(entry.Name);
                          return (
                            <tr
                              key={`${entry.Name}-${entryIdx}`}
                              onClick={() => toggleExplorerSelect(entry.Name)}
                              onDoubleClick={() => entry.IsDir && explorerNavigate(explorerJoin(explorerPath, entry.Name))}
                              className={`group cursor-pointer transition-colors ${
                                selected
                                  ? "bg-[#e8f0fe] dark:bg-[#1a73e8]/20"
                                  : "hover:bg-[#f8f9fa] dark:hover:bg-white/5"
                              }`}
                            >
                              <td className="pl-4 py-3">
                                {selected ? (
                                  <CheckSquare className="w-4 h-4 text-[#1a73e8] dark:text-[#8ab4f8]" />
                                ) : (
                                  <SquareEmptyIcon className="w-4 h-4 text-[#dadce0] dark:text-white/20 group-hover:text-[#9aa0a6]" />
                                )}
                              </td>
                              <td className="py-3">
                                {entry.IsDir ? (
                                  <FolderIcon className="w-4.5 h-4.5 text-[#1a73e8] dark:text-[#8ab4f8] fill-[#1a73e8]/20" />
                                ) : category === "image" ? (
                                  <ImageIcon className="w-4 h-4 text-emerald-500" />
                                ) : category === "video" ? (
                                  <VideoIcon className="w-4 h-4 text-purple-500" />
                                ) : category === "audio" ? (
                                  <MusicIcon className="w-4 h-4 text-amber-500" />
                                ) : category === "code" ? (
                                  <CodeIcon className="w-4 h-4 text-blue-500" />
                                ) : category === "archive" ? (
                                  <Archive className="w-4 h-4 text-orange-500" />
                                ) : (
                                  <FileText className="w-4 h-4 text-[#9aa0a6]" />
                                )}
                              </td>
                              <td className="py-3 pr-4 font-medium text-[#202124] dark:text-[#e8eaed]">
                                <span className="hover:underline">{entry.Name}</span>
                              </td>
                              <td className="py-3 text-[#5f6368] dark:text-[#9aa0a6]">
                                {entry.IsDir ? "—" : formatBytes(entry.Size)}
                              </td>
                              <td className="py-3 text-[#5f6368] dark:text-[#9aa0a6]">
                                {entry.ModTime ? new Date(entry.ModTime).toLocaleDateString() : "—"}
                              </td>
                              <td className="pr-4 py-3 text-right">
                                <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {explorerActiveCategory === "trash" ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRestoreFromTrash([entry.Name]);
                                      }}
                                      className="p-1 text-[#1a73e8] dark:text-[#8ab4f8] hover:bg-[#e8f0fe] dark:hover:bg-[#1a73e8]/20 rounded-full transition cursor-pointer"
                                      title="Restaurar este item"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  ) : !entry.IsDir ? (
                                    <>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleExplorerPreview(entry.Name);
                                        }}
                                        className="p-1 text-[#5f6368] dark:text-[#e8eaed] hover:text-[#1a73e8] hover:bg-[#e8eaed] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                                        title="Prévia"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleExplorerDownload(entry.Name);
                                        }}
                                        className="p-1 text-[#5f6368] dark:text-[#e8eaed] hover:text-[#1a73e8] hover:bg-[#e8eaed] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                                        title="Baixar para pasta Downloads"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleExplorerShareLink(entry.Name);
                                        }}
                                        className="p-1 text-[#5f6368] dark:text-[#e8eaed] hover:text-[#1a73e8] hover:bg-[#e8eaed] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                                        title="Gerar link de compartilhamento"
                                      >
                                        <Link2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
          ) : showTransfers ? (
          <>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-[22px] font-normal text-[#3c4043] dark:text-[#e8eaed]">Transferências</h1>
                <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] mt-0.5">
                  Cópias em segundo plano que retomam de onde pararam se forem interrompidas.
                </p>
              </div>
              <button
                onClick={openNewTransfer}
                disabled={remotes.length === 0}
                className="gdrive-btn flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>Nova Transferência</span>
              </button>
            </div>

            {transferJobs.length === 0 ? (
              <div className="animate-fadeIn p-16 text-center rounded-2xl border-2 border-dashed border-[#dadce0] dark:border-white/15 flex flex-col items-center justify-center space-y-3">
                <div className="p-4 bg-[#e8f0fe] dark:bg-[#1a73e8]/20 rounded-full text-[#1a73e8] dark:text-[#8ab4f8]">
                  <ArrowUpDown className="w-10 h-10" />
                </div>
                <h3 className="text-base font-medium text-[#3c4043] dark:text-[#e8eaed]">Nenhuma transferência ainda</h3>
                <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6] max-w-sm">
                  Envie ou baixe pastas inteiras em segundo plano. Se a app fechar ou a rede cair a meio, é só clicar em
                  "Retomar" — nada que já foi copiado é refeito.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {transferJobs.map((job) => {
                  const statusStyle: Record<TransferStatus, { label: string; color: string; bg: string }> = {
                    Running: { label: "Em andamento", color: "text-[#1a73e8] dark:text-[#8ab4f8]", bg: "bg-[#e8f0fe] dark:bg-[#1a73e8]/20" },
                    Paused: { label: "Pausada", color: "text-[#f9ab00]", bg: "bg-[#fef7e0] dark:bg-[#f9ab00]/20" },
                    Interrupted: { label: "Interrompida", color: "text-[#f9ab00]", bg: "bg-[#fef7e0] dark:bg-[#f9ab00]/20" },
                    Completed: { label: "Concluída", color: "text-[#188038]", bg: "bg-[#e6f4ea] dark:bg-[#188038]/20" },
                    Failed: { label: "Falhou", color: "text-[#d93025]", bg: "bg-[#fce8e6] dark:bg-[#d93025]/20" },
                  };
                  const s = statusStyle[job.status];
                  const DirIcon = job.direction === "upload" ? ArrowUpFromLine : ArrowDownToLine;

                  return (
                    <div
                      key={job.id}
                      className="gdrive-card p-4 rounded-2xl border border-[#e8eaed] dark:border-white/10 bg-white dark:bg-[#2d2e30]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center space-x-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-[#f1f3f4] dark:bg-white/10 text-[#5f6368] dark:text-[#e8eaed] flex items-center justify-center shrink-0">
                            <DirIcon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[#202124] dark:text-[#e8eaed] truncate">
                              {job.source} <ArrowRight className="w-3 h-3 inline mx-1 text-[#9aa0a6]" /> {job.dest}
                            </p>
                            <p className="text-xs text-[#9aa0a6] mt-0.5">{job.remote}</p>
                          </div>
                        </div>
                        <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${s.color} ${s.bg}`}>
                          {s.label}
                        </span>
                      </div>

                      <div className="mt-3 h-1.5 rounded-full bg-[#f1f3f4] dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#1a73e8] dark:bg-[#8ab4f8] transition-all duration-500"
                          style={{ width: `${Math.min(100, Math.max(0, job.progress_pct))}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6]">
                          {job.bytes_done} / {job.bytes_total}
                          {job.status === "Running" && ` · ${job.speed} · ETA ${job.eta}`}
                        </p>

                        <div className="flex items-center space-x-1.5">
                          {job.status === "Running" && (
                            <button
                              onClick={() => handlePauseTransfer(job.id)}
                              className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#9aa0a6] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                              title="Pausar"
                            >
                              <Pause className="w-4 h-4" />
                            </button>
                          )}
                          {(job.status === "Paused" || job.status === "Interrupted" || job.status === "Failed") && (
                            <button
                              onClick={() => handleResumeTransfer(job)}
                              className="gdrive-btn p-1.5 text-[#1a73e8] dark:text-[#8ab4f8] hover:bg-[#e8f0fe] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                              title="Retomar"
                            >
                              <PlayCircle className="w-4 h-4" />
                            </button>
                          )}
                          {job.status !== "Completed" && (
                            <button
                              onClick={() => handleCancelTransfer(job.id)}
                              className="gdrive-btn p-1.5 text-[#d93025] hover:bg-[#fce8e6] dark:hover:bg-[#d93025]/10 rounded-full transition cursor-pointer"
                              title="Cancelar e remover"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {job.status === "Completed" && (
                            <button
                              onClick={() => handleCancelTransfer(job.id)}
                              className="gdrive-btn p-1.5 text-[#9aa0a6] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                              title="Remover da lista"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {job.error && (
                        <p className="text-xs text-[#d93025] mt-2 bg-[#fce8e6] dark:bg-[#d93025]/10 rounded-lg px-2.5 py-1.5">
                          {job.error}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
          ) : (
          <>
          {status && (!status.rclone_installed || !status.fuse_installed) && (
            <div className="animate-slideUp mb-5 p-4 rounded-xl bg-[#fef7e0] border border-[#f9ab00]/40 flex items-start space-x-3 text-[#7d5900]">
              <AlertTriangle className="w-5 h-5 text-[#f9ab00] shrink-0 mt-0.5" />
              <div className="text-sm flex-1">
                <h4 className="font-semibold">Dependências do Sistema Ausentes</h4>
                <ul className="mt-1 space-y-2.5 text-xs">
                  {!status.rclone_installed && (
                    <li className="flex items-center justify-between gap-3 flex-wrap">
                      <span>
                        O <strong>rclone</strong> não foi encontrado no PATH. Instale-o com:{" "}
                        <code className="bg-black/5 px-1.5 py-0.5 rounded">sudo apt install rclone</code>.
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={handleInstallRclone}
                          disabled={installingRclone}
                          className="gdrive-btn flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#f9ab00] hover:bg-[#e39900] rounded-full shadow-sm transition cursor-pointer disabled:opacity-60"
                          title="Executa o instalador oficial (rclone.org/install.sh) com privilégios de administrador"
                        >
                          {installingRclone ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          <span>{installingRclone ? "Instalando..." : "Instalar rclone"}</span>
                        </button>
                        <button
                          onClick={() => handleDownload("https://rclone.org/downloads/")}
                          className="gdrive-btn text-xs font-medium text-[#7d5900] hover:underline cursor-pointer"
                        >
                          instalar manualmente
                        </button>
                      </div>
                    </li>
                  )}
                  {!status.fuse_installed && (
                    <li className="flex items-center justify-between gap-3 flex-wrap">
                      <span>
                        O <strong>FUSE (fusermount)</strong> não foi detectado:{" "}
                        <code className="bg-black/5 px-1.5 py-0.5 rounded">sudo apt install fuse3</code>
                      </span>
                      <button
                        onClick={() => handleDownload("https://github.com/libfuse/libfuse/releases")}
                        className="gdrive-btn shrink-0 flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#f9ab00] hover:bg-[#e39900] rounded-full shadow-sm transition cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Baixar FUSE</span>
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <h1 className="text-[22px] font-normal text-[#3c4043] dark:text-[#e8eaed] mb-5">Meus Drives na Nuvem</h1>

          {loading && remotes.length === 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-28 rounded-2xl" />
              ))}
            </div>
          )}

          {remotes.length === 0 && !loading && (
            <div className="animate-fadeIn p-16 text-center rounded-2xl border-2 border-dashed border-[#dadce0] dark:border-white/15 flex flex-col items-center justify-center space-y-3">
              <div className="p-4 bg-[#e8f0fe] rounded-full text-[#1a73e8]">
                <Cloud className="w-10 h-10" />
              </div>
              <h3 className="text-base font-medium text-[#3c4043] dark:text-[#e8eaed]">Nenhuma nuvem conectada ainda</h3>
              <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6] max-w-sm">
                Clique em <strong>Nova Nuvem</strong> e autorize sua conta pelo navegador — Google Drive, Dropbox,
                OneDrive e outros.
              </p>
              <button
                onClick={openAddModal}
                className="gdrive-btn mt-2 flex items-center space-x-2 px-5 py-2.5 bg-[#1a73e8] hover:bg-[#1765cc] text-white text-sm font-medium rounded-full shadow-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Conectar minha primeira nuvem</span>
              </button>
            </div>
          )}

          {(() => {
            const groups = new Map<string, RemoteDrive[]>();
            for (const r of remotes) {
              const list = groups.get(r.type) || [];
              list.push(r);
              groups.set(r.type, list);
            }
            const groupEntries = [...groups.entries()];
            const showGroupHeaders = groupEntries.length > 1;

            return groupEntries.map(([type, group]) => (
              <div key={type} className="mb-6 last:mb-0">
                {showGroupHeaders && (
                  <div className="flex items-center space-x-2 mb-3">
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold shadow-sm"
                      style={{ background: providerStyle(type).gradient }}
                    >
                      {providerStyle(type).label}
                    </div>
                    <h2 className="text-sm font-semibold text-[#3c4043] dark:text-[#e8eaed] capitalize">{type}</h2>
                    <span className="text-xs text-[#9aa0a6]">
                      {group.length} {group.length === 1 ? "conta" : "contas"}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.map((remote, idx) => {
              const isAction = actionLoading === remote.name;
              return (
                <div
                  key={remote.name}
                  style={{ animationDelay: `${idx * 40}ms` }}
                  className={`gdrive-card animate-slideUp p-5 rounded-2xl border flex flex-col space-y-4 bg-white dark:bg-[#2d2e30] ${
                    remote.is_mounted ? "border-[#1a73e8]/50 dark:border-[#8ab4f8]/50" : "border-[#e8eaed] dark:border-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-sm"
                        style={{ background: providerStyle(remote.type).gradient }}
                      >
                        <HardDrive className="w-5.5 h-5.5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed]">{remote.name}</h3>
                        <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] capitalize">{remote.type}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-0.5">
                      <button
                        onClick={() => openExplorer(remote.name)}
                        className="gdrive-btn p-1.5 text-[#9aa0a6] hover:text-[#1a73e8] hover:bg-[#e8f0fe] rounded-full transition cursor-pointer"
                        title="Explorador de arquivos na nuvem"
                      >
                        <FolderTree className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openMountSettings(remote.name)}
                        className="gdrive-btn p-1.5 text-[#9aa0a6] hover:text-[#1a73e8] hover:bg-[#e8f0fe] rounded-full transition cursor-pointer"
                        title="Configurações de montagem"
                      >
                        <SlidersHorizontal className="w-4 h-4" />
                      </button>
                      {!remote.is_mounted && (
                        <button
                          onClick={() => handleDelete(remote.name)}
                          disabled={isAction}
                          className="gdrive-btn p-1.5 text-[#9aa0a6] hover:text-[#d93025] hover:bg-[#fce8e6] rounded-full transition cursor-pointer disabled:opacity-40"
                          title="Remover nuvem"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {remote.is_mounted ? (
                    <div className="flex items-center space-x-1.5 text-xs font-medium text-[#188038]">
                      <span className="w-2 h-2 rounded-full bg-[#188038] ripple-dot" />
                      <span>Montado</span>
                      <span className="text-[#5f6368] dark:text-[#9aa0a6] font-normal truncate">· {remote.mount_point}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-[#9aa0a6]">Desconectado</p>
                  )}

                  <div className="flex items-center space-x-2 pt-1">
                    {remote.is_mounted && remote.mount_point && (
                      <button
                        onClick={() => handleOpenFolder(remote.mount_point!)}
                        className="gdrive-btn flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-medium text-[#3c4043] bg-[#f1f3f4] hover:bg-[#e8eaed] rounded-full transition cursor-pointer"
                      >
                        <FolderOpen className="w-4 h-4" />
                        <span>Abrir</span>
                      </button>
                    )}

                    {remote.is_mounted ? (
                      <button
                        onClick={() => handleUnmount(remote.name)}
                        disabled={isAction}
                        className="gdrive-btn flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold text-[#d93025] bg-[#fce8e6] hover:bg-[#fad2cf] rounded-full transition cursor-pointer disabled:opacity-50"
                      >
                        {isAction ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Square className="w-3.5 h-3.5 fill-[#d93025]" />
                        )}
                        <span>{isAction ? "Desmontando" : "Desmontar"}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleMount(remote.name)}
                        disabled={isAction || !status?.rclone_installed}
                        className="gdrive-btn flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full shadow-sm transition cursor-pointer disabled:opacity-50"
                      >
                        {isAction ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-white" />
                        )}
                        <span>{isAction ? "Montando" : "Montar"}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
                  })}
                </div>
              </div>
            ));
          })()}
          </>
          )}
        </main>
      </div>

      {/* Toast message */}
      {message && (
        <div
          className={`animate-slideUp fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-lg shadow-lg flex items-center space-x-3 text-sm font-medium max-w-lg ${
            message.type === "success" ? "bg-[#323232] text-white" : "bg-[#d93025] text-white"
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-white/70 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add Cloud Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 animate-fadeIn"
            onClick={() => !authorizing && setShowAddModal(false)}
          />
          <div className="relative animate-scaleIn bg-white dark:bg-[#2d2e30] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#e8eaed] dark:border-white/10">
              <h2 className="text-lg font-medium text-[#202124] dark:text-[#e8eaed]">Conectar nova nuvem</h2>
              <button
                onClick={() => !authorizing && setShowAddModal(false)}
                className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">Provedor</label>
                <div className="grid grid-cols-3 gap-2">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setNewRemoteType(p.id)}
                      disabled={authorizing}
                      className={`gdrive-btn px-2 py-2.5 rounded-xl text-xs font-medium border transition cursor-pointer text-center ${
                        newRemoteType === p.id
                          ? "border-[#1a73e8] dark:border-[#8ab4f8] bg-[#e8f0fe] dark:bg-[#1a73e8]/20 text-[#1a73e8] dark:text-[#8ab4f8]"
                          : "border-[#e8eaed] dark:border-white/10 text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f8f9fa] dark:hover:bg-white/5"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">Nome do remote</label>
                <input
                  type="text"
                  value={newRemoteName}
                  onChange={(e) => setNewRemoteName(e.target.value)}
                  disabled={authorizing}
                  placeholder="ex: meu-google-drive"
                  className="w-full px-3.5 py-2.5 text-sm border border-[#dadce0] dark:border-white/15 dark:bg-transparent dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40 focus:border-[#1a73e8] transition disabled:opacity-50"
                />
              </div>

              {authorizing && (
                <div className="animate-fadeIn flex items-center space-x-3 p-3.5 bg-[#e8f0fe] dark:bg-[#1a73e8]/20 rounded-xl text-[#1a73e8] dark:text-[#8ab4f8] text-xs">
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                  <div>
                    <p className="font-medium flex items-center space-x-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Aguardando autorização...</span>
                    </p>
                    <p className="text-[#1a73e8]/80 dark:text-[#8ab4f8]/80 mt-0.5">
                      Uma janela do navegador foi aberta. Conclua o login e a permissão de acesso.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 px-6 py-4 bg-[#f8f9fa] dark:bg-[#202124]">
              <button
                onClick={() => setShowAddModal(false)}
                disabled={authorizing}
                className="gdrive-btn px-4 py-2 text-sm font-medium text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAuthorize}
                disabled={authorizing || !newRemoteName.trim() || !newRemoteType}
                className="gdrive-btn flex items-center space-x-2 px-5 py-2 text-sm font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                {authorizing && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{authorizing ? "Autorizando" : "Autorizar no navegador"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Transfer Modal */}
      {showNewTransfer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 animate-fadeIn"
            onClick={() => !startingTransfer && setShowNewTransfer(false)}
          />
          <div className="relative animate-scaleIn bg-white dark:bg-[#2d2e30] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#e8eaed] dark:border-white/10">
              <h2 className="text-lg font-medium text-[#202124] dark:text-[#e8eaed]">Nova transferência</h2>
              <button
                onClick={() => !startingTransfer && setShowNewTransfer(false)}
                className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">Nuvem</label>
                <select
                  value={newTransferRemote}
                  onChange={(e) => setNewTransferRemote(e.target.value)}
                  disabled={startingTransfer}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#dadce0] dark:border-white/15 dark:bg-[#202124] dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40 focus:border-[#1a73e8] transition"
                >
                  {remotes.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">Direção</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setNewTransferDirection("upload")}
                    disabled={startingTransfer}
                    className={`gdrive-btn flex items-center justify-center space-x-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition cursor-pointer ${
                      newTransferDirection === "upload"
                        ? "border-[#1a73e8] dark:border-[#8ab4f8] bg-[#e8f0fe] dark:bg-[#1a73e8]/20 text-[#1a73e8] dark:text-[#8ab4f8]"
                        : "border-[#e8eaed] dark:border-white/10 text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f8f9fa] dark:hover:bg-white/5"
                    }`}
                  >
                    <ArrowUpFromLine className="w-3.5 h-3.5" />
                    <span>Enviar (local → nuvem)</span>
                  </button>
                  <button
                    onClick={() => setNewTransferDirection("download")}
                    disabled={startingTransfer}
                    className={`gdrive-btn flex items-center justify-center space-x-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition cursor-pointer ${
                      newTransferDirection === "download"
                        ? "border-[#1a73e8] dark:border-[#8ab4f8] bg-[#e8f0fe] dark:bg-[#1a73e8]/20 text-[#1a73e8] dark:text-[#8ab4f8]"
                        : "border-[#e8eaed] dark:border-white/10 text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f8f9fa] dark:hover:bg-white/5"
                    }`}
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    <span>Baixar (nuvem → local)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">
                  {newTransferDirection === "upload" ? "Pasta local de origem" : "Pasta na nuvem de origem"}
                </label>
                <input
                  type="text"
                  value={newTransferSource}
                  onChange={(e) => setNewTransferSource(e.target.value)}
                  disabled={startingTransfer}
                  placeholder={newTransferDirection === "upload" ? "/home/usuario/Documentos" : "Fotos/2026"}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#dadce0] dark:border-white/15 dark:bg-transparent dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40 focus:border-[#1a73e8] transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">
                  {newTransferDirection === "upload" ? "Pasta na nuvem de destino" : "Pasta local de destino"}
                </label>
                <input
                  type="text"
                  value={newTransferDest}
                  onChange={(e) => setNewTransferDest(e.target.value)}
                  disabled={startingTransfer}
                  placeholder={newTransferDirection === "upload" ? "Backups/2026" : "/home/usuario/Downloads"}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#dadce0] dark:border-white/15 dark:bg-transparent dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40 focus:border-[#1a73e8] transition"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 px-6 py-4 bg-[#f8f9fa] dark:bg-[#202124]">
              <button
                onClick={() => setShowNewTransfer(false)}
                disabled={startingTransfer}
                className="gdrive-btn px-4 py-2 text-sm font-medium text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleStartTransfer}
                disabled={startingTransfer || !newTransferRemote || !newTransferSource.trim() || !newTransferDest.trim()}
                className="gdrive-btn flex items-center space-x-2 px-5 py-2 text-sm font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full shadow-sm transition cursor-pointer disabled:opacity-50"
              >
                {startingTransfer && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{startingTransfer ? "Iniciando..." : "Iniciar transferência"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Per-remote Mount Settings Modal */}
      {mountSettingsFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 animate-fadeIn" onClick={() => setMountSettingsFor(null)} />
          <div className="relative animate-scaleIn bg-white dark:bg-[#2d2e30] rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#e8eaed] dark:border-white/10 shrink-0">
              <h2 className="text-lg font-medium text-[#202124] dark:text-[#e8eaed]">
                Montagem de <span className="text-[#1a73e8] dark:text-[#8ab4f8]">{mountSettingsFor}</span>
              </h2>
              <button
                onClick={() => setMountSettingsFor(null)}
                className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">
                  Ponto de montagem (opcional)
                </label>
                <input
                  type="text"
                  value={mountSettingsDraft.customMountPoint}
                  onChange={(e) =>
                    setMountSettingsDraft((s) => ({ ...s, customMountPoint: e.target.value }))
                  }
                  placeholder={`~/Rdrive/${mountSettingsFor}`}
                  className="w-full px-3.5 py-2.5 text-sm border border-[#dadce0] dark:border-white/15 dark:bg-transparent dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40 focus:border-[#1a73e8] transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">
                  Modo de cache (VFS)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CACHE_MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMountSettingsDraft((s) => ({ ...s, vfsCacheMode: m.id }))}
                      title={m.hint}
                      className={`gdrive-btn px-3 py-2.5 rounded-xl text-xs font-medium border transition cursor-pointer text-left ${
                        mountSettingsDraft.vfsCacheMode === m.id
                          ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8] dark:bg-[#3c4142] dark:text-[#8ab4f8] dark:border-[#8ab4f8]"
                          : "border-[#e8eaed] dark:border-white/10 text-[#3c4043] dark:text-[#e8eaed] hover:bg-[#f8f9fa] dark:hover:bg-white/5"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[#9aa0a6] mt-1.5">
                  {CACHE_MODES.find((m) => m.id === mountSettingsDraft.vfsCacheMode)?.hint}
                </p>
              </div>

              {mountSettingsDraft.vfsCacheMode !== "off" && (
                <div className="animate-fadeIn space-y-3 p-3.5 rounded-xl bg-[#f8f9fa] dark:bg-[#202124]">
                  <div>
                    <label className="flex items-center justify-between text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">
                      <span>Tamanho máximo do cache</span>
                      <span className="text-[#1a73e8] dark:text-[#8ab4f8] font-semibold">
                        {mountSettingsDraft.cacheMaxSizeGb} GB
                      </span>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={200}
                      step={1}
                      value={mountSettingsDraft.cacheMaxSizeGb}
                      onChange={(e) =>
                        setMountSettingsDraft((s) => ({ ...s, cacheMaxSizeGb: Number(e.target.value) }))
                      }
                      className="w-full accent-[#1a73e8] cursor-pointer"
                    />
                    <p className="text-[11px] text-[#9aa0a6] mt-1">
                      Quando atingir o limite, os arquivos acessados há mais tempo são removidos do cache
                      automaticamente (nunca da nuvem) para abrir espaço.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] mb-1.5">
                      Pasta do cache (opcional)
                    </label>
                    <input
                      type="text"
                      value={mountSettingsDraft.cacheDir}
                      onChange={(e) => setMountSettingsDraft((s) => ({ ...s, cacheDir: e.target.value }))}
                      placeholder="ex: /mnt/hd-externo/rdrive-cache"
                      className="w-full px-3.5 py-2.5 text-sm border border-[#dadce0] dark:border-white/15 dark:bg-transparent dark:text-[#e8eaed] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40 focus:border-[#1a73e8] transition"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-[#3c4043] dark:text-[#e8eaed]">Somente leitura</span>
                <input
                  type="checkbox"
                  checked={mountSettingsDraft.readOnly}
                  onChange={(e) => setMountSettingsDraft((s) => ({ ...s, readOnly: e.target.checked }))}
                  className="rdrive-checkbox w-4 h-4 cursor-pointer"
                />
              </label>

              <label className="flex items-start justify-between gap-3 cursor-pointer pt-1 border-t border-[#e8eaed] dark:border-white/10">
                <span className="pt-3">
                  <span className="block text-sm text-[#3c4043] dark:text-[#e8eaed]">
                    Manter sempre montado
                  </span>
                  <span className="block text-[11px] text-[#9aa0a6] mt-0.5">
                    Monta automaticamente ao abrir o app e remonta sozinho se a conexão cair.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={mountSettingsDraft.autoRemount}
                  onChange={(e) => setMountSettingsDraft((s) => ({ ...s, autoRemount: e.target.checked }))}
                  className="rdrive-checkbox w-4 h-4 mt-3.5 cursor-pointer shrink-0"
                />
              </label>
            </div>

            <div className="flex items-center justify-between px-6 py-4 bg-[#f8f9fa] dark:bg-[#202124] shrink-0">
              <p className="text-[11px] text-[#9aa0a6] max-w-[220px]">Aplica-se na próxima vez que montar.</p>
              <button
                onClick={saveMountSettingsAndClose}
                className="gdrive-btn px-5 py-2 text-sm font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full shadow-sm transition cursor-pointer"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 animate-fadeIn" onClick={() => setShowSettings(false)} />
          <div className="relative animate-scaleIn bg-white dark:bg-[#2d2e30] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#e8eaed] dark:border-white/10">
              <h2 className="text-lg font-medium text-[#202124] dark:text-[#e8eaed]">Configurações</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5">
              <p className="text-xs font-semibold text-[#5f6368] dark:text-[#9aa0a6] uppercase tracking-wide mb-3">
                Tema
              </p>
              <div className="grid grid-cols-3 gap-3">
                {THEMES.map((t) => {
                  const Icon = t.icon;
                  const selected = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`theme-card relative flex flex-col items-center rounded-2xl border-2 p-2.5 cursor-pointer bg-transparent ${
                        selected
                          ? "border-[#1a73e8] dark:border-[#8ab4f8]"
                          : "border-[#e8eaed] dark:border-white/10 hover:border-[#dadce0] dark:hover:border-white/20"
                      }`}
                    >
                      <div
                        className="theme-card-preview w-full h-16 rounded-xl overflow-hidden shadow-inner flex flex-col"
                        style={{ background: t.bg }}
                      >
                        <div className="h-4 w-full" style={{ background: t.surface }} />
                        <div className="flex-1 flex items-center justify-center">
                          <div
                            className="theme-card-dot w-6 h-6 rounded-full flex items-center justify-center"
                            style={{ background: t.accent }}
                          >
                            <Icon className="w-3.5 h-3.5 text-white" />
                          </div>
                        </div>
                      </div>
                      <span className="mt-2 text-xs font-medium text-[#3c4043] dark:text-[#e8eaed]">{t.label}</span>

                      <div
                        className={`theme-check absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#1a73e8] dark:bg-[#8ab4f8] flex items-center justify-center ${
                          selected ? "opacity-100 scale-100" : "opacity-0 scale-50"
                        }`}
                      >
                        <Check className="w-3 h-3 text-white dark:text-[#202124]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-6 pb-5">
              <p className="text-xs font-semibold text-[#5f6368] dark:text-[#9aa0a6] uppercase tracking-wide mb-3">
                Sistema
              </p>
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span>
                    <span className="block text-sm text-[#3c4043] dark:text-[#e8eaed]">Iniciar com o sistema</span>
                    <span className="block text-[11px] text-[#9aa0a6] mt-0.5">
                      Abre o Rdrive automaticamente ao ligar o computador (minimizado no tray).
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={autostartOn}
                    disabled={autostartBusy}
                    onChange={toggleAutostart}
                    className="rdrive-checkbox w-4 h-4 cursor-pointer shrink-0 ml-3"
                  />
                </label>

                <div className="flex items-center justify-between pt-2 border-t border-[#e8eaed] dark:border-white/10">
                  <span>
                    <span className="block text-sm text-[#3c4043] dark:text-[#e8eaed]">Atalho global</span>
                    <span className="block text-[11px] text-[#9aa0a6] mt-0.5">
                      Mostra/oculta o Rdrive a qualquer momento, mesmo em segundo plano.
                    </span>
                  </span>
                  <kbd className="px-2 py-1 text-[11px] font-mono font-semibold text-[#3c4043] dark:text-[#e8eaed] bg-[#f1f3f4] dark:bg-white/10 rounded-md border border-[#dadce0] dark:border-white/15">
                    Shift+Alt+D
                  </kbd>
                </div>

                <label className="flex items-center justify-between pt-2 border-t border-[#e8eaed] dark:border-white/10 cursor-pointer">
                  <span>
                    <span className="block text-sm text-[#3c4043] dark:text-[#e8eaed]">Velocidade na bandeja</span>
                    <span className="block text-[11px] text-[#9aa0a6] mt-0.5">
                      Mostra download/upload e total transferido ao passar o rato no ícone da bandeja (não existe
                      espaço para isso na barra do sistema em si — apenas apps do próprio painel conseguem escrever lá).
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={showTraySpeed}
                    onChange={(e) => setShowTraySpeed(e.target.checked)}
                    className="rdrive-checkbox w-4 h-4 cursor-pointer shrink-0 ml-3"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end px-6 py-4 bg-[#f8f9fa] dark:bg-[#202124]">
              <button
                onClick={() => setShowSettings(false)}
                className="gdrive-btn px-5 py-2 text-sm font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full shadow-sm transition cursor-pointer"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Prévia Rápida de Arquivo */}
      {explorerPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 animate-fadeIn backdrop-blur-xs" onClick={() => setExplorerPreview(null)} />
          <div className="relative animate-scaleIn bg-white dark:bg-[#1e232d] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col border border-[#e8eaed] dark:border-white/10">
            {/* Cabeçalho da Prévia */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8eaed] dark:border-white/10 bg-[#f8f9fa] dark:bg-[#171b22] shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-[#1a73e8]/10 text-[#1a73e8] dark:text-[#8ab4f8]">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed] truncate">
                    {explorerPreview.name}
                  </h3>
                  <p className="text-[11px] text-[#5f6368] dark:text-[#9aa0a6] truncate">
                    {explorerPreview.path} {explorerPreview.size > 0 && `• ${formatBytes(explorerPreview.size)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleExplorerDownload(explorerPreview.name)}
                  className="gdrive-btn flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full transition cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar</span>
                </button>
                <button
                  onClick={() => setExplorerPreview(null)}
                  className="gdrive-btn p-1.5 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#e8eaed] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Conteúdo da Prévia */}
            <div className="flex-1 overflow-auto p-6 bg-white dark:bg-[#151921] font-mono text-xs text-[#202124] dark:text-[#e8eaed]">
              {explorerPreview.loading ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-[#1a73e8]" />
                  <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6]">Carregando conteúdo da nuvem...</p>
                </div>
              ) : explorerPreview.is_text && explorerPreview.content !== null ? (
                <pre className="whitespace-pre-wrap break-words leading-relaxed select-text font-mono bg-[#f8f9fa] dark:bg-[#0d1117] p-4 rounded-xl border border-[#e8eaed] dark:border-white/10">
                  {explorerPreview.content}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                  <FileIcon className="w-12 h-12 text-[#9aa0a6]" />
                  <div>
                    <p className="text-sm font-semibold text-[#202124] dark:text-[#e8eaed]">
                      Prévia de texto indisponível para este tipo de arquivo
                    </p>
                    <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6] mt-1 max-w-sm">
                      Arquivos binários, vídeos ou mídias complexas podem ser baixados diretamente para a sua pasta Downloads ou abertos através do disco montado.
                    </p>
                  </div>
                  <button
                    onClick={() => handleExplorerDownload(explorerPreview.name)}
                    className="gdrive-btn mt-2 flex items-center space-x-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full transition cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Baixar Arquivo Completo</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Onboarding de primeira execução */}
      {onboardingStep !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 animate-fadeIn" />
          <div className="relative animate-scaleIn bg-white dark:bg-[#2d2e30] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {(() => {
              const steps = [
                {
                  icon: Sparkles,
                  title: "Bem-vindo ao Rdrive",
                  body: "Monte as suas nuvens como se fossem discos locais, com cache inteligente, montagem automática e um explorador completo. Vamos configurar em 3 passos rápidos.",
                },
                {
                  icon: CheckCircle2,
                  title: "1. Verifique o rclone",
                  body: status?.rclone_installed
                    ? "O rclone já está instalado neste computador — tudo pronto para o próximo passo."
                    : "O Rdrive usa o rclone por baixo. Se ainda não estiver instalado, um aviso no topo da tela vai te oferecer instalação com um clique.",
                },
                {
                  icon: Cloud,
                  title: "2. Conecte sua primeira nuvem",
                  body: "Clique em \"Nova Nuvem\" na barra lateral, escolha o provedor (Google Drive, Dropbox, OneDrive...) e autorize pelo navegador. Nenhuma senha passa pelo Rdrive.",
                },
                {
                  icon: HardDrive,
                  title: "3. Monte e explore",
                  body: "Clique em \"Montar\" para usar a nuvem como um disco comum, ou no ícone de pasta para abrir o explorador com busca, cópia, prévia e muito mais.",
                },
              ];
              const step = steps[onboardingStep];
              const Icon = step.icon;
              const isLast = onboardingStep === steps.length - 1;

              return (
                <>
                  <div className="px-7 pt-8 pb-6 text-center">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-[#e8f0fe] dark:bg-[#1a73e8]/20 text-[#1a73e8] dark:text-[#8ab4f8] flex items-center justify-center mb-4">
                      <Icon className="w-7 h-7" />
                    </div>
                    <h2 className="text-lg font-semibold text-[#202124] dark:text-[#e8eaed] mb-2">{step.title}</h2>
                    <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6] leading-relaxed">{step.body}</p>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 pb-5">
                    {steps.map((_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 rounded-full transition-all ${
                          i === onboardingStep ? "w-6 bg-[#1a73e8] dark:bg-[#8ab4f8]" : "w-1.5 bg-[#dadce0] dark:bg-white/20"
                        }`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-between px-6 py-4 bg-[#f8f9fa] dark:bg-[#202124]">
                    <button
                      onClick={finishOnboarding}
                      className="gdrive-btn px-3 py-2 text-xs font-medium text-[#5f6368] dark:text-[#9aa0a6] hover:text-[#202124] dark:hover:text-white transition cursor-pointer"
                    >
                      Pular
                    </button>
                    <div className="flex items-center gap-2">
                      {onboardingStep > 0 && (
                        <button
                          onClick={() => setOnboardingStep((s) => (s ?? 1) - 1)}
                          className="gdrive-btn p-2 text-[#5f6368] dark:text-[#e8eaed] hover:bg-[#f1f3f4] dark:hover:bg-white/10 rounded-full transition cursor-pointer"
                        >
                          <ArrowLeft className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => (isLast ? finishOnboarding() : setOnboardingStep((s) => (s ?? 0) + 1))}
                        className="gdrive-btn flex items-center space-x-1.5 px-5 py-2 text-sm font-medium text-white bg-[#1a73e8] hover:bg-[#1765cc] rounded-full shadow-sm transition cursor-pointer"
                      >
                        <span>{isLast ? "Começar" : "Próximo"}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
