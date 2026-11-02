import { invoke } from "@tauri-apps/api/core";
import type { Account } from "./auth";

/** A cape the account owns; `texture` is the 64×32 cape image as data URL */
export type CapeInfo = { id: string; name: string; texture: string; active: boolean };

export type ProfileDetails = { account: Account; capes: CapeInfo[] };

/** Current skin, model and all capes (needs a stored sign-in) */
export function profileDetails(uuid: string): Promise<ProfileDetails> {
  return invoke("profile_details", { uuid });
}

/** Uploads a 64×64 skin PNG (base64) as the new Minecraft skin */
export function uploadSkin(uuid: string, pngBase64: string, slim: boolean): Promise<ProfileDetails> {
  return invoke("profile_upload_skin", { uuid, pngBase64, slim });
}

/** Shows that cape, or none with null */
export function setCape(uuid: string, capeId: string | null): Promise<ProfileDetails> {
  return invoke("profile_set_cape", { uuid, capeId });
}

/** "data:image/png;base64,AAAA" → "AAAA" */
export function dataUrlBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** Reads a picked file as base64 */
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(dataUrlBase64(String(reader.result)));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}
