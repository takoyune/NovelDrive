/**
 * Reader.js
 * ePub.js pagination mapping, theme injection, and local state debouncing.
 */
export class ReaderManager {
  /**
   * @param {object} db - db.js IndexedDB instance
   */
  constructor(db) {
    this.db = db;
    this.book = null;
    this.rendition = null;
    this.currentFileId = null;
    this.saveTimeout = null;
    this.readingTimer = null;
    this.toc = [];
  }

  /**
   * Loads the arrayBuffer ePub raw payload
   * @param {string} fileId
   * @param {ArrayBuffer} arrayBuffer
   */
  async loadBook(fileId, arrayBuffer) {
    if (this.book) {
      await this.unloadBook();
    }

    this.currentFileId = fileId;
    this.book = ePub(arrayBuffer, { openAs: 'epub' });

    // Read general details
    const metadata = await this.book.loaded.metadata;
    const coverPath = await this.book.loaded.cover;
    let coverDataUrl = '';

    if (coverPath) {
      try {
        const url = await this.book.archive.createUrl(coverPath, { base64: true });
        coverDataUrl = url;
      } catch (e) {
        console.warn('Cover extraction failed:', e);
      }
    }

    const nav = await this.book.loaded.navigation;
    this.toc = nav.toc || [];

    // Persist structural identifiers to cache
    const existing = await this.db.getBook(fileId);
    await this.db.saveBook({
      fileId,
      title: metadata.title || 'Untitled',
      author: metadata.creator || 'Anonymous',
      coverDataUrl: coverDataUrl || (existing ? existing.coverDataUrl : '')
    });

    return { metadata, toc: this.toc };
  }

  /**
   * Spawns view containers
   * @param {string} containerId 
   * @param {object} settings 
   */
  async render(containerId, settings) {
    if (!this.book) return;

    this.rendition = this.book.renderTo(containerId, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated'
    });

    this.applySettings(settings);

    // Retrieve previous location
    const stored = await this.db.getBook(this.currentFileId);
    if (stored && stored.lastCFI) {
      await this.rendition.display(stored.lastCFI);
    } else {
      await this.rendition.display();
    }

    // Build overall percentage targets
    this.book.ready.then(() => {
      this.book.locations.generate(1000).catch(() => {});
    });

    // Relocation handlers
    this.rendition.on('relocated', (location) => {
      this.handleRelocation(location);
    });

    // Tap to toggle chrome
    this.rendition.on('click', () => {
      window.dispatchEvent(new CustomEvent('reader-tap'));
    });


    this.setupTouchControls();
    this.startReadingTimer();
  }

  /**
   * Adapts custom display aesthetics
   * @param {object} settings
   */
  applySettings(settings) {
    if (!this.rendition) return;

    const stylesheet = {
      body: {
        'font-family': `${settings.fontFamily} !important`,
        'font-size': `${settings.fontSize}px !important`,
        'line-height': `${settings.lineHeight} !important`,
        'color': 'var(--color-text)',
        'background-color': 'var(--color-bg)',
        'padding': '0 24px !important',
        'word-wrap': 'break-word'
      },
      p: {
        'margin-bottom': '1em !important'
      }
    };

    this.rendition.themes.default(stylesheet);
  }

  /**
   * Debounces position tracking to avoid blocking frame requests
   * @param {object} location
   */
  handleRelocation(location) {
    clearTimeout(this.saveTimeout);

    const percentageValue = this.book.locations.percentageFromCfi(location.start.cfi);
    const progressPercent = Math.round((percentageValue || 0) * 100);

    // Update UI labels immediately
    const labelUI = document.getElementById('reading-percentage');
    if (labelUI) labelUI.textContent = `${progressPercent}%`;

    const chapterLabel = document.getElementById('chapter-name');
    if (chapterLabel && location.start.index !== undefined) {
      const currentChapter = this.toc[location.start.index];
      if (currentChapter && currentChapter.label) {
        chapterLabel.textContent = currentChapter.label.trim();
      } else {
        chapterLabel.textContent = `Progress — Page ${location.start.index}`;
      }
    }

    // Debounce the IndexedDB write
    this.saveTimeout = setTimeout(async () => {
      if (this.currentFileId) {
        await this.db.saveBook({
          fileId: this.currentFileId,
          lastCFI: location.start.cfi,
          percentage: progressPercent
        });
      }
    }, 500);
  }

  /**
   * Safely disposes loaded payloads
   */
  async unloadBook() {
    this.stopReadingTimer();
    clearTimeout(this.saveTimeout);

    if (this.rendition) {
      await this.rendition.destroy();
      this.rendition = null;
    }

    if (this.book) {
      await this.book.destroy();
      this.book = null;
    }
    
    this.currentFileId = null;
    this.toc = [];
  }

  /**
   * Configures touch support metrics
   */
  setupTouchControls() {
    let startX = 0;
    const viewer = document.getElementById('epub-viewer');
    if (!viewer) return;

    const handleStart = (e) => {
      startX = e.touches ? e.touches[0].clientX : e.clientX;
    };

    const handleEnd = (e) => {
      const endX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
      const diffX = startX - endX;

      if (Math.abs(diffX) > 50) {
        if (diffX > 0) this.rendition.next();
        else this.rendition.prev();
      }
    };

    viewer.addEventListener('touchstart', handleStart, { passive: true });
    viewer.addEventListener('touchend', handleEnd, { passive: true });
  }

  /**
   * Incremental visibility timers
   */
  startReadingTimer() {
    this.stopReadingTimer();
    this.readingTimer = setInterval(async () => {
      if (document.visibilityState === 'visible' && this.currentFileId) {
        const stored = await this.db.getBook(this.currentFileId);
        const currentSeconds = (stored ? stored.readingTimeSeconds : 0) + 10;
        await this.db.saveBook({
          fileId: this.currentFileId,
          readingTimeSeconds: currentSeconds
        });
      }
    }, 10000);
  }

  stopReadingTimer() {
    if (this.readingTimer) {
      clearInterval(this.readingTimer);
      this.readingTimer = null;
    }
  }
}
export default ReaderManager;
