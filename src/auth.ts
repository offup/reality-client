import { invoke } from "@tauri-apps/api/core";

export type Account = {
  uuid: string;
  name: string;
  /** Skin-URL oder data:-URL */
  skin: string;
  model: "default" | "slim";
  cape?: string | null;
};

/** Opens the browser for the Microsoft sign-in and resolves with the Minecraft profile */
export function startMicrosoftLogin(): Promise<Account> {
  return invoke<Account>("start_microsoft_login");
}

/** Cancels a running sign-in (the browser tab stays open, the app just stops waiting) */
export function cancelMicrosoftLogin(): Promise<void> {
  return invoke<void>("cancel_microsoft_login");
}
