/**
 * Cloud Storage WebApp — Professional Production Module
 * Version: 2.0.0
 * Features: Telegram WebApp integration, offline support, accessibility, error handling
 */

// ===== CONFIGURATION =====
const CONFIG = Object.freeze({
    API_BASE: '/api',
    CACHE_TTL: 60000,           // 1 minute
    AUTO_REFRESH_INTERVAL: 60000,
    TOAST_DURATION: {
        success: 2000,
        error: 3500,
        info: 2500
    },
    FILE_LIMITS: {
        maxNameLength: 200,
        maxNoteLength: 500
    },
    DEBOUNCE: {
        search: 300,
        resize: 150
    }
});

// ===== STATE MANAGEMENT =====
const AppState = {
    user: null,
    initData: '',
    files: [],
    filteredFiles: [],
    currentCategory: 'all',
    sortOrder: 'desc',
    currentFile: null,
    previewFile: null,
    isLoading: false,
    lastFetch: 0,

    // Music Player State
    audio: {
        player: null,
        playlist: [],
        currentIndex: 0,
        isPlaying: false,
        isRepeat: false,
        isShuffle: false,
        volume: 1,
        progressTimer: null
    },

    // Video Player State
    video: {
        player: null,
        controlsTimer: null,
        isFullscreen: false
    },

    // UI State
    toastTimer: null,
    longPressTimer: null,
    resizeTimer: null
};

// ===== DOM ELEMENTS (Cached) =====
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

const Elements = {
    // Main
    app: $('#app'),
    who: $('#who'),
    status: $('#status'),
    statusText: $('#status .status-text'),
    list: $('#list'),
    refresh: $('#refresh'),

    // Stats
    totalFiles: $('#totalFiles'),
    totalSize: $('#totalSize'),
    fileCount: $('#fileCount'),
    fileCountBadge: $('#fileCountBadge'),

    // Controls
    categories: $$('.category-chip'),
    sortBtn: $('#sortBtn'),
    sortText: $('#sortText'),

    // Modals
    modal: $('#modal'),
    previewModal: $('#previewModal'),
    previewBody: $('#previewBody'),
    previewTitle: $('#previewTitle'),

    // Modal Elements
    mName: $('#m_name'),
    mNote: $('#m_note'),
    mMeta: $('#m_meta'),
    saveChanges: $('#saveChanges'),
    sendToBot: $('#sendToBot'),
    close: $('#close'),
    errorSuggestion: $('#errorSuggestion'),
    errorMessage: $('#errorMessage'),
    suggestSendViaBot: $('#suggestSendViaBot'),

    // Preview Elements
    previewClose: $('#previewClose'),
    previewSend: $('#previewSend'),

    // Context Menu
    contextMenu: $('#contextMenu'),

    // Toast
    toast: $('#toast'),
    toastMessage: $('#toast .toast-message')
};

// ===== TELEGRAM WEBAPP INTEGRATION =====
const Telegram = {
    init() {
        const tg = window.Telegram?.WebApp;

        if (!tg) {
            console.warn('⚠️ Telegram WebApp not detected — running in demo mode');
            this.setupDemoMode();
            return false;
        }

        // Initialize WebApp
        tg.ready();
        tg.expand();

        // Theme handling
        this.applyTheme(tg);
        this.watchThemeChanges(tg);

        // Haptic feedback availability
        this.hasHaptics = !!tg.HapticFeedback;

        // Store init data securely
        AppState.initData = tg.initData || '';
        AppState.user = tg.initDataUnsafe?.user || null;

        // Setup viewport for Telegram
        this.setupViewport(tg);

        // Enable closing confirmation
        tg.enableClosingConfirmation();

        // Setup back button for modal navigation
        this.setupBackButton(tg);

        return true;
    },

    applyTheme(tg) {
        const theme = tg.colorScheme || 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        document.body.setAttribute('data-tg-theme', theme);

        // Apply Telegram theme colors if available
        if (tg.themeParams) {
            const root = document.documentElement;
            if (tg.themeParams.bg_color) root.style.setProperty('--bg', tg.themeParams.bg_color);
            if (tg.themeParams.text_color) root.style.setProperty('--text', tg.themeParams.text_color);
            if (tg.themeParams.button_color) root.style.setProperty('--accent', tg.themeParams.button_color);
        }
    },

    watchThemeChanges(tg) {
        // Telegram doesn't emit theme change events, but we can listen for visibility
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && window.Telegram?.WebApp) {
                this.applyTheme(window.Telegram.WebApp);
            }
        });
    },

    setupViewport(tg) {
        // Adjust for Telegram's viewport
        if (tg.viewportHeight) {
            document.documentElement.style.setProperty('--tg-vh', `${tg.viewportHeight}px`);
        }
    },

    setupBackButton(tg) {
        tg.BackButton.onClick(() => {
            if (Elements.previewModal.open || Elements.previewModal.classList.contains('show')) {
                closePreview();
            } else if (Elements.modal.open || Elements.modal.classList.contains('show')) {
                closeModal();
            } else {
                tg.close();
            }
        });
    },

    setupDemoMode() {
        // Demo user for local development
        AppState.user = {
            id: 123456789,
            username: 'demo_user',
            first_name: 'Demo',
            last_name: 'User',
            language_code: 'en'
        };
        AppState.initData = 'demo_init_data';

        // Update UI for demo mode
        if (Elements.statusText) {
            Elements.statusText.textContent = 'Demo mode';
            Elements.statusText.style.color = 'var(--orange)';
        }
    },

    haptic(type = 'light') {
        if (!this.hasHaptics) return;
        const tg = window.Telegram?.WebApp;
        if (!tg?.HapticFeedback) return;

        const types = {
            light: 'impactOccurred',
            medium: 'impactOccurred',
            heavy: 'impactOccurred',
            success: 'notificationOccurred',
            error: 'notificationOccurred',
            warning: 'notificationOccurred'
        };

        const method = types[type] || 'impactOccurred';
        const param = ['success', 'error', 'warning'].includes(type) ? type : 'light';

        try {
            tg.HapticFeedback[method](param);
        } catch (e) {
            console.warn('Haptic feedback failed:', e);
        }
    },

    updateUserUI() {
        const user = AppState.user;
        if (!user) return;

        const name = [user.first_name, user.last_name]
            .filter(Boolean)
            .join(' ')
            .trim() || user.username || 'User';

        if (Elements.who) {
            Elements.who.textContent = name;
            Elements.who.title = name;
        }

        if (Elements.statusText) {
            Elements.statusText.textContent = 'Connected';
            Elements.statusText.style.color = '';
        }

        // Update status dot animation
        const dot = Elements.status?.querySelector('.status-dot');
        if (dot) dot.style.animation = 'pulse-dot 2.5s ease-in-out infinite';
    }
};

