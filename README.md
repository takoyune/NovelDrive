# NovelDrive — Premium EPUB Reader

A highly optimized, serverless EPUB reader client integrating seamlessly with **Google Drive**. Deployable with zero dependencies directly via GitHub Pages.

## Features
- 🚀 **Zero Server Architecture**: Runs exclusively via Client-side standard frameworks.
- 📂 **Native Stream Capabilities**: Pulls requested reading segments using direct implicit streams.
- 📱 **Fully Synchronized PWA Utilities**: Read on modular tablets.

---

## 🛠️ Google Developer Cloud Provisioning (5 Steps)

Follow the outlined steps to generate standard authentication vectors.

### Step 1: Initialize Project
- Access the [Google Cloud Portal](https://console.cloud.google.com/).
- Choose/Create target instances.

### Step 2: Configure Keys
- Navigate through **APIs and Services** -> **Credentials**.
- Formulate an active **OAuth 2.0 Client Identifier** as a `Web Application`.

### Step 3: Configure Base Mapping
- Identify authorized deployment origins:
  - `http://localhost:8000`
  - `https://yourdomain.github.io`

### Step 4: Toggle Drivers
- Enable both standard indexers:
  - `Google Drive API`
  - `Google Picker API`

### Step 5: Save Keys
- Inject appropriate codes directly inside initial `app.js` blocks.
