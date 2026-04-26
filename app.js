import { AuthManager } from './auth.js';
import { db } from './db.js';
import { ReaderManager } from './reader.js';

/**
 * Global application parameters
 */
const CONFIG = {
  // Google Cloud Setup Steps:
  // 1. Visit https://console.cloud.google.com/
  // 2. Credentials -> Create Client ID (Web App)
  // 3. Set Authorized Origins: http://localhost:8000 & https://<username>.github.io
  CLIENT_ID: '145917365742-tl7lconto80p9jd6jbh4bk7p1d8mh8jp.apps.googleusercontent.com',
  API_KEY: 'AIzaSyB_VmyAvY4LKFP8BcBEQlubeAL6B1X3bIc',

  SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
  DB_NAME: 'DriveReader_DB',
  DB_VERSION: 1,
  IS_DEV: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
};

class App {
  constructor() {
    this.auth = new AuthManager(CONFIG);
    this.reader = new ReaderManager(db);
    this.settings = {
      theme: 'system',
      fontFamily: "'DM Sans', sans-serif",
      fontSize: 18,
      lineHeight: 1.5
    };
    
    this.currentAbortController = null;
    this.chromeTimer = null;
  }

  async start() {
    this.setupGlobalErrorHandler();
    this.registerServiceWorker();
    this.bindUI();

    // Check for existing settings
    this.settings = await db.getSettings();
    this.applyGlobalTheme(this.settings.theme);

    try {
      await this.auth.init();
      
      if (localStorage.getItem('noveldrive_logged_in') === 'true') {
        try {
          await this.auth.ensureToken(true); // silent
          const profile = await this.auth.getUserProfile();
          this.handleAuthSuccess(profile);
          return;
        } catch (e) {
          console.warn('Persistent silent sign-in failed');
        }
      }
      this.switchView('view-landing');
    } catch (e) {
      this.switchView('view-landing');
    }

  }

