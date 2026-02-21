// app.js
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

        // Theme handling
        if (tg.colorScheme) {
            document.body.setAttribute('data-tg-theme', tg.colorScheme);
        }

        // Main button
        tg.MainButton.setText('Upload File');
        tg.MainButton.onClick(() => {
            showToast('Upload feature coming soon!');
        });
    } else {
        // Test mode
        console.log("Running in test mode");
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
        userName: document.getElementById('userName'),
        userStatus: document.getElementById('userStatus'),
        userAvatar: document.getElementById('avatarInitials'),
        totalFiles: document.getElementById('totalFiles'),
        totalSize: document.getElementById('totalSize'),
        totalItems: document.getElementById('totalItems'),
        filesList: document.getElementById('filesList'),
        refreshBtn: document.getElementById('refreshBtn'),
        modal: document.getElementById('fileModal'),
        closeModal: document.getElementById('closeModal'),
        fileName: document.getElementById('fileName'),
        fileNote: document.getElementById('fileNote'),
        fileMetadata: document.getElementById('fileMetadata'),
        previewIcon: document.getElementById('previewIcon'),
        sendToBotBtn: document.getElementById('sendToBotBtn'),
        downloadBtn: document.getElementById('downloadBtn'),
        downloadProgress: document.getElementById('downloadProgress'),
        progressCircle: document.getElementById('progressCircle'),
        progressPercent: document.getElementById('progressPercent'),
        progressFilename: document.getElementById('progressFilename'),
        progressStats: document.getElementById('progressStats'),
        cancelDownload: document.getElementById('cancelDownload'),
        toast: document.getElementById('toast'),
        contextMenu: document.getElementById('contextMenu'),
        sortBtn: document.getElementById('sortBtn'),
        categories: document.querySelectorAll('.category-chip')
    };

    // State
    let state = {
        files: [],
        currentFile: null,
        currentCategory: 'all',
        sortOrder: 'desc',
        downloadController: null,
        toastTimeout: null,
        longPressTimeout: null
    };

    // Initialize Lucide icons
    lucide.createIcons();

    // Set user info
    if (user) {
        const firstName = user.first_name || '';
        const lastName = user.last_name || '';
        const username = user.username ? `@${user.username}` : '';

        elements.userName.textContent = `${firstName} ${lastName}`.trim() || username || 'User';
        elements.avatarInitials.textContent = getInitials(firstName, lastName);
    } else {
        elements.userName.textContent = "Demo User";
        elements.avatarInitials.textContent = "👤";
    }

    // Helper functions
    function getInitials(first, last) {
        if (!first && !last) return "👤";
        return (first?.charAt(0) || '' + last?.charAt(0) || '').toUpperCase() || "👤";
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
            return { category: 'images', icon: '🖼️', color: '#38bdf8' };
        }
        if (type.includes('video') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
            return { category: 'videos', icon: '🎥', color: '#f97316' };
        }
        if (type.includes('audio') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
            return { category: 'audio', icon: '🎵', color: '#8b5cf6' };
        }
        if (['pdf'].includes(ext)) {
            return { category: 'documents', icon: '📕', color: '#ef4444' };
        }
        if (['doc', 'docx'].includes(ext)) {
            return { category: 'documents', icon: '📘', color: '#3b82f6' };
        }
        if (['xls', 'xlsx', 'csv'].includes(ext)) {
            return { category: 'documents', icon: '📗', color: '#22c55e' };
        }
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
            return { category: 'archives', icon: '🗜️', color: '#a855f7' };
        }
        return { category: 'documents', icon: '📄', color: '#6b7280' };
    }

    function showToast(message, type = 'info', duration = 2000) {
        if (state.toastTimeout) clearTimeout(state.toastTimeout);

        elements.toast.textContent = message;
        elements.toast.className = 'toast';
        if (type === 'success') elements.toast.classList.add('success');
        if (type === 'error') elements.toast.classList.add('error');
        elements.toast.classList.add('show');

        state.toastTimeout = setTimeout(() => {
            elements.toast.classList.remove('show');
            state.toastTimeout = null;
        }, duration);
    }

    function setLoading(loading) {
        if (loading) {
            elements.refreshBtn.innerHTML = '<div class="spinner"></div>';
            elements.refreshBtn.disabled = true;
        } else {
            elements.refreshBtn.innerHTML = '<i data-lucide="refresh-cw" width="20" height="20"></i>';
            elements.refreshBtn.disabled = false;
            lucide.createIcons();
        }
    }

    // API call
    async function api(path, opts = {}) {
        const headers = {
            "x-telegram-init-data": initData,
            "content-type": "application/json",
            ...opts.headers
        };

        try {
            const response = await fetch(path, { ...opts, headers });
            if (!response.ok) {
                const error = await response.text();
                throw new Error(error || `HTTP error ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('API error:', error);
            throw error;
        }
    }

    // Download functions
    async function downloadFile(file, viaBot = false) {
        if (viaBot) {
            return sendViaBot(file);
        }

        try {
            state.downloadController = new AbortController();
            const url = `/api/files/${file.id}/download?initData=${encodeURIComponent(initData)}`;

            showDownloadProgress(file.fileName);

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
                updateProgress(received, total, file.fileName);
            }

            const blob = new Blob(chunks);
            const url_blob = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url_blob;
            a.download = file.fileName || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url_blob);

            hideDownloadProgress();
            showToast('✅ Download completed', 'success');
        } catch (error) {
            if (error.name === 'AbortError') {
                showToast('⏹️ Download cancelled', 'info');
            } else {
                console.error('Download error:', error);
                showToast('❌ Download failed', 'error');
            }
            hideDownloadProgress();
        } finally {
            state.downloadController = null;
        }
    }

    async function sendViaBot(file) {
        try {
            showToast('📤 Sending via bot...', 'info');

            const result = await api(`/api/files/${file.id}/send`, {
                method: 'POST'
            });

            if (result.ok) {
                showToast('✅ File sent to chat', 'success');
            } else {
                throw new Error(result.error || 'Failed to send');
            }
        } catch (error) {
            console.error('Send error:', error);
            showToast('❌ Failed to send', 'error');
        }
    }

    function showDownloadProgress(filename) {
        elements.progressFilename.textContent = filename.substring(0, 30);
        elements.progressPercent.textContent = '0%';
        elements.progressStats.textContent = '0 B / 0 B';
        elements.progressCircle.style.background = 'conic-gradient(var(--primary) 0deg, var(--border) 0deg)';
        elements.downloadProgress.classList.add('show');
    }

    function updateProgress(current, total, filename) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const degrees = (percent / 100) * 360;

        elements.progressPercent.textContent = `${percent}%`;
        elements.progressCircle.style.background = `conic-gradient(var(--primary) ${degrees}deg, var(--border) ${degrees}deg)`;
        elements.progressStats.textContent = `${formatFileSize(current)} / ${formatFileSize(total)}`;
        elements.progressFilename.textContent = filename.substring(0, 30);
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

    // Load files
    async function loadFiles() {
        setLoading(true);

        try {
            let files = [];
            try {
                files = await api("/api/files");
            } catch (e) {
                console.log("Using demo data");
                files = generateDemoFiles();
            }

            state.files = files;
            updateStats();
            filterAndRenderFiles();
            showToast('Files loaded', 'success');
        } catch (error) {
            console.error('Load error:', error);
            showToast('Failed to load files', 'error');
            renderEmpty('error');
        } finally {
            setLoading(false);
        }
    }

    function generateDemoFiles() {
        const types = [
            { name: 'Vacation Photo.jpg', kind: 'photo', size: 2.5 * 1024 * 1024, note: 'Beautiful sunset at the beach 🌅' },
            { name: 'Project Document.pdf', kind: 'document', size: 1.2 * 1024 * 1024, note: 'Important project proposal' },
            { name: 'Team Meeting.mp4', kind: 'video', size: 15 * 1024 * 1024, note: 'Weekly sync recording' },
            { name: 'Podcast Episode.mp3', kind: 'audio', size: 512 * 1024, note: 'Tech talk episode #42' },
            { name: 'Presentation.pptx', kind: 'presentation', size: 3.8 * 1024 * 1024, note: 'Q3 review slides' },
            { name: 'Data Export.xlsx', kind: 'spreadsheet', size: 980 * 1024, note: 'Sales data 2024' },
            { name: 'Project Archive.zip', kind: 'archive', size: 45 * 1024 * 1024, note: 'All source files' },
            { name: 'Profile Picture.png', kind: 'image', size: 350 * 1024, note: 'New avatar' }
        ];

        return types.map((type, index) => ({
            id: String(index + 1),
            fileName: type.name,
            kind: type.kind,
            fileSize: type.size,
            note: type.note,
            createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
        }));
    }

    function updateStats() {
        const totalFiles = state.files.length;
        const totalSize = state.files.reduce((acc, file) => acc + (file.fileSize || 0), 0);

        elements.totalFiles.textContent = totalFiles;
        elements.totalSize.textContent = formatFileSize(totalSize);
        elements.totalItems.textContent = `${totalFiles} ${totalFiles === 1 ? 'item' : 'items'}`;
    }

    function filterAndRenderFiles() {
        let filtered = state.files;

        // Filter by category
        if (state.currentCategory !== 'all') {
            filtered = state.files.filter(file => {
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

    function renderFiles(files) {
        if (!files.length) {
            renderEmpty('empty');
            return;
        }

        const html = files.map(file => {
            const type = getFileType(file.fileName, file.kind);
            const date = new Date(file.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            return `
                <div class="file-item" data-id="${file.id}" data-file='${JSON.stringify(file).replace(/'/g, "&apos;")}'>
                    <div class="file-header">
                        <div class="file-icon" style="background: ${type.color}20; color: ${type.color}">
                            ${type.icon}
                        </div>
                        <div class="file-info">
                            <span class="file-name">${escapeHtml(file.fileName || 'Unnamed')}</span>
                            <div class="file-meta">
                                <span>${formatFileSize(file.fileSize)}</span>
                                <span>•</span>
                                <span>${date}</span>
                            </div>
                        </div>
                    </div>
                    ${file.note ? `
                        <div class="file-note">
                            <i data-lucide="sticky-note" width="14" height="14"></i>
                            ${escapeHtml(file.note)}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        elements.filesList.innerHTML = html;
        lucide.createIcons();
        attachFileListeners();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderEmpty(type) {
        if (type === 'error') {
            elements.filesList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⚠️</div>
                    <div class="empty-state-title">Failed to load</div>
                    <div class="empty-state-text">Tap to try again</div>
                </div>
            `;
        } else {
            elements.filesList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📁</div>
                    <div class="empty-state-title">No files yet</div>
                    <div class="empty-state-text">Send files to the bot</div>
                </div>
            `;
        }
    }

    function attachFileListeners() {
        document.querySelectorAll('.file-item').forEach(item => {
            // Click to open modal
            item.addEventListener('click', (e) => {
                if (e.target.closest('.context-menu')) return;
                const fileData = item.dataset.file;
                if (fileData) {
                    try {
                        const file = JSON.parse(fileData.replace(/&apos;/g, "'"));
                        openFileModal(file);
                    } catch (error) {
                        console.error('Parse error:', error);
                    }
                }
            });

            // Long press for context menu
            item.addEventListener('touchstart', (e) => {
                state.longPressTimeout = setTimeout(() => {
                    const rect = item.getBoundingClientRect();
                    const touch = e.touches[0];

                    const fileData = item.dataset.file;
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

            item.addEventListener('touchend', () => {
                clearTimeout(state.longPressTimeout);
            });

            item.addEventListener('touchmove', () => {
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

        // Hide on click outside
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
    elements.contextMenu.addEventListener('click', async (e) => {
        const action = e.target.closest('.context-item')?.dataset.action;
        if (!action || !state.currentFile) return;

        hideContextMenu();

        switch (action) {
            case 'send':
                await sendViaBot(state.currentFile);
                break;
            case 'download':
                await downloadFile(state.currentFile, false);
                break;
            case 'rename':
                openFileModal(state.currentFile);
                break;
            case 'delete':
                if (confirm('Delete this file?')) {
                    showToast('Deleted', 'success');
                }
                break;
        }
    });

    // Modal functions
    function openFileModal(file) {
        state.currentFile = file;
        const type = getFileType(file.fileName, file.kind);

        elements.fileName.value = file.fileName || '';
        elements.fileNote.value = file.note || '';
        elements.previewIcon.textContent = type.icon;
        elements.previewIcon.style.background = `${type.color}20`;
        elements.previewIcon.style.color = type.color;

        const date = new Date(file.createdAt).toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        elements.fileMetadata.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Type</span>
                <span>${file.kind || 'Unknown'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: var(--text-secondary);">Size</span>
                <span>${formatFileSize(file.fileSize)}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-secondary);">Created</span>
                <span>${date}</span>
            </div>
        `;

        elements.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        elements.modal.classList.remove('show');
        document.body.style.overflow = '';
        state.currentFile = null;
    }

    // Modal buttons
    elements.sendToBotBtn.addEventListener('click', async () => {
        if (state.currentFile) {
            await sendViaBot(state.currentFile);
            closeModal();
        }
    });

    elements.downloadBtn.addEventListener('click', async () => {
        if (state.currentFile) {
            await downloadFile(state.currentFile, false);
            closeModal();
        }
    });

    elements.closeModal.addEventListener('click', closeModal);
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) closeModal();
    });

    // Save file changes
    async function saveFileChanges() {
        if (!state.currentFile) return;

        const updates = {};
        if (elements.fileName.value !== state.currentFile.fileName) {
            updates.fileName = elements.fileName.value.trim();
        }
        if (elements.fileNote.value !== state.currentFile.note) {
            updates.note = elements.fileNote.value.trim();
        }

        if (Object.keys(updates).length === 0) {
            closeModal();
            return;
        }

        try {
            setLoading(true);
            await api(`/api/files/${state.currentFile.id}`, {
                method: 'PATCH',
                body: JSON.stringify(updates)
            });

            showToast('✅ Changes saved', 'success');
            closeModal();
            await loadFiles();
        } catch (error) {
            console.error('Save error:', error);
            showToast('❌ Failed to save', 'error');
        } finally {
            setLoading(false);
        }
    }

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
        elements.sortBtn.innerHTML = `
            <i data-lucide="arrow-down-up" width="16" height="16"></i>
            <span>${state.sortOrder === 'desc' ? 'Latest' : 'Oldest'}</span>
        `;
        lucide.createIcons();
        filterAndRenderFiles();
    });

    // Refresh button
    elements.refreshBtn.addEventListener('click', loadFiles);

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

    // Initialize
    loadFiles();

    // Auto refresh every 30 seconds
    setInterval(loadFiles, 30000);
})();