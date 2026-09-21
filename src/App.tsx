import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
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
} from "lucide-react";
import "./App.css";

const appWindow = getCurrentWindow();

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

  const [showSettings, setShowSettings] = useState(false);
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

  const fetchStatusAndRemotes = async () => {
    setLoading(true);
    try {
      const sysStatus = await invoke<SystemStatus>("check_system_environment");
      setStatus(sysStatus);

      if (sysStatus.rclone_installed) {
        const remoteList = await invoke<RemoteDrive[]>("list_remotes");
        setRemotes(remoteList);
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

  const handleMount = async (remoteName: string) => {
    setActionLoading(remoteName);
    setMessage(null);
    try {
      const res = await invoke<string>("mount_remote", { remote: remoteName });
      setMessage({ type: "success", text: res });
      await fetchStatusAndRemotes();
    } catch (err: any) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setActionLoading(null);
    }
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
        {/* Sidebar */}
        <aside className="w-64 bg-[#f8f9fa] dark:bg-[#202124] px-3 py-4 shrink-0 flex flex-col space-y-1 overflow-y-auto transition-colors duration-300">
          <button
            onClick={openAddModal}
            className="gdrive-btn flex items-center space-x-3 px-5 py-3.5 mb-4 bg-white dark:bg-[#2d2e30] hover:shadow-md rounded-2xl shadow-[0_1px_3px_0_rgba(60,64,67,0.3)] text-sm font-medium text-[#3c4043] dark:text-[#e8eaed] transition cursor-pointer w-fit"
          >
            <Plus className="w-5 h-5 text-[#1a73e8] dark:text-[#8ab4f8]" />
            <span>Nova Nuvem</span>
          </button>

          <div className="px-3 py-2 flex items-center space-x-3 rounded-r-full bg-[#e8f0fe] dark:bg-[#3c4142] text-[#1a73e8] dark:text-[#8ab4f8] text-sm font-medium">
            <Cloud className="w-4.5 h-4.5" />
            <span>Meu Drive</span>
          </div>

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
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto px-8 py-6">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {remotes.map((remote, idx) => {
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
                className="gdrive-btn p-1.5 text-[#5f6368] hover:bg-[#f1f3f4] rounded-full transition cursor-pointer"
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
                          ? "border-[#1a73e8] bg-[#e8f0fe] text-[#1a73e8]"
                          : "border-[#e8eaed] text-[#3c4043] hover:bg-[#f8f9fa]"
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
                  className="w-full px-3.5 py-2.5 text-sm border border-[#dadce0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/40 focus:border-[#1a73e8] transition disabled:opacity-50"
                />
              </div>

              {authorizing && (
                <div className="animate-fadeIn flex items-center space-x-3 p-3.5 bg-[#e8f0fe] rounded-xl text-[#1a73e8] text-xs">
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                  <div>
                    <p className="font-medium flex items-center space-x-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Aguardando autorização...</span>
                    </p>
                    <p className="text-[#1a73e8]/80 mt-0.5">
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
                className="gdrive-btn px-4 py-2 text-sm font-medium text-[#3c4043] hover:bg-[#f1f3f4] rounded-full transition cursor-pointer disabled:opacity-50"
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
    </div>
  );
}