  /**
   * Modifies visible viewport states
   * @param {string} viewId 
   */
  switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    document.getElementById(viewId).classList.add('active');
  }

  /**
   * Binds click & swipe interactions
   */
  bindUI() {
    // Landing Action
    document.getElementById('btn-connect').addEventListener('click', async () => {
      this.showLoading('Authorizing Google Account...');
      try {
        await this.auth.ensureToken(false);
        const profile = await this.auth.getUserProfile();
        localStorage.setItem('noveldrive_logged_in', 'true');
        this.handleAuthSuccess(profile);
      } catch (e) {
        this.showError('Authentication failed. Check your API keys and configuration.');
      } finally {
        this.hideLoading();
      }
    });


    // Sign Out
    document.getElementById('btn-signout').addEventListener('click', async () => {
      localStorage.removeItem('noveldrive_logged_in');
      await this.auth.signOut();
      this.switchView('view-landing');
    });


    // Open Picker
    document.getElementById('btn-pick').addEventListener('click', async () => {
      try {
        const file = await this.auth.openPicker();
        await this.downloadAndLoadEpub(file.id, file.name);
      } catch (e) {
        if (e.message !== 'Picker dismissed by user') {
          this.showError(e.message || 'Error selecting book.');
        }
      }
    });

    // Open Folder Picker & Auto-Read
    document.getElementById('btn-pick-folder').addEventListener('click', async () => {
      try {
        const folder = await this.auth.openFolderPicker();
        this.showLoading(`Scanning "${folder.name}" for EPUBs...`);
        const files = await this.auth.listFiles(folder.id);
        
        if (files.length === 0) {
          this.toast('No EPUB files found in selected folder.');
          this.hideLoading();
          return;
        }

        this.showLoading(`Syncing ${files.length} books metadata...`);
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          await db.saveBook({
            fileId: file.id,
            title: file.name.replace('.epub', '').replace('.EPUB', '').trim(),
            author: 'Cloud Sync',
            coverDataUrl: file.thumbnailLink || ''
          });
        }

        
        this.toast(`Synchronized ${files.length} files successfully.`);
        await this.refreshLibraryGrid();
      } catch (e) {
        if (e.message !== 'Folder selection cancelled') {
          this.showError(e.message || 'Error processing folder.');
        }
      } finally {
        this.hideLoading();
      }
    });

    // Reader UI buttons

    document.getElementById('btn-reader-close').addEventListener('click', async () => {
      this.showLoading('Saving progress...');
      await this.reader.unloadBook();
      await this.refreshLibraryGrid();
      this.hideLoading();
      this.switchView('view-library');
    });

    document.getElementById('btn-prev').addEventListener('click', () => this.reader.rendition?.prev());
    document.getElementById('btn-next').addEventListener('click', () => this.reader.rendition?.next());
    document.getElementById('nav-left').addEventListener('click', () => this.reader.rendition?.prev());
    document.getElementById('nav-right').addEventListener('click', () => this.reader.rendition?.next());

    // Settings modal interactions
    const settingsDialog = document.getElementById('modal-settings');
    document.getElementById('btn-settings').addEventListener('click', () => {
      this.hydrateSettingsUI();
      settingsDialog.showModal();
    });
    document.getElementById('btn-settings-close').addEventListener('click', () => settingsDialog.close());

    // Settings manipulation
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const theme = e.target.getAttribute('data-theme');
        this.settings.theme = theme;
        this.applyGlobalTheme(theme);
        this.reader.applySettings(this.settings);
        await db.saveSettings(this.settings);
      });
    });

    document.getElementById('font-family-select').addEventListener('change', async (e) => {
      this.settings.fontFamily = e.target.value;
      this.reader.applySettings(this.settings);
      await db.saveSettings(this.settings);
    });

    const fontSlider = document.getElementById('font-size-slider');
    fontSlider.addEventListener('input', async (e) => {
      this.settings.fontSize = parseInt(e.target.value);
      document.getElementById('font-size-val').textContent = `${e.target.value}px`;
      this.reader.applySettings(this.settings);
      await db.saveSettings(this.settings);
    });

    const lineSlider = document.getElementById('line-height-slider');
    lineSlider.addEventListener('input', async (e) => {
      this.settings.lineHeight = parseFloat(e.target.value);
      this.reader.applySettings(this.settings);
      await db.saveSettings(this.settings);
    });

    // Abort downloading
    document.getElementById('btn-cancel-load').addEventListener('click', () => {
      if (this.currentAbortController) {
        this.currentAbortController.abort();
      }
      this.hideLoading();
    });

    // Setup Reader Auto-Hide Chrome
    window.addEventListener('reader-tap', () => this.toggleReaderChrome());
    
    // Tap anywhere on window resets the idle counter
    window.addEventListener('mousemove', () => this.resetChromeTimer());
    window.addEventListener('touchstart', () => this.resetChromeTimer());
  }

  /**
   * Downloads and transitions to full reader viewport
   * @param {string} fileId 
   * @param {string} fileName 
   */
  async downloadAndLoadEpub(fileId, fileName) {
    this.showLoading(`Downloading "${fileName}"...`, true);
    this.currentAbortController = new AbortController();

    try {
      const arrayBuffer = await this.auth.fetchFile(fileId, this.currentAbortController.signal);
      this.showLoading('Parsing ePub package...');
      
      await this.reader.loadBook(fileId, arrayBuffer);
      await this.reader.render('epub-viewer', this.settings);
      
      document.getElementById('reader-title').textContent = fileName;
      this.switchView('view-reader');
      this.resetChromeTimer();
    } catch (e) {
      if (e.name !== 'AbortError') {
        this.showError(`Error loading EPUB: ${e.message}`);
      }
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Successful profile verification
   */
  async handleAuthSuccess(profile) {
    this.switchView('view-library');
    document.getElementById('user-email').textContent = profile.email;
    
    const avatar = document.getElementById('user-avatar');
    if (profile.picture) {
      avatar.src = profile.picture;
      avatar.classList.remove('hidden');
    }
    
    try {
      this.showLoading('Syncing Cloud Shelf...');
      const files = await this.auth.listAllEpubs();
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await db.saveBook({
          fileId: file.id,
          title: file.name.replace('.epub', '').replace('.EPUB', '').trim(),
          author: 'Cloud Sync',
          coverDataUrl: file.thumbnailLink || ''
        });
      }
    } catch (e) {
      console.warn('Initial cloud sync failed:', e);
    } finally {
      this.hideLoading();
    }

    
    await this.refreshLibraryGrid();
  }

  /**
   * Refreshes dashboard bookshelf items
   */
  async refreshLibraryGrid() {
    const books = await db.getAllBooks();
    const grid = document.getElementById('books-grid');
    grid.innerHTML = '';

    if (books.length === 0) {
      grid.innerHTML = `<p style="color: var(--color-text-muted); padding: 20px 0;">No books loaded yet. Tap "Add Book" above.</p>`;
      return;
    }

    // Sort by most recently opened
    books.sort((a, b) => b.lastOpened - a.lastOpened).forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.addEventListener('click', () => this.downloadAndLoadEpub(book.fileId, book.title));

      const coverHTML = book.coverDataUrl 
        ? `<img class="book-cover" src="${book.coverDataUrl}" alt="${book.title}" loading="lazy">`
        : `<div class="book-cover-placeholder">${book.title.slice(0, 2).toUpperCase()}</div>`;

      card.innerHTML = `
        <div class="book-cover-wrapper">
          ${coverHTML}
        </div>
        <div class="book-info">
          <div class="book-title">${book.title}</div>
          <div class="book-author">${book.author}</div>
          <div class="progress-bar-container">
            <div class="progress-fill" style="width: ${book.percentage || 0}%"></div>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  /**
   * Fills control panels with active cache values
   */
  hydrateSettingsUI() {
    document.getElementById('font-family-select').value = this.settings.fontFamily;
    document.getElementById('font-size-slider').value = this.settings.fontSize;
    document.getElementById('font-size-val').textContent = `${this.settings.fontSize}px`;
    document.getElementById('line-height-slider').value = this.settings.lineHeight;
  }

  applyGlobalTheme(theme) {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  toggleReaderChrome() {
    const header = document.querySelector('.reader-header');
    const footer = document.querySelector('.reader-footer');
    header.classList.toggle('ui-hidden');
    footer.classList.toggle('ui-hidden');
  }

  resetChromeTimer() {
    const header = document.querySelector('.reader-header');
    const footer = document.querySelector('.reader-footer');
    
    // Don't auto-hide if settings are open
    if (document.getElementById('modal-settings').open) return;

    header?.classList.remove('ui-hidden');
    footer?.classList.remove('ui-hidden');

    clearTimeout(this.chromeTimer);
    this.chromeTimer = setTimeout(() => {
      if (document.getElementById('view-reader').classList.contains('active')) {
        header?.classList.add('ui-hidden');
        footer?.classList.add('ui-hidden');
      }
    }, 3000);
  }

  /**
   * Spawns non-blocking interface notifications
   */
  toast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  showLoading(text, showCancel = false) {
    const modal = document.getElementById('modal-loading');
    document.getElementById('loading-text').textContent = text;
    
    const cancelBtn = document.getElementById('btn-cancel-load');
    if (showCancel) cancelBtn.classList.remove('hidden');
    else cancelBtn.classList.add('hidden');
    
    if (!modal.open) modal.showModal();
  }

  hideLoading() {
    document.getElementById('modal-loading').close();
  }

  showError(message) {
    const modal = document.getElementById('modal-error');
    document.getElementById('error-message').textContent = message;
    if (!modal.open) modal.showModal();
    document.getElementById('btn-error-close').onclick = () => modal.close();
  }

  setupGlobalErrorHandler() {
    window.addEventListener('error', (e) => {
      this.toast(`Unexpected error: ${e.message}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.toast(`Async error: ${e.reason}`);
    });
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('Service worker registration failed:', err);
      });
    }
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.start();
});
