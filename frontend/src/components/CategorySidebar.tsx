"use client";

import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  Sparkles,
  User,
  X,
  Check,
  Info,
  Star,
} from "lucide-react";
import { getCurrentLanguage } from "@/lib/i18n";
import { useSettings } from "@/stores/settings";
import { AuthModal } from "@/components/AuthModal";
import { ProfileModal } from "@/components/ProfileModal";
import { useAuth } from "@/components/AuthProvider";
import { Agent, Category, getCategories } from "@/lib/api";
import { useWorkspace } from "@/stores/workspace";

interface CategorySidebarProps {
  selectedAgents: string[];
  onAgentToggle: (agentId: string) => void;
  onSelectCategory: (categoryId: string, agentIds: string[]) => void;
  onClearAll: () => void;
  onShowAgentDetails?: (agentId: string) => void;
  isConnected?: boolean;
  forceExpanded?: boolean;
}

// Colores por categoría (50 categorías)
const categoryColors: Record<string, string> = {
  software_development: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
  marketing: "from-pink-500/20 to-pink-600/10 border-pink-500/30",
  finance: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30",
  legal: "from-violet-500/20 to-violet-600/10 border-violet-500/30",
  human_resources: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
  sales: "from-red-500/20 to-red-600/10 border-red-500/30",
  operations: "from-gray-500/20 to-gray-600/10 border-gray-500/30",
  education: "from-teal-500/20 to-teal-600/10 border-teal-500/30",
  creative: "from-fuchsia-500/20 to-fuchsia-600/10 border-fuchsia-500/30",
  project_management: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30",
  mercadolibre: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/30",
  youtube: "from-red-600/20 to-red-700/10 border-red-600/30",
  architecture: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
  mathematics: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30",
  science_chemistry: "from-cyan-400/20 to-cyan-500/10 border-cyan-400/30",
  cybersecurity: "from-red-500/20 to-red-600/10 border-red-500/30",
  personal_brand: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
  data_science: "from-violet-500/20 to-violet-600/10 border-violet-500/30",
  health_wellness: "from-green-500/20 to-green-600/10 border-green-500/30",
  ecommerce: "from-orange-500/20 to-orange-600/10 border-orange-500/30",
  automation_rpa: "from-purple-600/20 to-purple-700/10 border-purple-600/30",
  game_development: "from-violet-500/20 to-violet-600/10 border-violet-500/30",
  mobile_apps: "from-sky-500/20 to-sky-600/10 border-sky-500/30",
  blockchain_web3: "from-amber-500/20 to-amber-600/10 border-amber-500/30",
  coaching: "from-pink-500/20 to-pink-600/10 border-pink-500/30",
  streaming_media: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
  entrepreneurship: "from-orange-500/20 to-orange-600/10 border-orange-500/30",
  iot_embedded: "from-teal-500/20 to-teal-600/10 border-teal-500/30",
  real_estate: "from-sky-500/20 to-sky-600/10 border-sky-500/30",
  music_audio: "from-fuchsia-500/20 to-fuchsia-600/10 border-fuchsia-500/30",
  internationalization: "from-blue-600/20 to-blue-700/10 border-blue-600/30",
  writing_editorial: "from-indigo-500/20 to-indigo-600/10 border-indigo-500/30",
  ai_prompt_engineering: "from-violet-600/20 to-violet-700/10 border-violet-600/30",
  consulting: "from-slate-500/20 to-slate-600/10 border-slate-500/30",
  sustainability_esg: "from-green-600/20 to-green-700/10 border-green-600/30",
  professional_writing: "from-teal-600/20 to-teal-700/10 border-teal-600/30",
  video_production: "from-red-600/20 to-red-700/10 border-red-600/30",
  tourism_hospitality: "from-cyan-600/20 to-cyan-700/10 border-cyan-600/30",
  automotive: "from-blue-700/20 to-blue-800/10 border-blue-700/30",
  automation_scripting: "from-emerald-600/20 to-emerald-700/10 border-emerald-600/30",
  manufacturing: "from-stone-500/20 to-stone-600/10 border-stone-500/30",
  gamedev_xr: "from-purple-600/20 to-purple-700/10 border-purple-600/30",
  energy_utilities: "from-yellow-600/20 to-yellow-700/10 border-yellow-600/30",
  qa_testing: "from-red-500/20 to-red-600/10 border-red-500/30",
  supply_chain: "from-amber-600/20 to-amber-700/10 border-amber-600/30",
  ui_ux_design: "from-rose-500/20 to-rose-600/10 border-rose-500/30",
  child_education: "from-pink-400/20 to-pink-500/10 border-pink-400/30",
  civil_engineering: "from-amber-700/20 to-amber-800/10 border-amber-700/30",
  seo_performance: "from-green-600/20 to-green-700/10 border-green-600/30",
  business_intelligence: "from-blue-600/20 to-blue-700/10 border-blue-600/30",
};

