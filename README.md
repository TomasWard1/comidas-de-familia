# Comidas de Familia

Family chore rotation tracker — mobile-first logging system for household meal duties.

## Features

- **Score dashboard**: See totals per category and who's next in rotation
- **One-tap logging**: Select person → category → optional notes → done
- **History**: Full timeline with delete
- **Member management**: Add/remove family members

### Categories
Cocina · Lava · Seca · Sacar Lavavajillas · Poner Lavavajillas

## Setup

```bash
bun install
bun dev
# → http://localhost:3000
```

Requires [Bun](https://bun.sh) runtime.

## Production

Deployed on secondary-mac via launchd service. See [CLAUDE.md](CLAUDE.md) for deployment details.
