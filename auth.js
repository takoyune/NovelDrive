/**
 * Auth.js
 * Manages Google Identity Services OAuth Implicit flow and Picker API integration.
 */
export class AuthManager {
  /**
   * @param {object} config
   */
  constructor(config) {
    this.config = config;
    this.accessToken = null;
    this.expiresAt = 0;
    this.tokenClient = null;
    
    // Callbacks for the tokenClient execution flow
    this.pendingAuthResolve = null;
    this.pendingAuthReject = null;
  }

  /**
   * Initializes the GIS Token Client
   * @returns {Promise<void>}
   */
  async init() {
    return new Promise((resolve) => {
      const checkGSI = setInterval(() => {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
          clearInterval(checkGSI);
          this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: this.config.CLIENT_ID,
            scope: this.config.SCOPES,
            callback: (response) => {
              if (response.error) {
                if (this.pendingAuthReject) this.pendingAuthReject(response);
                return;
              }
              this.accessToken = response.access_token;
              this.expiresAt = Date.now() + response.expires_in * 1000;
              if (this.pendingAuthResolve) this.pendingAuthResolve(this.accessToken);
            }
          });
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Ensures a valid token exists, requesting one silently or via prompt if missing
   * @param {boolean} silent
   * @returns {Promise<string>} Access Token
   */
  async ensureToken(silent = false) {
    if (this.accessToken && Date.now() < this.expiresAt - 5 * 60 * 1000) {
      return this.accessToken;
    }

    return new Promise((resolve, reject) => {
      this.pendingAuthResolve = resolve;
      this.pendingAuthReject = reject;

      if (!this.tokenClient) {
        reject('GIS client not initialized.');
        return;
      }

      // 'none' handles non-interactive silent login
      const promptType = silent ? 'none' : (this.accessToken ? '' : 'select_account');
      this.tokenClient.requestAccessToken({ prompt: promptType });
    });
  }


  /**
   * Fetches the current Google User Profile (email and avatar)
   * @returns {Promise<{email: string, picture: string}>}
   */
  async getUserProfile() {
    const token = await this.ensureToken();
    // Use drive/v3/about to fetch profile info utilizing the drive.readonly scope
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error('Failed to fetch user profile.');
    const data = await res.json();
    return {
      email: data.user.emailAddress,
      picture: data.user.photoLink
    };
  }

  /**
   * Invokes the Google Picker UI for EPUB selection
   * @returns {Promise<{id: string, name: string, thumbnailUrl: string}>}
   */
  async openPicker() {
    const token = await this.ensureToken();

    return new Promise((resolve, reject) => {
      const showPickerUI = () => {
        const viewDocs = new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setMimeTypes('application/epub+zip');
          
        const viewRecent = new google.picker.DocsView(google.picker.ViewId.RECENTLY_PICKED)
          .setMimeTypes('application/epub+zip');

        const picker = new google.picker.PickerBuilder()
          .addView(viewDocs)
          .addView(viewRecent)
          .setOAuthToken(token)
          .setDeveloperKey(this.config.API_KEY)
          .setCallback((data) => {
            if (data.action === google.picker.Action.PICKED) {
              const doc = data.docs[0];
              resolve({
                id: doc.id,
                name: doc.name,
                thumbnailUrl: doc.thumbnails && doc.thumbnails[0] ? doc.thumbnails[0].url : ''
              });
            } else if (data.action === google.picker.Action.CANCEL) {
              reject(new Error('Picker dismissed by user'));
            }
          })
          .build();

        picker.setVisible(true);
      };

      if (!window.gapi || !window.google.picker) {
        // Fallback or explicit GAPI load
        if (window.gapi) {
          gapi.load('picker', { callback: showPickerUI });
        } else {
          reject('Google Picker scripts not loaded.');
        }
      } else {
        showPickerUI();
      }
    });
  }

  /**
   * Invokes Google Picker UI for Folder selection
   * @returns {Promise<{id: string, name: string}>}
   */
  async openFolderPicker() {
    const token = await this.ensureToken();

    return new Promise((resolve, reject) => {
      const showPickerUI = () => {
        const viewFolders = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
          .setMimeTypes('application/vnd.google-apps.folder')
          .setSelectFolderEnabled(true);

        const picker = new google.picker.PickerBuilder()
          .addView(viewFolders)
          .setOAuthToken(token)
          .setDeveloperKey(this.config.API_KEY)
          .setCallback((data) => {
            if (data.action === google.picker.Action.PICKED) {
              const doc = data.docs[0];
              resolve({ id: doc.id, name: doc.name });
            } else if (data.action === google.picker.Action.CANCEL) {
              reject(new Error('Folder selection cancelled'));
            }
          })
          .build();

        picker.setVisible(true);
      };

      if (!window.gapi || !window.google.picker) {
        if (window.gapi) {
          gapi.load('picker', { callback: showPickerUI });
        } else {
          reject('Google Picker scripts not loaded.');
        }
      } else {
        showPickerUI();
      }
    });
  }

  /**
   * Queries EPUB files inside a specific directory
   * @param {string} folderId
   * @returns {Promise<Array<{id: string, name: string}>>}
   */
  async listFiles(folderId) {
    const token = await this.ensureToken();
    const query = `'${folderId}' in parents and mimeType='application/epub+zip' and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,thumbnailLink)`;

    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error('Failed to query files in folder.');
    const data = await res.json();
    return data.files || [];
  }

  /**
   * Queries ALL EPUB files in the user's Drive for true cloud sync
   * @returns {Promise<Array<{id: string, name: string, thumbnailLink: string}>>}
   */
  async listAllEpubs() {
    const token = await this.ensureToken();
    const query = `mimeType='application/epub+zip' and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,thumbnailLink)`;
    
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error('Failed to query files across Drive.');
    const data = await res.json();
    return data.files || [];
  }

  /**
   * Securely signs the user out
   */


  async signOut() {
    if (this.accessToken) {
      google.accounts.oauth2.revoke(this.accessToken, () => {
        this.accessToken = null;
        this.expiresAt = 0;
      });
    }
  }

  /**
   * Abortable downloader fetching raw ePub data
   * @param {string} fileId
   * @param {AbortSignal} signal
   * @returns {Promise<ArrayBuffer>}
   */
  async fetchFile(fileId, signal) {
    const token = await this.ensureToken();
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal
    });

    if (!response.ok) throw new Error('Error downloading EPUB from Google Drive.');
    return await response.arrayBuffer();
  }
}
export default AuthManager;