export function CategorySidebar({
  selectedAgents,
  onAgentToggle,
  onSelectCategory,
  onClearAll,
  onShowAgentDetails,
  isConnected,
  forceExpanded = false,
}: CategorySidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  // El catálogo de agentes vive en el store (una sola descarga para toda la app)
  const agents = useWorkspace((s) => s.catalog);
  const catalogStatus = useWorkspace((s) => s.catalogStatus);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const isLoading = categoriesLoading || catalogStatus === "idle" || catalogStatus === "loading";
  const [isMobile, setIsMobile] = useState(false);

  const lang = getCurrentLanguage();
  const { user } = useAuth();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Cargar categorías y agentes
  useEffect(() => {
    useWorkspace.getState().loadCatalog();
    getCategories()
      .then((res) => setCategories(res.categories))
      .catch((error) => console.error("Error loading categories:", error))
      .finally(() => setCategoriesLoading(false));
  }, []);

  // Detectar tamaño de pantalla
  useEffect(() => {
    const checkScreenSize = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
      if (width < 768 && !forceExpanded) {
        setIsCollapsed(true);
      } else if (forceExpanded) {
        setIsCollapsed(false);
      }
    };
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, [forceExpanded]);

  // Filtrar agentes por búsqueda
  const filteredAgents = searchTerm
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.specialization.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : agents;

  // Agrupar agentes por categoría
  const agentsByCategory = filteredAgents.reduce((acc, agent) => {
    if (!acc[agent.category]) acc[agent.category] = [];
    acc[agent.category].push(agent);
    return acc;
  }, {} as Record<string, Agent[]>);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((c) => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  // Agentes favoritos (fijados arriba): store persistente
  const favorites = useSettings((s) => s.favorites);
  const toggleFavorite = useSettings((s) => s.toggleFavorite);
  const favoriteAgents = favorites.map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);

  const renderAgentRow = (agent: Agent) => {
    const isSelected = selectedAgents.includes(agent.id);
    const isFavorite = favorites.includes(agent.id);
    return (
      <div
        key={agent.id}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onAgentToggle(agent.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onAgentToggle(agent.id);
          }
        }}
        className={cn(
          "group w-full p-2 rounded-lg flex items-center gap-2 transition-all text-left cursor-pointer",
          isSelected ? "bg-primary/20 border border-primary/40" : "hover:bg-white/5 border border-transparent"
        )}
      >
        <span className="text-sm">{agent.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className={cn("text-xs font-semibold truncate", isSelected && "text-primary")}>{agent.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">{agent.specialization}</p>
        </div>
        <button
          type="button"
          title={isFavorite ? (lang === "es" ? "Quitar de favoritos" : "Unpin") : (lang === "es" ? "Fijar en favoritos" : "Pin to favorites")}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(agent.id);
          }}
          className={cn(
            "p-1 rounded hover:bg-primary/10",
            isFavorite ? "text-amber-400" : "opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-amber-400"
          )}
        >
          <Star className={cn("h-3 w-3", isFavorite && "fill-current")} />
        </button>
        {onShowAgentDetails && (
          <button
            type="button"
            title={lang === "es" ? "Ver detalle e instrucciones" : "Details & instructions"}
            onClick={(e) => {
              e.stopPropagation();
              onShowAgentDetails(agent.id);
            }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <Info className="h-3 w-3" />
          </button>
        )}
        {isSelected && <Check className="h-3 w-3 text-primary flex-shrink-0" />}
      </div>
    );
  };

  const selectAllInCategory = (categoryId: string) => {
    onSelectCategory(categoryId, agents.filter((a) => a.category === categoryId).map((a) => a.id));
  };

  // Vista colapsada
  if (isCollapsed) {
    return (
      <div
        className={cn(
          "h-full bg-card/50 backdrop-blur-sm border-r border-primary/20 flex flex-col items-center py-4 gap-4",
          isMobile ? "w-14" : "w-16"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(false)}
          className="text-primary"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
        <div className="flex flex-col gap-2 items-center">
          <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Sparkles className="text-primary h-4 w-4" />
          </div>
          <Badge variant="outline" className="text-xs">
            {selectedAgents.length}
          </Badge>
        </div>
        <div className="mt-auto pb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              user ? setIsProfileModalOpen(true) : setIsAuthModalOpen(true)
            }
            className="rounded-full overflow-hidden h-8 w-8 border border-primary/20"
          >
            {user ? (
              <div className="h-full w-full bg-primary/20 flex items-center justify-center font-bold text-xs text-primary">
                {user.username?.[0]?.toUpperCase() || "U"}
              </div>
            ) : (
              <User className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          onLoginSuccess={() => console.log('Login successful')}
        />
        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-full bg-gradient-to-b from-card/80 to-card/50 backdrop-blur-md border-r border-primary/30 flex flex-col shadow-2xl overflow-hidden",
        // En móvil, expandida se superpone al chat (se cierra con la flecha)
        isMobile ? "fixed inset-y-0 left-0 z-40 w-[85vw] max-w-80" : "w-80"
      )}
    >
      {/* Header */}
      <div className="p-4 border-b border-primary/30 bg-gradient-to-r from-primary/10 to-transparent">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shadow-lg">
              <Sparkles className="text-primary h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black text-base text-primary uppercase tracking-tight flex items-center gap-2">
                Nexo Agents
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    isConnected
                      ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                      : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                  )}
                />
              </h2>
              <p className="text-[10px] text-muted-foreground font-bold tracking-wider">
                {agents.length} {lang === "es" ? "AGENTES" : "AGENTS"} • {categories.length}{" "}
                {lang === "es" ? "CATEGORÍAS" : "CATEGORIES"}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCollapsed(true)}
            className="text-primary hover:bg-primary/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <Badge
            variant="outline"
            className="font-black text-[10px] px-3 py-1 bg-primary/10 border-primary/30"
          >
            {selectedAgents.length}{" "}
            {lang === "es" ? "SELECCIONADOS" : "SELECTED"}
          </Badge>
          {selectedAgents.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="text-[10px] h-6 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3 mr-1" />
              {lang === "es" ? "Limpiar" : "Clear"}
            </Button>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              lang === "es" ? "Buscar agentes..." : "Search agents..."
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 bg-background/50 border-primary/20 focus:border-primary/50 text-sm"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => setSearchTerm("")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Categories List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
            {favoriteAgents.length > 0 && !searchTerm && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 space-y-1">
                <div className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  <Star className="h-3 w-3 fill-current" />{lang === "es" ? "Favoritos" : "Favorites"}
                </div>
                {favoriteAgents.map(renderAgentRow)}
              </div>
            )}
            {searchTerm && filteredAgents.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {lang === "es" ? "Ningún agente coincide con la búsqueda." : "No agents match your search."}
              </p>
            )}
            {categories.map((category) => {
              const categoryAgents = agentsByCategory[category.id] || [];
              // Al buscar: solo categorías con resultados, y abiertas para ver los agentes
              if (searchTerm && categoryAgents.length === 0) return null;
              const selectedInCategory = categoryAgents.filter((a) =>
                selectedAgents.includes(a.id)
              ).length;
              const isExpanded = !!searchTerm || expandedCategories.includes(category.id);
              const colorClass =
                categoryColors[category.id] || categoryColors.software_development;

              return (
                <Collapsible
                  key={category.id}
                  open={isExpanded}
                  onOpenChange={() => toggleCategory(category.id)}
                >
                  <div
                    className={cn(
                      "rounded-xl border bg-gradient-to-r transition-all duration-200",
                      colorClass,
                      isExpanded && "shadow-lg"
                    )}
                  >
                    <CollapsibleTrigger asChild>
                      <button className="w-full p-3 flex items-center justify-between hover:bg-white/5 rounded-t-xl transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{category.emoji}</span>
                          <div className="text-left">
                            <p className="font-bold text-sm">{category.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {categoryAgents.length} agentes
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedInCategory > 0 && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] bg-primary/20"
                            >
                              {selectedInCategory}
                            </Badge>
                          )}
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform duration-200",
                              isExpanded && "rotate-180"
                            )}
                          />
                        </div>
                      </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="px-2 pb-2 space-y-1">
                        {/* Select all button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start text-xs h-7 text-muted-foreground hover:text-primary"
                          onClick={() => selectAllInCategory(category.id)}
                        >
                          <Check className="h-3 w-3 mr-2" />
                          {lang === "es"
                            ? "Seleccionar todos"
                            : "Select all"}
                        </Button>

                        {/* Agents list */}
                        {categoryAgents.map(renderAgentRow)}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-primary/20 bg-card/50">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={() =>
            user ? setIsProfileModalOpen(true) : setIsAuthModalOpen(true)
          }
        >
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
            {user ? (
              <span className="font-bold text-xs text-primary">
                {user.username?.[0]?.toUpperCase() || "U"}
              </span>
            ) : (
              <User className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div className="text-left">
            <p className="text-xs font-semibold">
              {user?.username || (lang === "es" ? "Iniciar sesión" : "Sign in")}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {user
                ? lang === "es"
                  ? "Ver perfil"
                  : "View profile"
                : lang === "es"
                ? "Acceder a tu cuenta"
                : "Access your account"}
            </p>
          </div>
        </Button>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={() => console.log('Login successful')}
      />
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
    </div>
  );
}
