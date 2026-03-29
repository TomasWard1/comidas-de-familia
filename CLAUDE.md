# Comidas de Familia

## Stack
- **Runtime**: Bun
- **Server**: Hono (single file: `server.ts`)
- **DB**: SQLite via `bun:sqlite` (file: `comidas.db`, auto-created)
- **Frontend**: Vanilla HTML/CSS/JS (single file: `public/index.html`)
- **Package manager**: bun (not npm)

## Development
```bash
bun install
bun dev        # watch mode on :3000
```

## Production Deployment
- **Public URL**: https://comidas.tomasward.com
- Hosted on **secondary-mac** (Tailscale: `100.87.186.1:3000`, LAN: `192.168.1.31:3000`)

- **App path**: `/Users/aios/comidas-de-familia/`
- **DB path**: `/Users/aios/comidas-de-familia/comidas.db`
- **Service**: launchd (`com.comidas.server`) — auto-starts on boot, auto-restarts on crash
- **Logs**: `/Users/aios/comidas-de-familia/server.log`
- **SSH**: `ssh secondary-mac`

### Deploy updates
```bash
# From repo worktree:
scp server.ts package.json secondary-mac:~/comidas-de-familia/
scp public/index.html secondary-mac:~/comidas-de-familia/public/
ssh secondary-mac 'launchctl unload ~/Library/LaunchAgents/com.comidas.server.plist && launchctl load ~/Library/LaunchAgents/com.comidas.server.plist'
```

### Service management
```bash
ssh secondary-mac 'launchctl unload ~/Library/LaunchAgents/com.comidas.server.plist'  # stop app
ssh secondary-mac 'launchctl load ~/Library/LaunchAgents/com.comidas.server.plist'    # start app
ssh secondary-mac 'cat ~/comidas-de-familia/server.log'                               # app logs
```

### Cloudflare Tunnel
- **Tunnel name**: `comidas` (ID: `e66c68bc-337b-41a9-b6bf-97e34f5f8143`)
- **Domain**: `comidas.tomasward.com` → `localhost:3000`
- **Config**: `/Users/aios/.cloudflared/config.yml`
- **Service**: launchd (`com.cloudflare.comidas`) — persistent, auto-restarts
- **Logs**: `/Users/aios/comidas-de-familia/tunnel.log`

```bash
ssh secondary-mac 'launchctl unload ~/Library/LaunchAgents/com.cloudflare.comidas.plist'  # stop tunnel
ssh secondary-mac 'launchctl load ~/Library/LaunchAgents/com.cloudflare.comidas.plist'    # start tunnel
ssh secondary-mac 'cat ~/comidas-de-familia/tunnel.log'                                   # tunnel logs
```