// ===== API CLIENT =====
const API = {
    async request(endpoint, options = {}) {
        const url = `${CONFIG.API_BASE}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'X-Telegram-Init-Data': AppState.initData,
            ...options.headers
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal,
                credentials: 'same-origin'
            });

            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(errorText || `HTTP ${response.status}: ${response.statusText}`);
            }

            // Handle empty responses
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                return await response.json();
            }
            return null;

        } catch (error) {
            clearTimeout(timeout);

            if (error.name === 'AbortError') {
                throw new Error('Request timeout — please check your connection');
            }

            console.error(`[API] ${options.method || 'GET'} ${endpoint}:`, error);
            throw error;
        }
    },

    async getFiles() {
        return this.request('/files', { method: 'GET' });
    },

    async updateFile(id, data) {
        return this.request(`/files/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    },

    async sendFile(id) {
        return this.request(`/files/${id}/send`, { method: 'POST' });
    },

    async previewFile(id) {
        // Returns direct URL for preview
        return `${CONFIG.API_BASE}/files/${id}/preview?initData=${encodeURIComponent(AppState.initData)}`;
    }
};

// ===== UTILITIES =====
const Utils = {
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    formatBytes(bytes) {
        if (!bytes && bytes !== 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let size = Math.abs(bytes);

        while (size >= 1024 && i < units.length - 1) {
            size /= 1024;
            i++;
        }

        const formatted = i === 0 ? size.toString() : size.toFixed(1);
        return `${formatted} ${units[i]}`;
    },

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    formatDate(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    },

    formatDateTime(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    getFileType(fileName, kind) {
        const name = (fileName || '').toLowerCase();
        const ext = name.split('.').pop() || '';
        const fileKind = (kind || '').toLowerCase();

        const types = {
            images: {
                exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico', 'heic', 'heif'],
                kinds: ['image', 'photo'],
                icon: 'fa-image',
                color: '#38bdf8'
            },
            videos: {
                exts: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp', 'm4p'],
                kinds: ['video'],
                icon: 'fa-video',
                color: '#fb923c'
            },
            audio: {
                exts: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'opus', 'aiff', 'ape', 'alac', 'm3u'],
                kinds: ['audio', 'voice'],
                icon: 'fa-music',
                color: '#a78bfa'
            },
            documents: {
                exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'rtf', 'odt'],
                kinds: ['document'],
                icon: 'fa-file',
                color: '#6b7280'
            },
            archives: {
                exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'],
                kinds: [],
                icon: 'fa-file-archive',
                color: '#a855f7'
            }
        };

        for (const [category, config] of Object.entries(types)) {
            if (
                config.exts.includes(ext) ||
                config.kinds.some(k => fileKind.includes(k))
            ) {
                return { category, ...config };
            }
        }

        return {
            category: 'documents',
            icon: 'fa-file',
            color: '#6b7280'
        };
    },

    isPreviewable(file) {
        const type = this.getFileType(file.fileName, file.kind);
        return ['images', 'videos', 'audio'].includes(type.category);
    },

    debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func(...args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func(...args);
        };
    },

    throttle(func, limit) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
};

