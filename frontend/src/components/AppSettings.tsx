"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { SecureStorage } from "@/lib/encryption";
import { ThemeSelector } from "./ThemeSelector";
import { LanguageSelector } from "./LanguageSelector";
import { WebSearchSettings } from "./WebSearchSettings";
import { DocumentSettings } from "./DocumentSettings";
import { CostSettings } from "./CostSettings";
import {
    Key,
    Check,
    X,
    Eye,
    EyeOff,
    Settings,
    Zap,
    AlertCircle,
    ChevronDown,
    Save,
    Loader2,
    RefreshCw,
    Shield,
    Lock,
    Palette,
    Languages,
    Monitor,
    Info,
    BookOpen,
    ExternalLink,
    Globe,
    FileText,
    DollarSign
} from "lucide-react";

export interface ApiProvider {
    id: string;
    name: string;
    type: "groq" | "openai" | "anthropic" | "google" | "local" | "custom";
    apiKey: string;
    baseUrl?: string;
    models: string[];
    enabledModels?: string[];
    isActive: boolean;
}

const DEFAULT_PROVIDERS: Omit<ApiProvider, "apiKey" | "isActive">[] = [
    {
        id: "groq",
        name: "Groq",
        type: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        models: [],
    },
    {
        id: "openai",
        name: "OpenAI",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        models: [],
    },
    {
        id: "anthropic",
        name: "Anthropic",
        type: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        models: [],
    },
    {
        id: "google",
        name: "Google AI",
        type: "google",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        models: [],
    },
    {
        id: "local",
        name: "Local (Ollama/LM Studio)",
        type: "local",
        baseUrl: "http://localhost:11434/v1",
        models: [],
    },
];

interface AppSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    onProvidersChange: (providers: ApiProvider[]) => void;
}

