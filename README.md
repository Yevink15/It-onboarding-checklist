# IT Onboarding Checklist App

This repository contains a Vite + React + TypeScript implementation of the **IT Onboarding Checklist & Automation** web app. It features a dynamic checklist for onboarding new hires, optional automations via webhooks, and an optional shared mode using Firebase Firestore so anyone with the link can view and edit the same data.

## Getting Started

### Install dependencies

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Tailwind CSS & shadcn/ui

This project is styled with [Tailwind CSS](https://tailwindcss.com). The UI components referenced in the app code come from [shadcn/ui](https://ui.shadcn.com). After installing dependencies, you can generate these components with the shadcn CLI:

```bash
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card badge input label select dialog textarea tabs switch progress
```

The alias `@/components/ui` used throughout `src/App.tsx` resolves to `src/components/ui` (configured in `vite.config.ts`).

### Optional: Shared Mode via Firebase Firestore

The app supports real‑time collaboration when you enable **Shared mode** in the Settings panel. To configure shared mode:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Copy your project’s configuration (apiKey, authDomain, projectId, etc.).
3. Paste the JSON into the **Firebase config JSON** field in the Settings modal of the app and toggle **Enable Shared mode** on.
4. Anyone who opens the page will see live updates.

## Deployment to GitHub Pages

A GitHub Actions workflow is included at `.github/workflows/deploy.yml`. This workflow builds the site and deploys the `dist` folder to **GitHub Pages** whenever you push to the `main` branch.

To use GitHub Pages:

1. Create a repository on GitHub and push this project to the `main` branch.
2. In the repository **Settings → Pages**, choose **GitHub Actions** as the source.
3. On the first push, the workflow will build the app, upload the artifact, and publish the site. The URL will be `https://<your-username>.github.io/<repository-name>/`.

> **Note:** When deploying to a subpath (e.g., a GitHub Pages project site), you may need to set the `base` option in `vite.config.ts` to `'/your-repo-name/'` so asset URLs resolve correctly.

## License

This project is provided as‑is without any warranty. Feel free to adapt it for your organization.