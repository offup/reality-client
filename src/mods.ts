import { invoke } from "@tauri-apps/api/core";

/** One Modrinth search result (already filtered to Fabric and the instance's version) */
export type ModHit = {
  id: string;
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
  author: string;
  categories: string[];
};

/** A mod in an instance's mods folder */
export type InstalledMod = {
  /** Empty for jars added to the folder by hand */
  projectId: string;
  versionId: string;
  versionNumber: string;
  title: string;
  filename: string;
  iconUrl: string | null;
  enabled: boolean;
  /** Installed automatically because another mod needs it */
  dependency: boolean;
};

export type ModSort = "relevance" | "downloads" | "updated" | "newest";

export function searchMods(options: {
  query: string;
  gameVersion: string;
  category?: string;
  sort?: ModSort;
  offset?: number;
}): Promise<{ hits: ModHit[]; total: number }> {
  return invoke("modrinth_search", options);
}

export function listMods(instanceId: string): Promise<InstalledMod[]> {
  return invoke("mods_list", { instanceId });
}

/** Installs the mod and everything it requires; resolves with the new list */
export function installMod(instanceId: string, projectId: string, gameVersion: string): Promise<InstalledMod[]> {
  return invoke("mods_install", { instanceId, projectId, gameVersion });
}

export function setModEnabled(instanceId: string, filename: string, enabled: boolean): Promise<InstalledMod[]> {
  return invoke("mods_set_enabled", { instanceId, filename, enabled });
}

export function removeMod(instanceId: string, filename: string): Promise<InstalledMod[]> {
  return invoke("mods_remove", { instanceId, filename });
}

/** 54321000 → "54M", 12400 → "12K" */
export function shortCount(n: number): string {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`.replace(".0M", "M");
  if (n >= 1e3) return `${Math.round(n / 1e2) / 10}K`.replace(".0K", "K");
  return String(n);
}