export function AppSettings({ isOpen, onClose, onProvidersChange }: AppSettingsProps) {
    const [activeTab, setActiveTab] = useState<"apis" | "web" | "docs" | "costs" | "interface" | "guide" | "about">("apis");
    const [providers, setProviders] = useState<ApiProvider[]>([]);
    const [originalProviders, setOriginalProviders] = useState<ApiProvider[]>([]);
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
    const [showAddCustom, setShowAddCustom] = useState(false);
    const [loadingModels, setLoadingModels] = useState<string | null>(null);
    const [modelError, setModelError] = useState<string | null>(null);
    const [saveToStorage, setSaveToStorage] = useState(true);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        const loadSavedProviders = async () => {
            try {
                const saved = await SecureStorage.getItem("api-providers");
                if (saved) {
                    setProviders(saved);
                    setOriginalProviders(saved);
                    onProvidersChange(saved);
                }
            } catch (e) {
                console.error("Error loading providers:", e);
            }
        };

        const savePreference = localStorage.getItem("nexo-save-apis");
        // Por defecto se recuerdan (cifrados); solo se olvidan si el usuario lo desactivó
        setSaveToStorage(savePreference !== "false");
        loadSavedProviders();
    }, [onProvidersChange]); // estable (acción del store): corre una sola vez

    const saveProviders = (newProviders: ApiProvider[]) => {
        setProviders(newProviders);
        const changes = JSON.stringify(newProviders) !== JSON.stringify(originalProviders);
        setHasChanges(changes);
    };

    const applyChanges = async () => {
        if (saveToStorage) {
            try {
                await SecureStorage.setItem("api-providers", providers);
            } catch (e) {
                // Nunca en texto plano: si no se puede cifrar, no se guarda
                console.error("No se pudieron guardar los proveedores:", e);
            }
        } else {
            SecureStorage.removeItem("api-providers");
        }
        setOriginalProviders(providers);
        onProvidersChange(providers);
        setHasChanges(false);
        if (activeTab === "apis") onClose();
    };

    const RECOMMENDED_MODELS: Record<string, string[]> = {
        groq: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
        openai: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
        anthropic: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
        google: ["gemini-1.5-pro", "gemini-1.5-flash"],
    };

    const handleAddProvider = (defaultProvider: any) => {
        if (providers.some(p => p.id === defaultProvider.id)) {
            setExpandedProvider(defaultProvider.id);
            return;
        }
        const newProvider: ApiProvider = {
            ...defaultProvider,
            apiKey: "",
            isActive: false,
            enabledModels: [] // Initialize empty
        };
        saveProviders([...providers, newProvider]);
        setExpandedProvider(defaultProvider.id);
    };

    const handleUpdateProvider = (id: string, updates: Partial<ApiProvider>) => {
        const newProviders = providers.map(p => p.id === id ? { ...p, ...updates } : p);
        saveProviders(newProviders);
    };

    const toggleModel = (providerId: string, modelId: string) => {
        const provider = providers.find(p => p.id === providerId);
        if (!provider) return;

        const currentEnabled = provider.enabledModels || provider.models; // If undefined, assume all were enabled
        const isEnabled = currentEnabled.includes(modelId);

        let newEnabled;
        if (isEnabled) {
            newEnabled = currentEnabled.filter(m => m !== modelId);
        } else {
            newEnabled = [...currentEnabled, modelId];
        }

        handleUpdateProvider(providerId, { enabledModels: newEnabled });
    };

    const fetchModelsForProvider = async (providerId: string) => {
        const provider = providers.find(p => p.id === providerId);
        if (!provider) return;

        // For local providers, API key is optional
        if (provider.type !== "local" && !provider.apiKey) {
            setModelError("Ingresa una API Key primero");
            return;
        }

        setLoadingModels(providerId);
        setModelError(null);

        try {
            const response = await fetch("/api/fetch-models", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_type: provider.type,
                    api_key: provider.apiKey,
                    base_url: provider.baseUrl || null
                }),
            });
            const data = await response.json();

            if (data.success && data.models.length > 0) {
                const modelIds = data.models.map((m: any) => m.id);
                handleUpdateProvider(providerId, {
                    models: modelIds,
                    enabledModels: modelIds, // Enable all fetched models by default
                    isActive: true
                });
                setModelError(null);
            } else if (data.error) {
                setModelError(data.error);
            } else {
                setModelError("No se encontraron modelos disponibles");
            }
        } catch (err: any) {
            console.error("Error fetching models:", err);
            setModelError(err.message || "Error al conectar con el proveedor");
        } finally {
            setLoadingModels(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />

            <div className="relative w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                            <Settings className="h-6 w-6 animate-spin-slow" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-foreground">Ajustes de NexoMente</h2>
                            <p className="text-sm text-muted-foreground">Configura tu experiencia Equipos de agentes IA</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                        <X className="h-6 w-6 text-muted-foreground" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex flex-wrap border-b border-border bg-muted/10 px-2 [&>button]:whitespace-nowrap">
                    <TabButton active={activeTab === "apis"} onClick={() => setActiveTab("apis")} icon={<Key size={18} />} label="APIs & Modelos" />
                    <TabButton active={activeTab === "web"} onClick={() => setActiveTab("web")} icon={<Globe size={18} />} label="Búsqueda web" />
                    <TabButton active={activeTab === "docs"} onClick={() => setActiveTab("docs")} icon={<FileText size={18} />} label="Documentos" />
                    <TabButton active={activeTab === "costs"} onClick={() => setActiveTab("costs")} icon={<DollarSign size={18} />} label="Costos" />
                    <TabButton active={activeTab === "interface"} onClick={() => setActiveTab("interface")} icon={<Monitor size={18} />} label="Interfaz" />
                    <TabButton active={activeTab === "guide"} onClick={() => setActiveTab("guide")} icon={<BookOpen size={18} />} label="Cómo Usar" />
                    <TabButton active={activeTab === "about"} onClick={() => setActiveTab("about")} icon={<Info size={18} />} label="Información" />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {activeTab === "apis" && (
                        <div className="space-y-6">
                            <section>
                                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Proveedores de Inteligencia</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {DEFAULT_PROVIDERS.map(p => (
                                        <button key={p.id} onClick={() => handleAddProvider(p)} className={cn(
                                            "flex items-center justify-between p-4 rounded-xl border transition-all text-left group",
                                            providers.some(pr => pr.id === p.id) ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/50 hover:bg-muted/50"
                                        )}>
                                            <div className="flex items-center gap-3">
                                                <Zap size={20} className={providers.some(pr => pr.id === p.id) ? "text-primary" : "text-muted-foreground"} />
                                                <span className="font-medium">{p.name}</span>
                                            </div>
                                            <ChevronDown size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {providers.length > 0 && (
                                <section className="space-y-3">
                                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Mis Conexiones</h3>
                                    {providers.map(provider => (
                                        <div key={provider.id} className="border border-border rounded-xl overflow-hidden bg-muted/20">
                                            <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedProvider(expandedProvider === provider.id ? null : provider.id)}>
                                                <div className="flex items-center gap-3">
                                                    <div className={cn("w-2.5 h-2.5 rounded-full shadow-[0_0_8px]", provider.isActive && (provider.apiKey || provider.type === "local") ? "bg-green-500 shadow-green-500/50" : "bg-muted-foreground")} />
                                                    <span className="font-semibold">{provider.name}</span>
                                                </div>
                                                <ChevronDown className={cn("transition-transform duration-300", expandedProvider === provider.id && "rotate-180")} />
                                            </div>

                                            {expandedProvider === provider.id && (
                                                <div className="p-4 bg-background border-t border-border space-y-4 animate-in fade-in slide-in-from-top-2">
                                                    {/* API Key Input - Hide for local providers that don't need it */}
                                                    {provider.type !== "local" && (
                                                        <div>
                                                            <label className="text-xs font-bold text-muted-foreground uppercase mb-1.5 block">API Key</label>
                                                            <div className="relative">
                                                                <input
                                                                    type={showKeys[provider.id] ? "text" : "password"}
                                                                    value={provider.apiKey}
                                                                    onChange={(e) => handleUpdateProvider(provider.id, { apiKey: e.target.value, isActive: e.target.value.length > 0 })}
                                                                    className="w-full bg-muted/30 border border-border rounded-lg px-4 py-2.5 pr-12 focus:ring-2 focus:ring-primary/40 outline-none"
                                                                    placeholder={`Enter ${provider.name} key...`}
                                                                />
                                                                <button onClick={() => setShowKeys({ ...showKeys, [provider.id]: !showKeys[provider.id] })} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                                                                    {showKeys[provider.id] ? <EyeOff size={18} /> : <Eye size={18} />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Base URL for local/custom providers */}
                                                    {(provider.type === "local" || provider.type === "custom") && (
                                                        <div>
                                                            <label className="text-xs font-bold text-muted-foreground uppercase mb-1.5 block">URL del Servidor</label>
                                                            <input
                                                                type="text"
                                                                value={provider.baseUrl || ""}
                                                                onChange={(e) => handleUpdateProvider(provider.id, { baseUrl: e.target.value })}
                                                                className="w-full bg-muted/30 border border-border rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary/40 outline-none"
                                                                placeholder={provider.type === "local" ? "http://localhost:11434" : "https://api.example.com/v1"}
                                                            />
                                                        </div>
                                                    )}

                                                    {/* Sync Models Button */}
                                                    <button
                                                        onClick={() => fetchModelsForProvider(provider.id)}
                                                        disabled={(provider.type !== "local" && !provider.apiKey) || loadingModels === provider.id}
                                                        className="w-full bg-primary/10 text-primary border border-primary/20 py-2.5 rounded-lg font-medium hover:bg-primary/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {loadingModels === provider.id ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                                                        Sincronizar Modelos
                                                    </button>

                                                    {/* Error Message */}
                                                    {modelError && expandedProvider === provider.id && (
                                                        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                                                            <AlertCircle size={16} />
                                                            {modelError}
                                                        </div>
                                                    )}

                                                    {/* Models List */}
                                                    {provider.models.length > 0 && (
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <label className="text-xs font-bold text-muted-foreground uppercase">
                                                                    Modelos Disponibles
                                                                </label>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] text-primary font-mono">
                                                                        {(provider.enabledModels || provider.models).length}/{provider.models.length} activos
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleUpdateProvider(provider.id, { enabledModels: provider.models })}
                                                                        className="text-[10px] text-primary hover:underline"
                                                                    >
                                                                        Todos
                                                                    </button>
                                                                    <span className="text-muted-foreground">|</span>
                                                                    <button
                                                                        onClick={() => handleUpdateProvider(provider.id, { enabledModels: [] })}
                                                                        className="text-[10px] text-muted-foreground hover:underline"
                                                                    >
                                                                        Ninguno
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div className="max-h-48 overflow-y-auto space-y-1 p-2 bg-muted/20 rounded-lg border border-border custom-scrollbar">
                                                                {provider.models.map((model) => {
                                                                    const isEnabled = (provider.enabledModels || provider.models).includes(model);
                                                                    const isRecommended = RECOMMENDED_MODELS[provider.type]?.includes(model);

                                                                    return (
                                                                        <button
                                                                            key={model}
                                                                            onClick={() => toggleModel(provider.id, model)}
                                                                            className={cn(
                                                                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all text-left group",
                                                                                isEnabled
                                                                                    ? "bg-primary/10 hover:bg-primary/20 border border-primary/20"
                                                                                    : "hover:bg-muted/50 border border-transparent"
                                                                            )}
                                                                        >
                                                                            {/* Checkbox */}
                                                                            <div className={cn(
                                                                                "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all",
                                                                                isEnabled
                                                                                    ? "bg-primary border-primary"
                                                                                    : "border-muted-foreground/30 group-hover:border-primary/50"
                                                                            )}>
                                                                                {isEnabled && <Check size={12} className="text-primary-foreground" />}
                                                                            </div>

                                                                            {/* Model Name */}
                                                                            <span className={cn(
                                                                                "flex-1 truncate text-xs font-mono transition-colors",
                                                                                isEnabled ? "text-foreground font-medium" : "text-muted-foreground"
                                                                            )}>
                                                                                {model}
                                                                            </span>

                                                                            {/* Recommended Badge */}
                                                                            {isRecommended && (
                                                                                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-primary/20 text-primary border border-primary/30 shrink-0">
                                                                                    ⚡ FREE
                                                                                </span>
                                                                            )}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="flex justify-end">
                                                        <button onClick={() => saveProviders(providers.filter(p => p.id !== provider.id))} className="text-xs text-destructive hover:font-bold transition-all px-2 py-1">Desconectar Proveedor</button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </section>
                            )}
                        </div>
                    )}

                    {activeTab === "web" && <WebSearchSettings />}

                    {activeTab === "docs" && <DocumentSettings providers={providers} />}

                    {activeTab === "costs" && <CostSettings providers={providers} />}

                    {activeTab === "interface" && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
                            <section>
                                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                                    <Palette size={18} className="text-primary" /> Apariencia Visual
                                </h3>
                                <div className="p-4 bg-muted/20 border border-border rounded-2xl">
                                    <ThemeSelector />
                                </div>
                            </section>

                            <section>
                                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                                    <Languages size={18} className="text-primary" /> Idioma del Sistema
                                </h3>
                                <div className="p-4 bg-muted/20 border border-border rounded-2xl">
                                    <LanguageSelector />
                                </div>
                            </section>

                            <section>
                                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                                    <Shield size={18} className="text-primary" /> Privacidad
                                </h3>
                                <div className="flex items-center justify-between p-4 bg-muted/20 border border-border rounded-2xl">
                                    <span className="text-sm font-medium">
                                        Recordar proveedores y API keys en este navegador
                                        <span className="block text-xs text-muted-foreground font-normal">Se guardan cifrados. Si lo desactivas, se borran al guardar y tendrás que cargarlos en cada visita.</span>
                                    </span>
                                    <button
                                        onClick={() => { setSaveToStorage(!saveToStorage); localStorage.setItem("nexo-save-apis", String(!saveToStorage)); }}
                                        className={cn("w-12 h-6 rounded-full transition-all relative", saveToStorage ? "bg-primary" : "bg-muted-foreground/30")}
                                    >
                                        <div className={cn("absolute top-1 w-4 h-4 bg-white rounded-full transition-all", saveToStorage ? "right-1" : "left-1")} />
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === "guide" && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2">
                            <GuideStep n={1} title="Conecta un modelo de IA">
                                <p className="mb-3">Nexo usa <strong>tu propio</strong> proveedor: elige uno en <strong>APIs &amp; Modelos</strong>, pulsa <strong>Sincronizar Modelos</strong> y luego <strong>Guardar Configuración</strong>.</p>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div className="rounded-xl border border-border bg-background/60 p-3">
                                        <div className="font-semibold text-foreground mb-1">🖥️ Local y gratis (Ollama)</div>
                                        <ol className="list-decimal pl-4 space-y-1">
                                            <li>Instala <a className="text-primary hover:underline" href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Ollama</a>.</li>
                                            <li>Descarga un modelo que entre en tu GPU, p. ej. <code className="text-primary">ollama pull qwen3.5:9b</code>.</li>
                                            <li>Elige <strong>Local (Ollama/LM Studio)</strong> y sincroniza.</li>
                                        </ol>
                                        <p className="mt-2 text-xs">Privado: nada sale de tu PC (salvo la búsqueda web, si la activas).</p>
                                    </div>
                                    <div className="rounded-xl border border-border bg-background/60 p-3">
                                        <div className="font-semibold text-foreground mb-1">☁️ En la nube (con API key)</div>
                                        <ul className="space-y-1">
                                            {CLOUD_KEYS.map((c) => (
                                                <li key={c.name}><a className="text-primary hover:underline inline-flex items-center gap-1" href={c.url} target="_blank" rel="noopener noreferrer">{c.name}<ExternalLink size={11} /></a> <span className="text-xs">— {c.note}</span></li>
                                            ))}
                                        </ul>
                                        <p className="mt-2 text-xs">Pega la key en el proveedor. Se guarda cifrada en este navegador.</p>
                                    </div>
                                </div>
                            </GuideStep>

                            <GuideStep n={2} title="Elige el modelo y los agentes">
                                <ul className="space-y-1.5">
                                    <li>El <strong>selector de modelo</strong> está arriba, en el centro; Nexo recuerda tu elección.</li>
                                    <li>Busca agentes en la barra izquierda, abre una <strong>categoría</strong> o usa una <strong>tarea predefinida</strong>.</li>
                                    <li>¿No sabes cuáles? Describe la tarea y pulsa <strong>🪄 Sugerir</strong> junto al cuadro de texto.</li>
                                    <li>Con 2 a 4 agentes suele bastar; más agentes = más tiempo y tokens.</li>
                                </ul>
                            </GuideStep>

                            <GuideStep n={3} title="Ajusta cómo trabajan (botón ⚙ del chat)">
                                <ul className="space-y-1.5">
                                    <li><strong>Modo:</strong> paralelo (rápido) o secuencial (cada agente lee a los anteriores).</li>
                                    <li><strong>Razonamiento del modelo:</strong> <em>Apagado</em> es mucho más rápido en modelos locales; <em>Alto</em> para problemas difíciles.</li>
                                    <li><strong>Revisión crítica:</strong> un revisor busca errores antes de la respuesta integrada.</li>
                                    <li><strong>Respuesta integrada</strong> y <strong>seguimientos</strong> sugeridos al final.</li>
                                </ul>
                            </GuideStep>

                            <GuideStep n={4} title="Más funciones">
                                <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                                    <li>📎 Adjunta PDF, DOCX, imágenes… y los agentes los citan [D1].</li>
                                    <li>🌐 Búsqueda web con fuentes [W1] (configúrala en su pestaña).</li>
                                    <li>🧮 Calculadora de costos de Mercado Libre con agentes ML.</li>
                                    <li>🌿 Edita una pregunta para crear una rama y compara versiones.</li>
                                    <li>📤 Exporta a Markdown o comparte un link de solo lectura.</li>
                                    <li>⌨️ <kbd className="px-1 rounded border border-border">Ctrl</kbd>+<kbd className="px-1 rounded border border-border">K</kbd> abre la paleta de comandos.</li>
                                </ul>
                            </GuideStep>
                        </div>
                    )}

                    {activeTab === "about" && (
                        <div className="space-y-6 text-center py-8 animate-in zoom-in-95 duration-300">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/favicon.svg" alt="" className="w-24 h-24 rounded-3xl mx-auto mb-4 shadow-xl shadow-primary/30" />
                            <h2 className="text-3xl font-black bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                                Nexo
                            </h2>
                            <p className="text-muted-foreground max-w-md mx-auto">
                                Equipos de <strong>500 agentes de IA</strong> en 50 categorías que trabajan en paralelo,
                                leen tus documentos, buscan en la web y entregan una respuesta integrada con fuentes citadas.
                            </p>
                            <div className="pt-6 grid grid-cols-3 gap-3 max-w-sm mx-auto text-xs font-mono">
                                <div className="p-3 border border-blue-500/30 rounded-xl bg-blue-500/5 text-blue-500">
                                    <div className="text-2xl font-black">500</div>
                                    <div className="text-[10px]">AGENTES</div>
                                </div>
                                <div className="p-3 border border-purple-500/30 rounded-xl bg-purple-500/5 text-purple-500">
                                    <div className="text-2xl font-black">50</div>
                                    <div className="text-[10px]">CATEGORÍAS</div>
                                </div>
                                <div className="p-3 border border-pink-500/30 rounded-xl bg-pink-500/5 text-pink-500">
                                    <div className="text-2xl font-black">100</div>
                                    <div className="text-[10px]">TAREAS</div>
                                </div>
                            </div>
                            <div className="pt-4 text-xs text-muted-foreground">
                                <p>Versión {process.env.NEXT_PUBLIC_VERSION || "1.0.0"} • Open source (MIT)</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border bg-muted/30 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Lock size={12} className="text-primary" /> {saveToStorage ? "Se guardan cifrados en este navegador" : "No se guardan: se pierden al recargar"}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-5 py-2 rounded-xl text-sm font-semibold hover:bg-muted transition-colors">Cerrar</button>
                        {hasChanges && (
                            <button
                                onClick={applyChanges}
                                className="bg-primary text-primary-foreground px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                            >
                                <Save size={18} /> Guardar Configuración
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const CLOUD_KEYS = [
    { name: "Groq", url: "https://console.groq.com/keys", note: "muy rápido, con plan gratuito" },
    { name: "OpenAI", url: "https://platform.openai.com/api-keys", note: "modelos GPT" },
    { name: "Anthropic", url: "https://console.anthropic.com/settings/keys", note: "modelos Claude" },
    { name: "Google AI", url: "https://aistudio.google.com/apikey", note: "modelos Gemini" },
];

function GuideStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-border bg-card/60 p-5">
            <h3 className="flex items-center gap-3 text-base font-bold text-foreground mb-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">{n}</span>
                {title}
            </h3>
            <div className="text-sm text-muted-foreground">{children}</div>
        </section>
    );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: any, label: string }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-2 px-4 py-3.5 text-sm font-bold transition-all relative border-b-2",
                active ? "text-primary border-primary bg-primary/5" : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/30"
            )}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}
