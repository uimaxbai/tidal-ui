# TIDAL UI# sv



<div align="center">Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

  

![TIDAL UI](https://img.shields.io/badge/TIDAL-UI-blue?style=for-the-badge)## Creating a project

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

[![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)](https://kit.svelte.dev/)If you're seeing this, you've probably already done this step. Congrats!

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

```sh

🎵 **Privacy-focused, cross-platform, frontend for HIFI Tidal API**# create a new project in the current directory

npx sv create

[Features](#-features) • [Quick Start](#-quick-start) • [API](#-api) • [Development](#-development)

# create a new project in my-app

</div>npx sv create my-app

```

---

## Developing

## 🌟 Overview

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

TIDAL UI is a modern, privacy-focused web application that provides a beautiful interface for streaming and downloading high-fidelity music from TIDAL using the [HIFI API](https://github.com/sachinsenal0x64/hifi-tui). Built with SvelteKit 5, TypeScript, and Tailwind CSS 4.

```sh

**Built on top of:** [HIFI by sachinsenal0x64](https://github.com/sachinsenal0x64/hifi-tui)npm run dev



## ✨ Features# or start the server and open the app in a new browser tab

npm run dev -- --open

### 🎧 Audio Streaming & Playback```

- **Full-featured audio player** with play, pause, skip, volume control

- **Seekable progress bar** for precise playback control## Building

- **Queue management** with previous/next track support

- **Real-time track information** display with album artTo create a production version of your app:



### 🔊 Quality & Codec Support```sh

- **Hi-Res Lossless** - Up to 24-bit, 192 kHznpm run build

- **Hi-Res (MQA)** - Up to 96 kHz```

- **Lossless** - FLAC, 16-bit, 44.1 kHz

- **High** - AAC, 320 kbpsYou can preview the production build with `npm run preview`.

- **Low** - AAC, 96 kbps

- Dolby Atmos, Sony 360 Reality Audio, and more> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.


### 🔍 Search & Discovery
- **Multi-category search** - Tracks, albums, artists, and playlists
- **Tabbed interface** for easy navigation
- **Real-time results** with beautiful grid and list layouts
- **Cover art** and metadata display

### 📥 Download Functionality
- **Download any track** in your preferred quality
- **One-click downloads** from player or track lists
- **Quality selection** per download

### 🎨 User Interface
- **Modern, responsive design** that works on all devices
- **Dark theme** optimized for music listening
- **Smooth animations** and transitions
- **Intuitive navigation** with dedicated pages for albums, artists, and playlists

### 🔒 Privacy-Focused
- **No tracking or analytics**
- **No ads**
- **No data collection**
- **Client-side audio processing**

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm/pnpm/yarn
- Modern web browser with ES6+ support

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd tidal-ui

# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:5173
```

### Building for Production

```bash
# Build the application
npm run build

# Preview production build
npm run preview
```

## 🛠️ Technology Stack

- **[SvelteKit 5](https://kit.svelte.dev/)** - Full-stack framework with Svelte 5 runes
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe development
- **[Tailwind CSS 4](https://tailwindcss.com/)** - Utility-first styling
- **[Lucide Svelte](https://lucide.dev/)** - Beautiful icons
- **[HIFI API](https://tidal.401658.xyz)** - Backend music service

## 📡 API

This application uses the [HIFI Tidal API](https://tidal.401658.xyz) which provides:

- Track streaming and metadata
- Album and artist information
- Playlist management
- Cover art and lyrics
- Search functionality
- Multiple audio quality options

**API Base URL:** `https://tidal.401658.xyz`

**Documentation:** [HIFI API Docs](https://tidal.401658.xyz/tdoc)

## 📂 Project Structure

```
tidal-ui/
├── src/
│   ├── lib/
│   │   ├── api.ts                    # API service layer
│   │   ├── types.ts                  # TypeScript definitions
│   │   ├── stores/
│   │   │   └── player.ts             # Audio player state management
│   │   └── components/
│   │       ├── AudioPlayer.svelte    # Main audio player
│   │       ├── SearchInterface.svelte # Search component
│   │       ├── TrackList.svelte      # Track listing
│   │       └── QualitySelector.svelte # Quality selector
│   ├── routes/
│   │   ├── +layout.svelte            # Main layout
│   │   ├── +page.svelte              # Home page
│   │   ├── album/[id]/+page.svelte   # Album details
│   │   ├── artist/[id]/+page.svelte  # Artist details
│   │   └── playlist/[id]/+page.svelte # Playlist details
│   └── app.css                       # Global styles
├── package.json
├── svelte.config.js
├── vite.config.ts
└── tsconfig.json
```

## 🎯 Usage

### Search for Music
1. Enter a search query in the search bar
2. Choose between Tracks, Albums, Artists, or Playlists tabs
3. Click on any result to view details or play

### Play Music
1. Click on any track to add it to the player
2. Use player controls to play, pause, skip tracks
3. Adjust volume with the volume slider
4. Seek through track with the progress bar

### Download Music
1. Click the download icon on any track
2. Select your preferred quality in the quality selector
3. Track will be downloaded to your device

### Change Quality
1. Click the quality selector in the header
2. Choose from HI_RES_LOSSLESS, HI_RES, LOSSLESS, HIGH, or LOW
3. New quality applies to all subsequent plays and downloads

## 🔧 Development

### Development Mode

```bash
npm run dev
```

### Handling CORS Issues

The HIFI API at `https://tidal.401658.xyz` may have CORS restrictions. The actual TIDAL CDN stream URLs are CORS-friendly, but if you encounter issues with API calls, you have several options:

#### Option 1: Use a CORS Proxy (Development Only)

Edit `src/lib/config.ts`:

```typescript
export const API_CONFIG = {
  baseUrl: 'https://corsproxy.io/?https://tidal.401658.xyz',
  useProxy: false,
  proxyUrl: '/api/proxy'
};
```

⚠️ **Not recommended for production** as public CORS proxies are unreliable.

#### Option 2: Set Up a Backend Proxy (Recommended)

Create a simple backend proxy using Node.js/Express, Cloudflare Workers, or Vercel serverless functions:

**Example with SvelteKit API route** (`src/routes/api/proxy/+server.ts`):

```typescript
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const targetUrl = url.searchParams.get('url');
  
  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }
  
  const response = await fetch(targetUrl);
  const data = await response.json();
  
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
```

Then update `src/lib/config.ts`:

```typescript
export const API_CONFIG = {
  baseUrl: 'https://tidal.401658.xyz',
  useProxy: true,
  proxyUrl: '/api/proxy'
};
```

#### Option 3: Use the Hosted HIFI API

The HIFI API at `https://tidal.401658.xyz` should work directly in most cases. If you're experiencing issues, check:

1. Browser console for specific CORS errors
2. Network tab to see which requests are failing
3. Try a different browser or disable extensions

### Type Checking

```bash
npm run check
```

### Linting & Formatting

```bash
npm run lint
npm run format
```

### Building

```bash
npm run build
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- **[HIFI](https://github.com/sachinsenal0x64/hifi-tui)** by sachinsenal0x64 for the incredible API
- **[SvelteKit](https://kit.svelte.dev/)** team for the amazing framework
- **[Tailwind CSS](https://tailwindcss.com/)** for the styling utilities
- **[Lucide](https://lucide.dev/)** for the beautiful icons

## ⚠️ Disclaimer

This project is for educational purposes only. We do not encourage piracy. Please support artists by purchasing their music and subscribing to legitimate streaming services.

The developer is currently paying for a Tidal HiFi Plus subscription.

## 📞 Support

For issues, questions, or contributions, please visit the [GitHub repository](https://github.com/yourusername/tidal-ui).

---

<div align="center">
Made with ❤️ and 🎵
</div>