// ===== UI HELPERS =====
const UI = {
    setStatus(text, loading = false) {
        if (!Elements.status) return;

        if (loading) {
            Elements.status.innerHTML = `
        <span class="spinner"></span>
        <span class="status-text">${Utils.escapeHtml(text)}</span>
      `;
        } else {
            Elements.status.innerHTML = `
        <span class="status-dot"></span>
        <span class="status-text">${Utils.escapeHtml(text)}</span>
      `;
        }
    },

    showToast(message, type = 'info', duration) {
        if (!Elements.toast) return;

        // Clear existing toast
        if (AppState.toastTimer) {
            clearTimeout(AppState.toastTimer);
            Elements.toast.classList.remove('show');
        }

        // Configure toast
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-circle-exclamation',
            warning: 'fa-triangle-exclamation',
            info: 'fa-info-circle'
        };

        Elements.toast.innerHTML = `
      <i class="fas ${icons[type] || icons.info}"></i>
      <span class="toast-message">${Utils.escapeHtml(message)}</span>
    `;

        Elements.toast.className = `toast ${type}`;
        Elements.toast.classList.add('show');

        // Auto-hide
        const hideAfter = duration || CONFIG.TOAST_DURATION[type] || CONFIG.TOAST_DURATION.info;
        AppState.toastTimer = setTimeout(() => {
            Elements.toast.classList.remove('show');
        }, hideAfter);

        // Haptic feedback
        if (type === 'success' || type === 'error') {
            Telegram.haptic(type);
        }
    },

    setLoading(element, loading = true) {
        if (!element) return;
        element.disabled = loading;

        if (loading && !element.querySelector('.spinner')) {
            const originalContent = element.innerHTML;
            element.dataset.originalContent = originalContent;
            element.innerHTML = '<span class="spinner"></span>';
        } else if (!loading && element.dataset.originalContent) {
            element.innerHTML = element.dataset.originalContent;
            delete element.dataset.originalContent;
        }
    },

    updateStats(files) {
        const total = files?.length || 0;
        const size = files?.reduce((sum, f) => sum + (f.fileSize || 0), 0) || 0;

        if (Elements.totalFiles) Elements.totalFiles.textContent = total.toLocaleString();
        if (Elements.totalSize) Elements.totalSize.textContent = Utils.formatBytes(size);
        if (Elements.fileCount) Elements.fileCount.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
        if (Elements.fileCountBadge) Elements.fileCountBadge.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
    },

    renderEmptyState(message = 'No files here', icon = 'fa-folder-open', subtext = 'Send files to the bot to see them here') {
        if (!Elements.list) return;

        Elements.list.innerHTML = `
      <div class="empty-state" role="status">
        <div class="empty-state-icon">
          <i class="fas ${icon}"></i>
        </div>
        <div class="empty-state-title">${Utils.escapeHtml(message)}</div>
        ${subtext ? `<div class="empty-state-text">${Utils.escapeHtml(subtext)}</div>` : ''}
      </div>
    `;
    },

    renderFileCard(file, index) {
        const type = Utils.getFileType(file.fileName, file.kind);
        const date = Utils.formatDate(file.createdAt);
        const safeName = Utils.escapeHtml(file.fileName || 'Unnamed');
        const previewable = Utils.isPreviewable(file);

        return `
      <article 
        class="file-card" 
        data-id="${file.id}"
        data-file='${JSON.stringify(file).replace(/'/g, "&#39;")}'
        tabindex="0"
        role="listitem"
        aria-label="${safeName}, ${file.kind || 'file'}, ${Utils.formatBytes(file.fileSize)}"
        style="animation-delay: ${index * 0.03}s"
      >
        <div class="file-header">
          <div class="file-info">
            <div 
              class="file-icon" 
              style="background: ${type.color}18; color: ${type.color}"
              aria-hidden="true"
            >
              <i class="fas ${type.icon}"></i>
            </div>
            <div class="file-details">
              <span class="file-name" title="${safeName}">${safeName}</span>
              <div class="file-meta">
                <span><i class="fas fa-tag"></i>${Utils.escapeHtml(file.kind || 'File')}</span>
                <span><i class="fas fa-database"></i>${Utils.formatBytes(file.fileSize)}</span>
                <span><i class="fas fa-calendar"></i>${date}</span>
              </div>
            </div>
          </div>
          <div class="file-actions">
            ${previewable ? `
              <button 
                class="icon-btn" 
                data-action="preview" 
                data-file-id="${file.id}"
                aria-label="Preview ${safeName}"
                title="Preview"
              >
                <i class="fas fa-eye"></i>
              </button>
            ` : ''}
            <button 
              class="icon-btn primary" 
              data-action="send" 
              data-file-id="${file.id}"
              aria-label="Send ${safeName} via bot"
              title="Send"
            >
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
        ${file.note ? `
          <div class="file-note">
            <i class="fas fa-sticky-note" aria-hidden="true"></i>
            <span>${Utils.escapeHtml(file.note)}</span>
          </div>
        ` : ''}
      </article>
    `;
    },

    renderFiles(files) {
        if (!Elements.list) return;

        if (!files?.length) {
            this.renderEmptyState();
            return;
        }

        Elements.list.innerHTML = files
            .map((file, index) => this.renderFileCard(file, index))
            .join('');

        this.attachFileListeners();
    },

    attachFileListeners() {
        const cards = $$('.file-card', Elements.list);

        cards.forEach(card => {
            const fileId = card.dataset.id;

            // Preview button
            const previewBtn = $('[data-action="preview"]', card);
            if (previewBtn) {
                previewBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const file = AppState.files.find(f => f.id === fileId);
                    if (file) openPreview(file);
                });
            }

            // Send button
            const sendBtn = $('[data-action="send"]', card);
            if (sendBtn) {
                sendBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const file = AppState.files.find(f => f.id === fileId);
                    if (file) sendViaBot(file);
                });
            }

            // Card click → open modal
            card.addEventListener('click', (e) => {
                // Ignore if clicked on action buttons
                if (e.target.closest('[data-action]')) return;

                try {
                    const file = JSON.parse(card.dataset.file.replace(/&#39;/g, "'"));
                    openModal(file);
                } catch (err) {
                    console.error('Failed to parse file data:', err);
                    UI.showToast('Failed to open file details', 'error');
                }
            });

            // Keyboard navigation
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                }
            });

            // Long press for context menu (touch)
            card.addEventListener('touchstart', (e) => {
                AppState.longPressTimer = setTimeout(() => {
                    try {
                        const file = JSON.parse(card.dataset.file.replace(/&#39;/g, "'"));
                        showContextMenu(file, e.touches[0].clientX, e.touches[0].clientY);
                        Telegram.haptic('medium');
                    } catch { }
                }, 500);
            }, { passive: true });

            card.addEventListener('touchend', () => {
                if (AppState.longPressTimer) {
                    clearTimeout(AppState.longPressTimer);
                    AppState.longPressTimer = null;
                }
            });

            card.addEventListener('touchmove', () => {
                if (AppState.longPressTimer) {
                    clearTimeout(AppState.longPressTimer);
                    AppState.longPressTimer = null;
                }
            });

            // Right-click context menu (desktop)
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                try {
                    const file = JSON.parse(card.dataset.file.replace(/&#39;/g, "'"));
                    showContextMenu(file, e.clientX, e.clientY);
                } catch { }
            });
        });
    }
};

// ===== CONTEXT MENU =====
function showContextMenu(file, x, y) {
    AppState.currentFile = file;
    const menu = Elements.contextMenu;

    if (!menu) return;

    // Calculate position with bounds checking
    const menuWidth = 200;
    const menuHeight = 150;
    const padding = 10;

    let left = Math.min(x, window.innerWidth - menuWidth - padding);
    let top = Math.min(y, window.innerHeight - menuHeight - padding);

    left = Math.max(padding, left);
    top = Math.max(padding, top);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.classList.add('show');

    // Close on outside click
    const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
            hideContextMenu();
            document.removeEventListener('click', closeHandler);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', closeHandler);
    }, 100);
}

function hideContextMenu() {
    if (Elements.contextMenu) {
        Elements.contextMenu.classList.remove('show');
    }
    AppState.currentFile = null;
}

// Context menu actions
Elements.contextMenu?.addEventListener('click', (e) => {
    const action = e.target.closest('.context-item')?.dataset.action;
    const file = AppState.currentFile;

    if (!action || !file) {
        hideContextMenu();
        return;
    }

    hideContextMenu();

    switch (action) {
        case 'preview':
            openPreview(file);
            break;
        case 'send':
            sendViaBot(file);
            break;
        case 'edit':
            openModal(file);
            break;
    }
});

// ===== MODAL FUNCTIONS =====
function openModal(file) {
    AppState.currentFile = file;

    // Populate form
    if (Elements.mName) {
        Elements.mName.value = file.fileName || '';
        Elements.mName.maxLength = CONFIG.FILE_LIMITS.maxNameLength;
    }

    if (Elements.mNote) {
        Elements.mNote.value = file.note || '';
        Elements.mNote.maxLength = CONFIG.FILE_LIMITS.maxNoteLength;
    }

    // Populate metadata
    if (Elements.mMeta) {
        const date = Utils.formatDateTime(file.createdAt);
        Elements.mMeta.innerHTML = `
      <div class="meta-item">
        <span class="meta-label"><i class="fas fa-tag"></i>Type</span>
        <span class="meta-value">${Utils.escapeHtml(file.kind || 'Unknown')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label"><i class="fas fa-database"></i>Size</span>
        <span class="meta-value">${Utils.formatBytes(file.fileSize)}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label"><i class="fas fa-calendar"></i>Created</span>
        <span class="meta-value">${date}</span>
      </div>
    `;
    }

    // Hide error suggestion
    if (Elements.errorSuggestion) {
        Elements.errorSuggestion.style.display = 'none';
    }

    // Show modal
    if (Elements.modal) {
        Elements.modal.classList.add('show');
        Elements.modal.setAttribute('open', '');
    }

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Update Telegram back button
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.show();
    }

    // Focus first input
    setTimeout(() => {
        Elements.mName?.focus();
    }, 100);
}

