# VRC-Control

> ⚠️ **Archived test project**
>
> This repository was a private test project (May–August 2025) and is provided here as
> an archive only. It is **not maintained** and there is **no support**.
> **No guarantee is given that anything works** – use at your own risk.
>
> Running automated or headless VRChat clients may violate the
> [VRChat Terms of Service](https://hello.vrchat.com/legal). You are responsible for how
> you use this. Not affiliated with VRChat Inc.

## What is it?

A Discord bot addon plus web dashboard to run and control **up to 5 VRChat client
instances** on a Windows machine (e.g. to keep group instances open with "instance bots").

- **Web dashboard** (Express + WebSocket, default `http://localhost:4545`):
  start/stop instances, change world/instance per bot, live RAM/CPU/uptime
- **World presets** and full instance strings (`wrld_…:12345~group(grp_…)~…`)
- **Auto start** of all bots with a configurable delay between launches
- **OSC chatbox control**: send chatbox messages to one or several clients, message loops,
  built-in templates (time, date, uptime, …) and custom templates
- **Login** with random credentials (bcrypt hashed, valid for 24 h),
  regenerated via `/vrchat reset`
- **Discord slash command** `/vrchat` with `dashboard`, `reset`, `status`, `chatbox`,
  `multi-chatbox`, `template`, `loop`, `osc-status`; optional log channel
- **Backup tool** for the config files (`node backup.js create|list|restore <name>`)

Clients are launched via `launch.exe … -no-ht -batchmode -nographics --osc=…
vrchat://launch?id=<world>`, each with its own OSC port.

> Note: the dashboard UI, bot replies and log messages are in **German**.

## Requirements

- **Windows** (uses `start`, `tasklist`, `wmic`, `taskkill`) with VRChat installed
- Node.js 18+
- A discord.js v14 bot

## Setup

```bash
npm install
node setup.js            # creates/updates the config files
```

Integrate it into your bot (the files are expected in `addons/vrc-control/`), see
`integration-example.js`:

```javascript
const vrchatControl = require('./addons/vrc-control/cmd_vrchatcontrol.js');
client.commands.set(vrchatControl.data.name, vrchatControl);

client.once('ready', () => {
    vrchatControl.init(client); // starts the web dashboard automatically
});
```

The web server can also be run on its own with `npm run web`; the login credentials are
then printed to the console.

## Configuration

| File | Content |
|------|---------|
| `vrc_control_config.json` | `debugLogChannelId` (Discord log channel), `adminRoleId` |
| `web_config.json` | `host`, `port`, `maxBots`, `launchExePaths` per bot, `startupDelay`, `worldPresets`, OSC ports |
| `custom_templates.json` | custom chatbox templates |
| env `VRC_DASHBOARD_URL` | URL shown in Discord for the dashboard (default `http://localhost:4545`) |

Runtime files that are created automatically and must not be committed:
`credentials.json`, `instances_config.json`, `backups/`.

## ⚠️ Security notice

- Keep `host` at `127.0.0.1` (default in this repo). If you change it to `0.0.0.0`, the
  dashboard is reachable from your network. If you expose it, put it behind HTTPS – the
  session cookie is not marked `secure`.
- The WebSocket endpoint `/ws` does not check the login and pushes status updates
  (system load, bot status, world IDs) to any client that connects.
- World IDs are inserted into a shell command. This archive version validates them
  against a strict pattern; do not remove that check.

## Known state

Briefly tested on Linux (October 2026, Node.js 26, mocked Discord client):
the dashboard loads, credentials are generated, login/logout and auth protection work,
status/OSC/template APIs respond, changing the world ID works (invalid/injected IDs are
rejected), and OSC chatbox messages are sent as `/chatbox/input` packets.
Actually launching VRChat could **not** be tested (Windows only).

Missing from this archive: `cleanup_port.js` (referenced by `start.bat`/`cleanup.bat`)
and `INTEGRATION.md`.

Changes compared to the original private version: personal Discord/VRChat IDs, group
instance presets and the dashboard domain were replaced with placeholders, the default
host was set to `127.0.0.1`, world ID validation was added, and `package.json` was added.

## License

[MIT](LICENSE)
