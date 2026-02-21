// app.js - Full featured Telegram Web App with Font Awesome
(function () {
    const tg = window.Telegram?.WebApp;
    let initData = "";
    let user = null;

    // Telegram initialization
    if (tg) {
        tg.ready();
        tg.expand();
        tg.enableClosingConfirmation();
        initData = tg.initData || "";
        user = tg.initDataUnsafe?.user;

        if (tg.colorScheme) {
            document.body.setAttribute('data-tg-theme', tg.colorScheme);
        }

        // Main button for upload
        tg.MainButton.setText('📤 Upload File');
        tg.MainButton.onClick(() => {
            showToast('Upload feature coming soon!', 'info');
        });
        tg.MainButton.show();
    } else {
        // Test mode
        console.log("Not in Telegram - running in test mode");
        initData = "test_init_data";
        user = {
            id: "123456789",
            username: "test_user",
            first_name: "Test",
            last_name: "User"
        };
    }

    // DOM Elements
    const elements = {
        who: document.getElementById("who"),
        status: document.getElementById("status"),
        list: document.getElementById("list"),
        modal: document.getElementById("modal"),
        close: document.getElementById("close"),
        sendToBot: document.getElementById("sendToBot"),
        download: document.getElementById("download"),
        mName: document.getElementById("m_name"),
        mNote: document.getElementById("m_note"),
        mMeta: document.getElementById("m_meta"),
        refresh: document.getElementById("refresh"),
        totalFiles: document.getElementById("totalFiles"),
        totalSize: document.getElementById("totalSize"),
        fileCount: document.getElementById("fileCount"),
        toast: document.getElementById("toast"),
        downloadProgress: document.getElementById("downloadProgress"),
        progressFilename: document.getElementById("progressFilename"),
        progressStats: document.getElementById("progressStats"),
        progressPercent: document.getElementById("progressPercent"),
        progressCircle: document.getElementById("progressCircle"),
        cancelDownload: document.getElementById("cancelDownload"),
        categories: document.querySelectorAll(".category-chip"),
        sortBtn: document.getElementById("sortBtn"),
        sortText: document.getElementById("sortText"),
        contextMenu: document.getElementById("contextMenu")
    };

    // State
    let state = {
        currentId: null,
        toastTimeout: null,
        filesData: [],
        currentCategory: 'all',
        sortOrder: 'desc',
        downloadController: null,
        longPressTimeout: null,
        currentFile: null
    };

    // Set user info
    if (user) {
        const firstName = user.first_name || '';
        const lastName = user.last_name || '';
        const username = user.username ? `@${user.username}` : '';
        elements.who.textContent = `${firstName} ${lastName}`.trim() || username || 'User';
        elements.status.innerHTML = `<span class="status-dot"></span> Connected`;
    } else {
        elements.who.textContent = "Demo User";
        elements.status.innerHTML = `<span class="status-dot"></span> Demo mode`;
    }

    // Toast function
    function showToast(message, type = 'info', duration = 2000) {
        if (state.toastTimeout) clearTimeout(state.toastTimeout);

        const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
        elements.toast.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
        elements.toast.className = 'toast';
        if (type === 'success') elements.toast.classList.add('success');
        if (type === 'error') elements.toast.classList.add('error');
        elements.toast.classList.add('show');

        state.toastTimeout = setTimeout(() => {
            elements.toast.classList.remove('show');
            state.toastTimeout = null;
        }, duration);
    }

    function setStatus(text, loading = false) {
        if (loading) {
            elements.status.innerHTML = `<span class="spinner"></span> ${text}`;
        } else {
            elements.status.innerHTML = `<span class="status-dot"></span> ${text}`;
        }
    }

    // Progress functions
    function showDownloadProgress(filename) {
        elements.progressFilename.textContent = filename.substring(0, 35);
        elements.progressPercent.textContent = '0%';
        elements.progressStats.textContent = '0 B / 0 B';
        elements.progressCircle.style.background = 'conic-gradient(var(--accent) 0deg, var(--border-light) 0deg)';
        elements.downloadProgress.classList.add('show');
    }

    function updateProgress(current, total) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const degrees = (percent / 100) * 360;
        elements.progressPercent.textContent = `${percent}%`;
        elements.progressCircle.style.background = `conic-gradient(var(--accent) ${degrees}deg, var(--border-light) ${degrees}deg)`;
        elements.progressStats.textContent = `${formatFileSize(current)} / ${formatFileSize(total)}`;
    }

    function hideDownloadProgress() {
        elements.downloadProgress.classList.remove('show');
        if (state.downloadController) {
            state.downloadController.abort();
            state.downloadController = null;
        }
    }

    // Cancel download
    elements.cancelDownload.addEventListener('click', hideDownloadProgress);

    // API call
    async function api(path, opts = {}) {
        const headers = {
            "x-telegram-init-data": initData,
            "content-type": "application/json",
            ...opts.headers
        };

        try {
            const r = await fetch(path, { ...opts, headers });
            if (!r.ok) {
                const errorText = await r.text();
                throw new Error(errorText || `HTTP error ${r.status}`);
            }
            return await r.json();
        } catch (error) {
            console.error('API error:', error);
            throw error;
        }
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function getFileType(fileName, kind) {
        const ext = fileName?.split('.').pop()?.toLowerCase() || '';
        const type = kind?.toLowerCase() || '';

        if (type.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
            return { category: 'images', icon: 'fa-image', color: '#38bdf8' };
        }
        if (type.includes('video') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
            return { category: 'videos', icon: 'fa-video', color: '#f97316' };
        }
        if (type.includes('audio') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
            return { category: 'audio', icon: 'fa-music', color: '#8b5cf6' };
        }
        if (['pdf'].includes(ext)) {
            return { category: 'documents', icon: 'fa-file-pdf', color: '#ef4444' };
        }
        if (['doc', 'docx'].includes(ext)) {
            return { category: 'documents', icon: 'fa-file-word', color: '#3b82f6' };
        }
        if (['xls', 'xlsx', 'csv'].includes(ext)) {
            return { category: 'documents', icon: 'fa-file-excel', color: '#22c55e' };
        }
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
            return { category: 'archives', icon: 'fa-file-archive', color: '#a855f7' };
        }
        return { category: 'documents', icon: 'fa-file', color: '#6b7280' };
    }

    function updateStats(files) {
        const totalFiles = files.length;
        const totalSize = files.reduce((acc, file) => acc + (file.fileSize || 0), 0);
        elements.totalFiles.textContent = totalFiles;
        elements.totalSize.textContent = formatFileSize(totalSize);
        elements.fileCount.textContent = `${totalFiles} ${totalFiles === 1 ? 'item' : 'items'}`;
    }

    // Download function - Direct download
    async function downloadFile(id, fileName) {
        try {
            state.downloadController = new AbortController();
            const url = `/api/files/${id}/download?initData=${encodeURIComponent(initData)}`;
            showDownloadProgress(fileName);

            const response = await fetch(url, {
                signal: state.downloadController.signal
            });

            if (!response.ok) throw new Error(`Download failed: ${response.status}`);

            const contentLength = response.headers.get('content-length');
            const total = parseInt(contentLength, 10) || 0;

            const reader = response.body.getReader();
            const chunks = [];
            let received = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.length;
                if (total > 0) updateProgress(received, total);
            }

            const blob = new Blob(chunks);
            const url_blob = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url_blob;
            a.download = fileName || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url_blob);

            hideDownloadProgress();
            showToast('Download completed', 'success');
            return true;
        } catch (error) {
            if (error.name === 'AbortError') {
                showToast('Download cancelled', 'info');
            } else {
                console.error('Download error:', error);
                showToast('Download failed', 'error');
            }
            hideDownloadProgress();
            return false;
        }
    }

    // Send via Bot function
    async function sendViaBot(id, fileName) {
        try {
            showToast('Sending via bot...', 'info');

            const result = await api(`/api/files/${id}/send`, {
                method: 'POST'
            });

            if (result.ok) {
                showToast('File sent to chat', 'success');
            } else {
                throw new Error(result.error || 'Failed to send');
            }
        } catch (error) {
            console.error('Send error:', error);
            showToast('Failed to send', 'error');
        }
    }

    function openModal(item) {
        state.currentId = item.id;
        elements.mName.value = item.fileName || '';
        elements.mNote.value = item.note || '';

        const date = new Date(item.createdAt).toLocaleString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        elements.mMeta.innerHTML = `
            <div class="meta-item">
                <span class="meta-label"><i class="fas fa-tag"></i> Type</span>
                <span class="meta-value">${item.kind || 'Unknown'}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label"><i class="fas fa-hard-drive"></i> Size</span>
                <span class="meta-value">${formatFileSize(item.fileSize)}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label"><i class="fas fa-calendar"></i> Created</span>
                <span class="meta-value">${date}</span>
            </div>
        `;

        elements.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        elements.modal.classList.remove('show');
        document.body.style.overflow = '';
        state.currentId = null;
    }

    elements.close.addEventListener('click', closeModal);
    elements.modal.addEventListener("click", (e) => {
        if (e.target === elements.modal) closeModal();
    });

    // Modal buttons
    elements.sendToBot.addEventListener('click', () => {
        if (state.currentId) {
            const file = state.filesData.find(f => f.id === state.currentId);
            if (file) {
                sendViaBot(state.currentId, file.fileName);
                closeModal();
            }
        }
    });

    elements.download.addEventListener('click', () => {
        if (state.currentId) {
            const file = state.filesData.find(f => f.id === state.currentId);
            if (file) {
                downloadFile(state.currentId, file.fileName || 'file');
                closeModal();
            }
        }
    });

    // Load files
    async function load() {
        setStatus("Loading...", true);
        elements.refresh.disabled = true;

        try {
            const items = await api("/api/files");

            state.filesData = items;
            updateStats(items);
            filterAndRenderFiles();
            setStatus("Updated");
            showToast('Files loaded', 'success');
        } catch (e) {
            console.error(e);
            setStatus("Error");
            elements.list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div>
                    <div class="empty-state-title">Failed to load</div>
                    <div class="empty-state-text">${e.message}</div>
                    <button class="btn btn-primary" style="margin-top:20px;" onclick="window.location.reload()">
                        <i class="fas fa-sync-alt"></i>
                        Try again
                    </button>
                </div>
            `;
        } finally {
            elements.refresh.disabled = false;
        }
    }

    function filterAndRenderFiles() {
        let filtered = state.filesData;

        // Filter by category
        if (state.currentCategory !== 'all') {
            filtered = state.filesData.filter(file => {
                const type = getFileType(file.fileName, file.kind);
                return type.category === state.currentCategory;
            });
        }

        // Sort
        filtered.sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();
            return state.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        });

        renderFiles(filtered);
    }

    function renderFiles(items) {
        if (!items.length) {
            elements.list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-folder-open"></i></div>
                    <div class="empty-state-title">No files yet</div>
                    <div class="empty-state-text">Send files to the bot to see them here</div>
                </div>
            `;
            return;
        }

        elements.list.innerHTML = items.map(item => {
            const type = getFileType(item.fileName, item.kind);
            const date = new Date(item.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            const safeName = String(item.fileName || 'Unnamed file').replace(/[<>]/g, '');

            return `
                <div class="file-card" data-id="${item.id}" data-file='${JSON.stringify(item).replace(/'/g, "&apos;")}'>
                    <div class="file-header">
                        <div class="file-info">
                            <div class="file-icon" style="background: ${type.color}20; color: ${type.color}">
                                <i class="fas ${type.icon}"></i>
                            </div>
                            <div style="flex:1; min-width:0;">
                                <span class="file-name">${safeName}</span>
                                <div class="file-meta">
                                    <span><i class="fas fa-file"></i> ${item.kind || 'File'}</span>
                                    <span><i class="fas fa-hard-drive"></i> ${formatFileSize(item.fileSize)}</span>
                                    <span><i class="fas fa-calendar"></i> ${date}</span>
                                </div>
                            </div>
                        </div>
                        <div class="file-actions">
                            <button class="icon-btn" onclick="window.downloadFileHandler('${item.id}', '${safeName}')">
                                <i class="fas fa-download"></i>
                            </button>
                            <button class="icon-btn primary" onclick="window.sendFileHandler('${item.id}')">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                    </div>
                    ${item.note ? `
                        <div class="file-note">
                            <i class="fas fa-sticky-note"></i>
                            ${item.note}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        attachFileListeners();
    }

    function attachFileListeners() {
        document.querySelectorAll('.file-card').forEach(card => {
            // Click to open modal
            card.addEventListener('click', (e) => {
                if (e.target.closest('.icon-btn')) return;
                const fileData = card.dataset.file;
                if (fileData) {
                    try {
                        const file = JSON.parse(fileData.replace(/&apos;/g, "'"));
                        openModal(file);
                    } catch (error) {
                        console.error('Parse error:', error);
                    }
                }
            });

            // Long press for context menu
            card.addEventListener('touchstart', (e) => {
                state.longPressTimeout = setTimeout(() => {
                    const rect = card.getBoundingClientRect();
                    const touch = e.touches[0];

                    const fileData = card.dataset.file;
                    if (fileData) {
                        try {
                            const file = JSON.parse(fileData.replace(/&apos;/g, "'"));
                            showContextMenu(file, touch.clientX, touch.clientY);
                        } catch (error) {
                            console.error('Parse error:', error);
                        }
                    }
                }, 500);
            });

            card.addEventListener('touchend', () => {
                clearTimeout(state.longPressTimeout);
            });

            card.addEventListener('touchmove', () => {
                clearTimeout(state.longPressTimeout);
            });
        });
    }

    // Context menu
    function showContextMenu(file, x, y) {
        state.currentFile = file;

        elements.contextMenu.style.display = 'block';
        elements.contextMenu.style.left = `${x}px`;
        elements.contextMenu.style.top = `${y}px`;
        elements.contextMenu.classList.add('show');

        setTimeout(() => {
            document.addEventListener('click', hideContextMenu, { once: true });
        }, 100);
    }

    function hideContextMenu() {
        elements.contextMenu.classList.remove('show');
        setTimeout(() => {
            elements.contextMenu.style.display = 'none';
        }, 200);
    }

    // Context menu actions
    elements.contextMenu.addEventListener('click', (e) => {
        const action = e.target.closest('.context-item')?.dataset.action;
        if (!action || !state.currentFile) return;

        hideContextMenu();

        switch (action) {
            case 'send':
                sendViaBot(state.currentFile.id, state.currentFile.fileName);
                break;
            case 'download':
                downloadFile(state.currentFile.id, state.currentFile.fileName);
                break;
            case 'edit':
                openModal(state.currentFile);
                break;
            case 'delete':
                if (confirm('Delete this file?')) {
                    // Implement delete
                    showToast('Delete feature coming soon', 'info');
                }
                break;
        }
    });

    // Global handlers
    window.downloadFileHandler = (id, name) => {
        const file = state.filesData.find(f => f.id === id);
        if (file) downloadFile(id, file.fileName || 'file');
    };

    window.sendFileHandler = (id) => {
        const file = state.filesData.find(f => f.id === id);
        if (file) sendViaBot(id, file.fileName || 'file');
    };

    // Event listeners
    elements.refresh.addEventListener('click', load);

    // Category filter
    elements.categories.forEach(chip => {
        chip.addEventListener('click', () => {
            elements.categories.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            state.currentCategory = chip.dataset.category;
            filterAndRenderFiles();
        });
    });

    // Sort button
    elements.sortBtn.addEventListener('click', () => {
        state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
        elements.sortText.textContent = state.sortOrder === 'desc' ? 'Latest' : 'Oldest';
        filterAndRenderFiles();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (elements.modal.classList.contains('show')) {
                closeModal();
            }
            if (elements.contextMenu.classList.contains('show')) {
                hideContextMenu();
            }
        }
    });

    // Auto refresh every 30 seconds
    setInterval(load, 30000);

    // Initial load
    setTimeout(load, 100);
})();