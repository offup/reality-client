# Reality Client

A Minecraft launcher for Windows: sign in with Microsoft, create instances and play on Fabric.

## Download

Get the latest **Reality-Client_x.y.z_x64-setup.exe** from the [public releases](https://github.com/offup/reality-client-releases/releases/latest) and run it.
The launcher updates itself: when a new version is out, a notice appears at the top left, one click installs it.

Windows may warn about an unknown publisher because the installer is not code-signed yet.
Click "More info" and "Run anyway".

## Features

- Microsoft sign-in, several accounts
- Instances with their own worlds, mods and settings
- Minecraft 26.x and newer, always with Fabric
- Java is downloaded automatically
- Animated backgrounds and a 3D view of your skin

## Development

```bash
npm install
npm run tauri dev
```

Release a new version: builds the installer, signs the update with `~/.tauri/reality-client.key` and publishes it in [offup/reality-client-releases](https://github.com/offup/reality-client-releases):

```bash
npm run release -- 0.2.0 "What changed"
```
