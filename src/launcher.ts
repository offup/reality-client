import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type LaunchProgress = { stage: string; done: number; total: number };

export type LaunchStatus =
  | { kind: "idle" }
  | { kind: "preparing"; progress: LaunchProgress }
  | { kind: "running" }
  | { kind: "error"; message: string };

export type AfterLaunch = "keep" | "minimize";

/** Error text from Rust when the account's sign-in has to be renewed */
export const SIGN_IN_AGAIN = "SIGN_IN_AGAIN";

/** Minecraft versions Fabric supports, newest first */
export function listVersions(): Promise<string[]> {
  return invoke<string[]>("list_versions");
}

/** Prepares everything (Java, files, Fabric) and starts the game; resolves once it runs */
export function launchGame(options: {
  uuid: string;
  instanceId: string;
  version: string;
  memoryMb: number;
}): Promise<void> {
  return invoke<void>("launch_game", { options });
}

export function openInstanceFolder(instanceId: string): Promise<void> {
  return invoke<void>("open_instance_folder", { instanceId });
}

/** Deletes the instance folder (worlds, mods, options) */
export function deleteInstanceFolder(instanceId: string): Promise<void> {
  return invoke<void>("delete_instance", { instanceId });
}

/** Deletes the stored sign-in of a removed account */
export function forgetAccount(uuid: string): Promise<void> {
  return invoke<void>("forget_account", { uuid });
}

export function onLaunchProgress(handler: (progress: LaunchProgress) => void): Promise<UnlistenFn> {
  return listen<LaunchProgress>("launch-progress", (e) => handler(e.payload));
}

export function onGameExited(handler: (exit: { code: number | null; early: boolean }) => void): Promise<UnlistenFn> {
  return listen<{ code: number | null; early: boolean }>("game-exited", (e) => handler(e.payload));
}