function closeModal() {
    if (Elements.modal) {
        Elements.modal.classList.remove('show');
        Elements.modal.removeAttribute('open');
    }

    document.body.style.overflow = '';
    AppState.currentFile = null;

    // Hide error suggestion
    if (Elements.errorSuggestion) {
        Elements.errorSuggestion.style.display = 'none';
    }

    // Reset Telegram back button
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.hide();
    }
}

async function saveFileChanges(fileId, fileName, note) {
    if (!fileId) return;

    // Validation
    if (!fileName?.trim()) {
        UI.showToast('File name cannot be empty', 'error');
        return;
    }

    try {
        UI.setLoading(Elements.saveChanges, true);

        const result = await API.updateFile(fileId, {
            fileName: fileName.trim().slice(0, CONFIG.FILE_LIMITS.maxNameLength),
            note: note?.trim().slice(0, CONFIG.FILE_LIMITS.maxNoteLength) || ''
        });

        if (result?.ok) {
            UI.showToast('Changes saved', 'success');
            closeModal();
            await loadFiles(true); // Refresh with cache bypass
        } else {
            throw new Error(result?.error || 'Failed to save changes');
        }

    } catch (error) {
        console.error('Save failed:', error);
        UI.showToast('Failed to save changes', 'error');

        // Show error suggestion
        if (Elements.errorSuggestion && Elements.errorMessage) {
            Elements.errorMessage.textContent = error.message;
            Elements.errorSuggestion.style.display = 'flex';
        }

        Telegram.haptic('error');

    } finally {
        UI.setLoading(Elements.saveChanges, false);
    }
}

// ===== PREVIEW FUNCTIONS =====
function openPreview(file) {
    AppState.previewFile = file;

    if (Elements.previewTitle) {
        Elements.previewTitle.textContent = file.fileName || 'Preview';
    }

    const type = Utils.getFileType(file.fileName, file.kind);
    const previewUrl = API.previewFile(file.id);

    // Clear previous content
    if (Elements.previewBody) {
        Elements.previewBody.innerHTML = '';
        Elements.previewBody.style.background = '';
    }

    // Render based on type
    switch (type.category) {
        case 'audio':
            buildMusicPlayer(file, previewUrl);
            break;
        case 'videos':
            buildVideoPlayer(file, previewUrl);
            break;
        case 'images':
            buildImageViewer(file, previewUrl);
            break;
        default:
            UI.showToast('Preview not available for this file type', 'info');
            return;
    }

    // Show modal
    if (Elements.previewModal) {
        Elements.previewModal.classList.add('show');
        Elements.previewModal.setAttribute('open', '');
    }

    document.body.style.overflow = 'hidden';

    // Update Telegram back button
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.show();
    }

    Telegram.haptic('light');
}

function closePreview() {
    // Cleanup audio
    if (AppState.audio.player) {
        AppState.audio.player.pause();
        AppState.audio.player.src = '';
        AppState.audio.player = null;
    }
    if (AppState.audio.progressTimer) {
        clearInterval(AppState.audio.progressTimer);
        AppState.audio.progressTimer = null;
    }

    // Cleanup video
    if (AppState.video.player) {
        AppState.video.player.pause();
        AppState.video.player.src = '';
        AppState.video.player = null;
    }
    if (AppState.video.controlsTimer) {
        clearTimeout(AppState.video.controlsTimer);
        AppState.video.controlsTimer = null;
    }

    // Hide modal
    if (Elements.previewModal) {
        Elements.previewModal.classList.remove('show');
        Elements.previewModal.removeAttribute('open');
    }

    if (Elements.previewBody) {
        Elements.previewBody.innerHTML = '';
    }

    document.body.style.overflow = '';
    AppState.previewFile = null;
    AppState.audio.isPlaying = false;

    // Reset Telegram back button
    if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.hide();
    }
}

function buildImageViewer(file, url) {
    if (!Elements.previewBody) return;

    Elements.previewBody.innerHTML = `
    <div class="img-preview-wrap">
      <img 
        src="${url}" 
        alt="${Utils.escapeHtml(file.fileName || 'Image')}" 
        loading="eager"
        fetchpriority="high"
        onerror="this.style.display='none';this.nextElementSibling?.style?.setProperty('display','flex')"
        onload="this.classList.add('loaded')"
      >
      <div style="display:none;flex-direction:column;align-items:center;gap:12px;color:var(--text3);">
        <i class="fas fa-image" style="font-size:48px"></i>
        <span>Failed to load image</span>
        <button class="btn btn-small btn-secondary" onclick="window.location.reload()">
          <i class="fas fa-sync-alt"></i> Retry
        </button>
      </div>
    </div>
  `;
}

// ===== MUSIC PLAYER =====
function buildMusicPlayer(file, url) {
    // Get all audio files for playlist
    const audioFiles = AppState.files.filter(f =>
        Utils.getFileType(f.fileName, f.kind).category === 'audio'
    );

    const startIndex = audioFiles.findIndex(f => f.id === file.id);

    AppState.audio.playlist = audioFiles;
    AppState.audio.currentIndex = Math.max(0, startIndex);
    AppState.audio.isPlaying = false;

    if (!Elements.previewBody) return;

    Elements.previewBody.innerHTML = `
    <div class="music-player-wrap" id="mpWrap">
      <div class="music-player-bg"></div>
      <div class="music-player-content">
        
        <!-- Album Art -->
        <div class="mp-art-section">
          <div class="mp-art paused" id="mpArt">
            <div class="mp-art-inner">
              <i class="fas fa-music mp-art-icon" id="mpArtIcon"></i>
            </div>
          </div>
          <div class="mp-track-info">
            <div class="mp-title" id="mpTitle" title="${Utils.escapeHtml(file.fileName)}">
              ${Utils.escapeHtml(file.fileName || 'Unknown')}
            </div>
            <div class="mp-subtitle" id="mpSubtitle">AUDIO</div>
          </div>
        </div>
        
        <!-- Progress -->
        <div class="mp-progress-section">
          <div class="mp-time-row">
            <span id="mpCurrent">0:00</span>
            <span id="mpTotal">0:00</span>
          </div>
          <div class="mp-progress-bar" id="mpProgressBar" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
            <div class="mp-progress-fill" id="mpProgressFill" style="width:0%"></div>
          </div>
        </div>
        
        <!-- Controls -->
        <div class="mp-controls">
          <button class="mp-btn mp-btn-sm" id="mpPrev" aria-label="Previous track" title="Previous">
            <i class="fas fa-backward-step"></i>
          </button>
          <button class="mp-btn mp-btn-lg" id="mpPlay" aria-label="Play/Pause" title="Play/Pause">
            <i class="fas fa-play" id="mpPlayIcon"></i>
          </button>
          <button class="mp-btn mp-btn-sm" id="mpNext" aria-label="Next track" title="Next">
            <i class="fas fa-forward-step"></i>
          </button>
        </div>
        
        <!-- Volume & Options -->
        <div class="mp-extra-row">
          <i class="fas fa-volume-high mp-vol-icon" id="mpVolIcon"></i>
          <input 
            type="range" 
            class="mp-volume" 
            id="mpVolume" 
            min="0" 
            max="1" 
            step="0.01" 
            value="1"
            aria-label="Volume"
          >
          <button class="mp-option-btn" id="mpShuffle" aria-label="Toggle shuffle" title="Shuffle">
            <i class="fas fa-shuffle"></i>
          </button>
          <button class="mp-option-btn" id="mpRepeat" aria-label="Toggle repeat" title="Repeat">
            <i class="fas fa-repeat"></i>
          </button>
        </div>
        
        <!-- Playlist (if multiple tracks) -->
        ${audioFiles.length > 1 ? `
          <div class="mp-playlist">
            <div class="mp-playlist-title">Playlist · ${audioFiles.length} tracks</div>
            <div id="mpPlaylistItems" role="listbox" aria-label="Audio playlist"></div>
          </div>
        ` : ''}
        
      </div>
    </div>
  `;

    initMusicPlayer();
}

