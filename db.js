/**
 * DB.js
 * Native Promisified IndexedDB wrapper for lightweight/heavy state caching
 */
export class DB {
  /**
   * @param {string} dbName
   * @param {number} version
   */
  constructor(dbName = 'DriveReader_DB', version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
  }

  /**
   * Initializes the IndexedDB instance
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Books Store: Cache metadata, bookmarks, CFI strings
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'fileId' });
        }
        
        // Settings Store: Global appearance configurations
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(`IndexedDB Connection Error: ${event.target.error}`);
      };
    });
  }

  /**
   * @param {string} fileId
   * @returns {Promise<object|null>}
   */
  async getBook(fileId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['books'], 'readonly');
      const store = transaction.objectStore('books');
      const request = store.get(fileId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * @returns {Promise<Array>}
   */
  async getAllBooks() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['books'], 'readonly');
      const store = transaction.objectStore('books');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * @param {object} bookData
   * @returns {Promise<object>}
   */
  async saveBook(bookData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['books'], 'readwrite');
      const store = transaction.objectStore('books');
      
      const getReq = store.get(bookData.fileId);
      getReq.onsuccess = () => {
        const existing = getReq.result || {
          bookmarks: [],
          highlights: [],
          readingTimeSeconds: 0,
          percentage: 0
        };
        const merged = { ...existing, ...bookData, lastOpened: Date.now() };
        const putReq = store.put(merged);
        
        putReq.onsuccess = () => resolve(merged);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * @param {string} fileId
   * @returns {Promise<void>}
   */
  async deleteBook(fileId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['books'], 'readwrite');
      const store = transaction.objectStore('books');
      const request = store.delete(fileId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * @returns {Promise<object>}
   */
  async getSettings() {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['settings'], 'readonly');
      const store = transaction.objectStore('settings');
      const request = store.get('userPrefs');

      request.onsuccess = () => {
        const defaultSettings = {
          id: 'userPrefs',
          theme: 'system',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '18',
          lineHeight: '1.5',
          margin: '20px'
        };
        resolve(request.result || defaultSettings);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * @param {object} settingsData
   * @returns {Promise<object>}
   */
  async saveSettings(settingsData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['settings'], 'readwrite');
      const store = transaction.objectStore('settings');
      const merged = { id: 'userPrefs', ...settingsData };
      const request = store.put(merged);

      request.onsuccess = () => resolve(merged);
      request.onerror = () => reject(request.error);
    });
  }
}
export const db = new DB();
export default db;
