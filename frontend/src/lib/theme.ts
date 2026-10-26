/**
 * Temas visuales: fuente única de verdad.
 *
 * Cada tema define sus variables en styles/themes.css ([data-theme="id"]). Además se marca
 * si es claro u oscuro: los componentes usan variantes `dark:` de Tailwind (darkMode "class")
 * y los controles nativos (scrollbars, inputs) necesitan `color-scheme`.
 */

export type ThemeId =
  | "executive"
  | "blueprint"
  | "iron-man"
  | "kawai"
  | "cyborg"
  | "matrix"
  | "gamer-rgb"
  | "corporativo-vip"
  | "criminologia"
  | "blanco-simple";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  scheme: "dark" | "light";
}

export const THEMES: ThemeInfo[] = [
  { id: "executive", name: "Executive", description: "Dorado sobre negro (predeterminado)", scheme: "dark" },
  { id: "corporativo-vip", name: "Corporativo VIP", description: "Azul ejecutivo", scheme: "dark" },
  { id: "blueprint", name: "Blueprint", description: "Plano técnico azul", scheme: "dark" },
  { id: "iron-man", name: "Iron Man", description: "Rojo y dorado", scheme: "dark" },
  { id: "cyborg", name: "Cyborg", description: "Cian neón", scheme: "dark" },
  { id: "matrix", name: "Matrix", description: "Terminal verde", scheme: "dark" },
  { id: "gamer-rgb", name: "Gamer RGB", description: "Neón multicolor", scheme: "dark" },
  { id: "blanco-simple", name: "Blanco simple", description: "Minimalista claro", scheme: "light" },
  { id: "criminologia", name: "Criminología", description: "Papel y sepia", scheme: "light" },
  { id: "kawai", name: "Kawai", description: "Rosa pastel", scheme: "light" },
];

export const DEFAULT_THEME: ThemeId = "executive";
export const THEME_STORAGE_KEY = "nexo-theme";

export const themeInfo = (id: string | null | undefined): ThemeInfo =>
  THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME)!;

export function applyTheme(id: ThemeId): void {
  const { scheme } = themeInfo(id);
  const root = document.documentElement;
  root.setAttribute("data-theme", id);
  root.classList.toggle("dark", scheme === "dark");
  root.style.colorScheme = scheme;
}

export function savedTheme(): ThemeId {
  try {
    return themeInfo(localStorage.getItem(THEME_STORAGE_KEY)).id;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* sin almacenamiento: el tema dura hasta recargar */
  }
}

/**
 * Script en línea para el <head>: aplica el tema guardado antes del primer pintado
 * (sin esto se veía el tema predeterminado hasta abrir Ajustes → Interfaz).
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=${JSON.stringify(
  Object.fromEntries(THEMES.map((t) => [t.id, t.scheme])),
)};var id=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(!t[id])id=${JSON.stringify(
  DEFAULT_THEME,
)};var r=document.documentElement;r.setAttribute("data-theme",id);r.classList.toggle("dark",t[id]==="dark");r.style.colorScheme=t[id];}catch(e){}})();`;
