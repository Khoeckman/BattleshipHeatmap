# Battleship Heatmap

A customizable multithreaded battleship probability calculator and solver. Input your board size, boats, and clues to find the best next shot.

## Development

This project uses [pnpm](https://pnpm.io/installation) as its package manager and [Vite](https://vite.dev/) as its build tool.

To install the dependencies run:

```bash
pnpm i
```

Run the Vite development server which comes with hot reloading:

```bash
pnpm run dev
```

Build `src/` to `docs/`:

```bash
pnpm run build
```

Vite's **build settings** can be modified in `vite.config.js`.
The **TypeScript** settings can be modified in `tsconfig.json`.

Preview the build output:

```bash
pnpm run preview
```

Run the linter:

```bash
pnpm run lint
```

The **ESLint rules** can be modified in `eslint.config.js`.

Format the source code:

```bash
pnpm run format
```

The **Prettier rules** can be modified in `.prettierrc`.