function initMusicPlayer() {
    const p = AppState.audio;

    // Cache DOM elements
    const els = {
        play: $('#mpPlay'),
        playIcon: $('#mpPlayIcon'),
        prev: $('#mpPrev'),
        next: $('#mpNext'),
        art: $('#mpArt'),
        title: $('#mpTitle'),
        subtitle: $('#mpSubtitle'),
        current: $('#mpCurrent'),
        total: $('#mpTotal'),
        progressBar: $('#mpProgressBar'),
        progressFill: $('#mpProgressFill'),
        volume: $('#mpVolume'),
        volIcon: $('#mpVolIcon'),
        shuffle: $('#mpShuffle'),
        repeat: $('#mpRepeat'),
        playlist: $('#mpPlaylistItems')
    };

    function loadTrack(index) {
        if (index < 0 || index >= p.playlist.length) return;

        p.currentIndex = index;
        const file = p.playlist[index];
        const url = API.previewFile(file.id);

        // Cleanup previous
        if (p.player) {
            p.player.pause();
            p.player.src = '';
        }
        if (p.progressTimer) {
            clearInterval(p.progressTimer);
        }

        // Create new audio element
        p.player = new Audio();
        p.player.volume = p.volume;
        p.player.src = url;
        p.player.preload = 'auto';

        // Update UI
        if (els.title) {
            els.title.textContent = file.fileName || 'Unknown';
            els.title.title = file.fileName;
        }
        if (els.subtitle) {
            const ext = (file.fileName?.split('.').pop() || 'AUDIO').toUpperCase();
            els.subtitle.textContent = ext;
        }
        if (els.current) els.current.textContent = '0:00';
        if (els.total) els.total.textContent = '0:00';
        if (els.progressFill) els.progressFill.style.width = '0%';

        // Event listeners
        p.player.addEventListener('loadedmetadata', () => {
            if (els.total) {
                els.total.textContent = Utils.formatTime(p.player.duration);
            }
            if (els.progressBar) {
                els.progressBar.setAttribute('aria-valuemax', Math.floor(p.player.duration));
            }
        });

        p.player.addEventListener('timeupdate', () => {
            if (!p.player?.duration) return;

            const pct = (p.player.currentTime / p.player.duration) * 100;
            if (els.progressFill) {
                els.progressFill.style.width = `${pct}%`;
            }
            if (els.current) {
                els.current.textContent = Utils.formatTime(p.player.currentTime);
            }
            if (els.progressBar) {
                els.progressBar.setAttribute('aria-valuenow', Math.floor(p.player.currentTime));
            }
        });

        p.player.addEventListener('ended', () => {
            if (p.isRepeat) {
                p.player.currentTime = 0;
                p.player.play();
            } else if (p.isShuffle) {
                const nextIdx = Math.floor(Math.random() * p.playlist.length);
                loadTrack(nextIdx);
                if (p.isPlaying) autoPlay();
            } else if (p.currentIndex < p.playlist.length - 1) {
                loadTrack(p.currentIndex + 1);
                if (p.isPlaying) autoPlay();
            } else {
                // End of playlist
                p.isPlaying = false;
                updatePlayUI();
                if (els.art) els.art.className = 'mp-art paused';
            }
        });

        p.player.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            UI.showToast('Cannot play this audio file', 'error');
            Telegram.haptic('error');
        });

        // Progress timer fallback
        p.progressTimer = setInterval(() => {
            if (p.player && !p.player.paused && p.player.duration) {
                const pct = (p.player.currentTime / p.player.duration) * 100;
                if (els.progressFill) {
                    els.progressFill.style.width = `${pct}%`;
                }
                if (els.current) {
                    els.current.textContent = Utils.formatTime(p.player.currentTime);
                }
            }
        }, 250);

        updatePlaylistUI();
    }

    function autoPlay() {
        setTimeout(() => {
            if (p.player) {
                p.player.play().catch(err => {
                    console.warn('Autoplay failed:', err);
                    UI.showToast('Tap play to start', 'info');
                });
                p.isPlaying = true;
                updatePlayUI();
                if (els.art) els.art.className = 'mp-art playing';
            }
        }, 100);
    }

    function updatePlayUI() {
        if (els.playIcon) {
            els.playIcon.className = p.isPlaying ? 'fas fa-pause' : 'fas fa-play';
        }
    }

    function updatePlaylistUI() {
        if (!els.playlist) return;

        els.playlist.innerHTML = p.playlist.map((f, i) => {
            const type = Utils.getFileType(f.fileName, f.kind);
            const isActive = i === p.currentIndex;

            return `
        <div 
          class="mp-pl-item ${isActive ? 'active' : ''}" 
          data-pl-idx="${i}"
          role="option"
          aria-selected="${isActive}"
          tabindex="${isActive ? 0 : -1}"
        >
          <span class="mp-pl-num">
            ${isActive ? '<i class="fas fa-volume-up" style="font-size:10px"></i>' : i + 1}
          </span>
          <div class="mp-pl-icon" style="background:${type.color}18;color:${type.color}">
            <i class="fas ${type.icon}"></i>
          </div>
          <span class="mp-pl-name" title="${Utils.escapeHtml(f.fileName)}">
            ${Utils.escapeHtml((f.fileName || 'Unknown').replace(/[<>]/g, ''))}
          </span>
          <span class="mp-pl-dur">${Utils.formatBytes(f.fileSize)}</span>
        </div>
      `;
        }).join('');

        // Attach playlist item listeners
        els.playlist.querySelectorAll('.mp-pl-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.plIdx);
                loadTrack(idx);
                if (p.isPlaying) autoPlay();
                Telegram.haptic('light');
            });

            // Keyboard support
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    item.click();
                }
            });
        });
    }

    // Seek functionality
    function seek(e) {
        if (!p.player?.duration) return;

        const rect = els.progressBar?.getBoundingClientRect();
        if (!rect) return;

        const clientX = e.clientX || e.touches?.[0]?.clientX;
        if (!clientX) return;

        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        p.player.currentTime = pct * p.player.duration;
    }

    if (els.progressBar) {
        els.progressBar.addEventListener('click', seek);
        els.progressBar.addEventListener('touchstart', seek, { passive: true });

        // Keyboard seek
        els.progressBar.addEventListener('keydown', (e) => {
            if (!p.player?.duration) return;
            const step = e.shiftKey ? 10 : 5;
            if (e.key === 'ArrowLeft') {
                p.player.currentTime = Math.max(0, p.player.currentTime - step);
            } else if (e.key === 'ArrowRight') {
                p.player.currentTime = Math.min(p.player.duration, p.player.currentTime + step);
            }
        });
    }

    // Play/Pause
    if (els.play) {
        els.play.addEventListener('click', () => {
            if (!p.player) return;

            if (p.isPlaying) {
                p.player.pause();
                p.isPlaying = false;
                if (els.art) els.art.className = 'mp-art paused';
            } else {
                p.player.play().catch(err => {
                    console.warn('Play failed:', err);
                    UI.showToast('Playback failed', 'error');
                });
                p.isPlaying = true;
                if (els.art) els.art.className = 'mp-art playing';
            }

            updatePlayUI();
            Telegram.haptic('light');
        });
    }

    // Previous/Next
    if (els.prev) {
        els.prev.addEventListener('click', () => {
            const prev = p.isShuffle
                ? Math.floor(Math.random() * p.playlist.length)
                : Math.max(0, p.currentIndex - 1);
            loadTrack(prev);
            if (p.isPlaying) autoPlay();
            Telegram.haptic('light');
        });
    }

    if (els.next) {
        els.next.addEventListener('click', () => {
            const next = p.isShuffle
                ? Math.floor(Math.random() * p.playlist.length)
                : Math.min(p.playlist.length - 1, p.currentIndex + 1);
            loadTrack(next);
            if (p.isPlaying) autoPlay();
            Telegram.haptic('light');
        });
    }

    // Volume
    if (els.volume) {
        els.volume.addEventListener('input', () => {
            p.volume = parseFloat(els.volume.value);
            if (p.player) p.player.volume = p.volume;

            // Update icon
            if (els.volIcon) {
                if (p.volume === 0) {
                    els.volIcon.className = 'fas fa-volume-xmark';
                } else if (p.volume < 0.5) {
                    els.volIcon.className = 'fas fa-volume-low';
                } else {
                    els.volIcon.className = 'fas fa-volume-high';
                }
            }
        });
    }

    // Shuffle/Repeat
    if (els.shuffle) {
        els.shuffle.addEventListener('click', () => {
            p.isShuffle = !p.isShuffle;
            els.shuffle.classList.toggle('active', p.isShuffle);
            Telegram.haptic('light');
        });
    }

    if (els.repeat) {
        els.repeat.addEventListener('click', () => {
            p.isRepeat = !p.isRepeat;
            els.repeat.classList.toggle('active', p.isRepeat);
            Telegram.haptic('light');
        });
    }

    // Initialize
    loadTrack(p.currentIndex);
    if (p.playlist.length > 0) {
        autoPlay();
    }
}

