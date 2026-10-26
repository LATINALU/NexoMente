import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, applyTheme, savedTheme, themeInfo } from "./theme";

class FakeRoot {
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  style: Record<string, string> = {};
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  classList = {
    toggle: (c: string, on: boolean) => (on ? this.classes.add(c) : this.classes.delete(c)),
    contains: (c: string) => this.classes.has(c),
  };
}

let root: FakeRoot;
const store = new Map<string, string>();

beforeEach(() => {
  root = new FakeRoot();
  store.clear();
  (globalThis as any).document = { documentElement: root };
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
});

describe("temas", () => {
  it("cada tema del CSS tiene esquema claro/oscuro y nombres únicos", () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(THEMES.every((t) => t.scheme === "dark" || t.scheme === "light")).toBe(true);
  });

  it("la lista coincide con los temas definidos en styles/themes.css", () => {
    const css = readFileSync(join(__dirname, "..", "styles", "themes.css"), "utf8");
    const inCss = Array.from(css.matchAll(/\[data-theme="([\w-]+)"\]/g), (m) => m[1]).sort();
    expect(inCss).toEqual(THEMES.map((t) => t.id).sort());
  });

  it("applyTheme marca data-theme, la clase dark y color-scheme", () => {
    applyTheme("kawai");
    expect(root.attrs["data-theme"]).toBe("kawai");
    expect(root.classes.has("dark")).toBe(false);
    expect(root.style.colorScheme).toBe("light");
    applyTheme("matrix");
    expect(root.classes.has("dark")).toBe(true);
  });

  it("un valor guardado inválido cae al tema por defecto", () => {
    store.set(THEME_STORAGE_KEY, "no-existe");
    expect(savedTheme()).toBe(DEFAULT_THEME);
    expect(themeInfo(null).id).toBe(DEFAULT_THEME);
  });

  it("el script de arranque aplica el tema guardado antes de React", () => {
    store.set(THEME_STORAGE_KEY, "criminologia");
    new Function(THEME_BOOT_SCRIPT)();
    expect(root.attrs["data-theme"]).toBe("criminologia");
    expect(root.classes.has("dark")).toBe(false);

    store.set(THEME_STORAGE_KEY, "basura");
    new Function(THEME_BOOT_SCRIPT)();
    expect(root.attrs["data-theme"]).toBe(DEFAULT_THEME);
    expect(root.classes.has("dark")).toBe(true);
  });
});
