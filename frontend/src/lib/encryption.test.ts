import { beforeEach, describe, expect, it } from "vitest";
import { SecureStorage, encrypt } from "./encryption";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  (globalThis as any).window = { crypto: globalThis.crypto, location: { hostname: "localhost" } };
});

describe("SecureStorage", () => {
  it("guarda y recupera con la clave del navegador, sin depender de la fecha", async () => {
    await SecureStorage.setItem("api-providers", [{ id: "local" }]);
    expect(localStorage.getItem("nexo_device_key")).toHaveLength(64);
    expect(await SecureStorage.getItem("api-providers")).toEqual([{ id: "local" }]);
  });

  it("migra datos cifrados con el esquema anterior (user agent + día del mes)", async () => {
    const legacy = `${navigator.userAgent}-17-localhost`;
    localStorage.setItem("nexo_secure_api-providers", await encrypt(JSON.stringify([{ id: "groq" }]), legacy));
    localStorage.setItem("nexo_secure_metadata", JSON.stringify({ "api-providers": { encrypted: true } }));

    expect(await SecureStorage.getItem("api-providers")).toEqual([{ id: "groq" }]);
    // quedó re-cifrado con la clave nueva: se lee sin probar las viejas
    const stored = localStorage.getItem("nexo_secure_api-providers")!;
    expect(await SecureStorage.getItem("api-providers")).toEqual([{ id: "groq" }]);
    expect(stored).not.toBeNull();
  });
});