// ===== VIDEO PLAYER =====
function buildVideoPlayer(file, url) {
    if (!Elements.previewBody) return;

    // Set background for video
    Elements.previewBody.style.background = '#000';

    Elements.previewBody.innerHTML = `
    <div id="vpWrap" class="video-player-wrap">
      <div id="vpMain" class="video-main">
        <video 
          id="vpVideo"
          playsinline
          webkit-playsinline
          preload="auto"
          aria-label="${Utils.escapeHtml(file.fileName || 'Video')}"
        >
          <source src="${url}" type="video/mp4">
          <source src="${url}">
          Your browser does not support video playback.
        </video>
        
        <!-- Center play button -->
        <div class="video-center-play" id="vpCenterPlay">
          <i class="fas fa-play"></i>
        </div>
        
        <!-- Controls overlay -->
        <div class="video-overlay" id="vpOverlay">
          <div class="video-controls">
            <div class="video-progress-wrap">
              <div class="video-time-row">
                <span id="vpCurrent">0:00</span>
                <span id="vpTotal">0:00</span>
              </div>
              <input 
                type="range" 
                id="vpSeekbar" 
                class="video-seekbar"
                min="0" 
                max="1000" 
                step="1" 
                value="0"
                aria-label="Seek"
              >
            </div>
            <div class="video-btn-row">
              <button id="vpPlay" class="vid-btn play-btn" aria-label="Play/Pause">
                <i class="fas fa-play" id="vpPlayIcon"></i>
              </button>
              <button id="vpMute" class="vid-btn" aria-label="Mute/Unmute">
                <i class="fas fa-volume-high" id="vpMuteIcon"></i>
              </button>
              <input 
                type="range" 
                id="vpVolume" 
                class="vid-volume"
                min="0" 
                max="1" 
                step="0.02" 
                value="1"
                aria-label="Volume"
              >
              <span class="vid-spacer"></span>
              <span id="vpResInfo" class="vid-info"></span>
              <button id="vpFullscreen" class="vid-btn" aria-label="Toggle fullscreen">
                <i class="fas fa-expand" id="vpFsIcon"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

    initVideoPlayer(file);
}

function initVideoPlayer(file) {
    const wrap = $('#vpWrap');
    const vid = $('#vpVideo');
    const overlay = $('#vpOverlay');
    const main = $('#vpMain');

    if (!vid) return;

    AppState.video.player = vid;

    // Cache controls
    const controls = {
        play: $('#vpPlay'),
        playIcon: $('#vpPlayIcon'),
        mute: $('#vpMute'),
        muteIcon: $('#vpMuteIcon'),
        volume: $('#vpVolume'),
        current: $('#vpCurrent'),
        total: $('#vpTotal'),
        seekbar: $('#vpSeekbar'),
        fullscreen: $('#vpFullscreen'),
        fsIcon: $('#vpFsIcon'),
        resInfo: $('#vpResInfo'),
        centerPlay: $('#vpCenterPlay')
    };

    let controlsTimer = null;
    let wasPlayingBeforeSeek = false;

    function showControls() {
        if (!overlay) return;
        overlay.style.opacity = '1';
        wrap?.classList.add('controls-visible');

        clearTimeout(controlsTimer);
        if (!vid?.paused) {
            controlsTimer = setTimeout(() => {
                if (vid?.paused) return;
                overlay.style.opacity = '0';
                wrap?.classList.remove('controls-visible');
            }, 3500);
        }
    }

    function hideControls() {
        if (!vid?.paused && overlay) {
            overlay.style.opacity = '0';
            wrap?.classList.remove('controls-visible');
        }
    }

    function updatePlayUI() {
        if (controls.playIcon) {
            controls.playIcon.className = vid?.paused ? 'fas fa-play' : 'fas fa-pause';
        }
        if (controls.centerPlay) {
            controls.centerPlay.style.display = vid?.paused ? 'flex' : 'none';
        }
    }

    // Video events
    vid.addEventListener('loadedmetadata', () => {
        if (controls.total) {
            controls.total.textContent = Utils.formatTime(vid.duration);
        }
        if (controls.seekbar) {
            controls.seekbar.max = 1000;
        }
        if (controls.resInfo && vid.videoWidth && vid.videoHeight) {
            controls.resInfo.textContent = `${vid.videoWidth}×${vid.videoHeight}`;
        }
    });

    vid.addEventListener('timeupdate', () => {
        if (controls.current) {
            controls.current.textContent = Utils.formatTime(vid.currentTime);
        }
        if (vid.duration && controls.seekbar) {
            controls.seekbar.value = (vid.currentTime / vid.duration) * 1000;
        }
    });

    vid.addEventListener('ended', () => {
        updatePlayUI();
        showControls();
    });

    vid.addEventListener('error', (e) => {
        console.error('Video error:', e);
        UI.showToast('Cannot play this video', 'error');
        Telegram.haptic('error');
    });

    vid.addEventListener('play', updatePlayUI);
    vid.addEventListener('pause', () => {
        updatePlayUI();
        showControls();
    });

    // Play/Pause
    function togglePlay() {
        if (!vid) return;

        if (vid.paused) {
            vid.play().catch(err => {
                console.error('Play failed:', err);
                UI.showToast('Playback failed', 'error');
            });
        } else {
            vid.pause();
        }
        showControls();
    }

    if (controls.play) {
        controls.play.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlay();
        });
    }

    if (controls.centerPlay) {
        controls.centerPlay.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlay();
        });
    }

    // Click on video to toggle controls
    if (main) {
        main.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            showControls();
        });

        main.addEventListener('touchstart', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            showControls();
        }, { passive: true });
    }

    // Mute/Volume
    if (controls.mute) {
        controls.mute.addEventListener('click', (e) => {
            e.stopPropagation();
            vid.muted = !vid.muted;
            if (controls.muteIcon) {
                controls.muteIcon.className = vid.muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
            }
        });
    }

    if (controls.volume) {
        controls.volume.addEventListener('input', (e) => {
            e.stopPropagation();
            vid.volume = parseFloat(controls.volume.value);
            vid.muted = vid.volume === 0;
            if (controls.muteIcon) {
                controls.muteIcon.className = vid.muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
            }
        });
    }

    // Seek
    function seek(e) {
        if (!vid?.duration) return;

        const rect = controls.seekbar?.getBoundingClientRect();
        if (!rect) return;

        const clientX = e.clientX || e.touches?.[0]?.clientX;
        if (!clientX) return;

        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        wasPlayingBeforeSeek = !vid.paused;
        vid.pause();
        vid.currentTime = pct * vid.duration;
    }

    if (controls.seekbar) {
        controls.seekbar.addEventListener('input', seek);
        controls.seekbar.addEventListener('touchstart', seek, { passive: true });

        controls.seekbar.addEventListener('change', () => {
            if (wasPlayingBeforeSeek && vid) {
                vid.play();
            }
        });
    }

    // Fullscreen
    if (controls.fullscreen) {
        controls.fullscreen.addEventListener('click', (e) => {
            e.stopPropagation();

            const target = main;
            if (!target) return;

            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                (target.requestFullscreen?.() || target.webkitRequestFullscreen?.())?.();
                if (controls.fsIcon) controls.fsIcon.className = 'fas fa-compress';
                AppState.video.isFullscreen = true;
            } else {
                (document.exitFullscreen?.() || document.webkitExitFullscreen?.())?.();
                if (controls.fsIcon) controls.fsIcon.className = 'fas fa-expand';
                AppState.video.isFullscreen = false;
            }
        });
    }

    // Fullscreen change listener
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (controls.fsIcon) controls.fsIcon.className = 'fas fa-expand';
            AppState.video.isFullscreen = false;
        }
    });

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (!Elements.previewModal?.classList.contains('show')) return;

        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (vid) vid.currentTime = Math.max(0, vid.currentTime - 5);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (vid) vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 5);
                break;
            case 'm':
                e.preventDefault();
                if (vid) {
                    vid.muted = !vid.muted;
                    if (controls.muteIcon) {
                        controls.muteIcon.className = vid.muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
                    }
                }
                break;
            case 'f':
                e.preventDefault();
                controls.fullscreen?.click();
                break;
            case 'Escape':
                if (AppState.video.isFullscreen) {
                    e.preventDefault();
                    controls.fullscreen?.click();
                }
                break;
        }
    });

    // Prevent overlay clicks from bubbling
    overlay?.addEventListener('click', e => e.stopPropagation());

    // Auto-play with retry
    showControls();
    vid.play?.().catch(err => {
        console.warn('Video autoplay blocked:', err);
        updatePlayUI();
        showControls();
    });
}

// ===== FILE OPERATIONS =====
async function sendViaBot(file) {
    if (!file?.id) return;

    try {
        UI.showToast('Sending...', 'info', 1500);

        const result = await API.sendFile(file.id);

        if (result?.ok) {
            UI.showToast('Sent successfully', 'success');
            Telegram.haptic('success');
        } else {
            throw new Error(result?.error || 'Failed to send');
        }

    } catch (error) {
        console.error('Send failed:', error);
        UI.showToast('Failed to send file', 'error');
        Telegram.haptic('error');
    }
}

// ===== DATA LOADING =====
async function loadFiles(forceRefresh = false) {
    // Rate limiting
    const now = Date.now();
    if (!forceRefresh && now - AppState.lastFetch < CONFIG.CACHE_TTL) {
        return;
    }

    if (AppState.isLoading) return;

    AppState.isLoading = true;
    UI.setStatus('Loading...', true);

    if (Elements.refresh) {
        Elements.refresh.disabled = true;
    }

    try {
        const files = await API.getFiles();

        if (!Array.isArray(files)) {
            throw new Error('Invalid response format');
        }

        AppState.files = files;
        AppState.lastFetch = now;

        // Update UI
        UI.updateStats(files);
        filterAndRenderFiles();

        UI.setStatus('Updated');

        // Success toast on first load only
        if (AppState.files.length > 0) {
            UI.showToast(`Loaded ${files.length} file${files.length !== 1 ? 's' : ''}`, 'success', 1800);
        }

    } catch (error) {
        console.error('Failed to load files:', error);
        UI.setStatus('Error');

        UI.renderEmptyState(
            'Failed to load files',
            'fa-exclamation-triangle',
            error.message || 'Please check your connection and try again'
        );

        UI.showToast('Failed to load files', 'error');

    } finally {
        AppState.isLoading = false;

        if (Elements.refresh) {
            Elements.refresh.disabled = false;
        }
    }
}

function filterAndRenderFiles() {
    let filtered = [...AppState.files];

    // Category filter
    if (AppState.currentCategory !== 'all') {
        filtered = filtered.filter(file => {
            const type = Utils.getFileType(file.fileName, file.kind);
            return type.category === AppState.currentCategory;
        });
    }

    // Sort
    filtered.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return AppState.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    AppState.filteredFiles = filtered;
    UI.renderFiles(filtered);
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Refresh button
    Elements.refresh?.addEventListener('click', () => {
        loadFiles(true);
        Telegram.haptic('light');
    });

    // Category chips
    Elements.categories.forEach(chip => {
        chip.addEventListener('click', () => {
            // Update active state
            Elements.categories.forEach(c => {
                c.classList.remove('active');
                c.setAttribute('aria-selected', 'false');
            });
            chip.classList.add('active');
            chip.setAttribute('aria-selected', 'true');

            // Update state and re-render
            AppState.currentCategory = chip.dataset.category;
            filterAndRenderFiles();

            Telegram.haptic('light');
        });
    });

    // Sort button
    Elements.sortBtn?.addEventListener('click', () => {
        AppState.sortOrder = AppState.sortOrder === 'desc' ? 'asc' : 'desc';

        if (Elements.sortText) {
            Elements.sortText.textContent = AppState.sortOrder === 'desc' ? 'Latest' : 'Oldest';
        }

        // Update icon
        const icon = Elements.sortBtn?.querySelector('i');
        if (icon) {
            icon.className = AppState.sortOrder === 'desc'
                ? 'fas fa-arrow-down-wide-short'
                : 'fas fa-arrow-up-wide-short';
        }

        filterAndRenderFiles();
        Telegram.haptic('light');
    });

    // Modal close buttons
    Elements.close?.addEventListener('click', closeModal);
    Elements.previewClose?.addEventListener('click', closePreview);

    // Modal backdrop click
    Elements.modal?.addEventListener('click', (e) => {
        if (e.target === Elements.modal) closeModal();
    });

    Elements.previewModal?.addEventListener('click', (e) => {
        if (e.target === Elements.previewModal) closePreview();
    });

    // Save changes
    Elements.saveChanges?.addEventListener('click', () => {
        if (!AppState.currentFile?.id) return;

        const fileName = Elements.mName?.value?.trim();
        const note = Elements.mNote?.value?.trim();

        saveFileChanges(AppState.currentFile.id, fileName, note);
    });

    // Send from modal
    Elements.sendToBot?.addEventListener('click', () => {
        if (AppState.currentFile) {
            sendViaBot(AppState.currentFile);
            closeModal();
        }
    });

    Elements.suggestSendViaBot?.addEventListener('click', () => {
        if (AppState.currentFile) {
            sendViaBot(AppState.currentFile);
            closeModal();
        }
    });

    // Send from preview
    Elements.previewSend?.addEventListener('click', () => {
        if (AppState.previewFile) {
            sendViaBot(AppState.previewFile);
            closePreview();
        }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        // Escape closes modals
        if (e.key === 'Escape') {
            if (Elements.previewModal?.classList.contains('show')) {
                closePreview();
            } else if (Elements.modal?.classList.contains('show')) {
                closeModal();
            } else if (Elements.contextMenu?.classList.contains('show')) {
                hideContextMenu();
            }
        }

        // Space toggles music playback
        if (e.key === ' ' && Elements.previewModal?.classList.contains('show')) {
            const audio = AppState.audio;
            if (audio.player && !e.target.closest('input, textarea')) {
                e.preventDefault();
                if (audio.isPlaying) {
                    audio.player.pause();
                    audio.isPlaying = false;
                } else {
                    audio.player.play();
                    audio.isPlaying = true;
                }
                const icon = $('#mpPlayIcon');
                const art = $('#mpArt');
                if (icon) icon.className = audio.isPlaying ? 'fas fa-pause' : 'fas fa-play';
                if (art) art.className = `mp-art ${audio.isPlaying ? 'playing' : 'paused'}`;
            }
        }
    });

    // Handle visibility change (pause media when tab hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (AppState.audio.player?.playing) {
                AppState.audio.player.pause();
            }
            if (AppState.video.player?.playing) {
                AppState.video.player.pause();
            }
        }
    });

    // Resize handler (debounced)
    const handleResize = Utils.debounce(() => {
        // Could adjust UI for different screen sizes here
    }, CONFIG.DEBOUNCE.resize);

    window.addEventListener('resize', handleResize);
}

// ===== INITIALIZATION =====
async function init() {
    try {
        // Initialize Telegram
        Telegram.init();

        // Update user UI
        if (AppState.user) {
            Telegram.updateUserUI();
        }

        // Setup event listeners
        setupEventListeners();

        // Load files
        await loadFiles();

        // Auto-refresh
        setInterval(() => {
            if (document.visibilityState === 'visible') {
                loadFiles();
            }
        }, CONFIG.AUTO_REFRESH_INTERVAL);

        console.log('✅ Cloud Storage WebApp initialized');

    } catch (error) {
        console.error('❌ Initialization failed:', error);
        UI.setStatus('Initialization failed', false);
        UI.showToast('Failed to initialize app', 'error');
    }
}

// ===== EXPORT FOR GLOBAL ACCESS (if needed) =====
// Only for debugging in development
if (process.env?.NODE_ENV === 'development') {
    window.CloudApp = {
        state: AppState,
        api: API,
        utils: Utils,
        loadFiles: () => loadFiles(true)
    };
}

// ===== START =====
// Wait for DOM and Telegram SDK
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // Defer slightly to ensure Telegram SDK is ready
    setTimeout(init, 50);
}