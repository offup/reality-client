/** A game setup: its own folder (worlds, mods, options), one Minecraft version, always Fabric */
export type Instance = {
  id: string;
  name: string;
  version: string;
  created: number;
  lastPlayed?: number;
};

/** Folder-safe random id (letters, digits, dashes), checked again on the Rust side */
export function newInstanceId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

export function createInstance(name: string, version: string, id: string = newInstanceId()): Instance {
  return { id, name: name.trim() || `Fabric ${version}`, version, created: Date.now() };
}

/** "2 hours ago" style text for the last session */
export function playedAgo(time?: number): string {
  if (!time) return "Never played";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "Played just now";
  if (minutes < 60) return `Played ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Played ${hours} h ago`;
  const days = Math.round(hours / 24);
  return `Played ${days} ${days === 1 ? "day" : "days"} ago`;
}
