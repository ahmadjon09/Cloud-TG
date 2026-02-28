// Telegram WebApp Full Version
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
            showToast('Send files to the bot in Telegram', 'info');
        });
        tg.MainButton.show();
    } else {
        // Test mode
        console.log("Test mode - not in Telegram");
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
        previewModal: document.getElementById("previewModal"),
        previewBody: document.getElementById("previewBody"),
        previewInfo: document.getElementById("previewInfo"),
        previewClose: document.getElementById("previewClose"),
        previewSend: document.getElementById("previewSend"),
        close: document.getElementById("close"),
        saveChanges: document.getElementById("saveChanges"),
        sendToBot: document.getElementById("sendToBot"),
        mName: document.getElementById("m_name"),
        mNote: document.getElementById("m_note"),
        mMeta: document.getElementById("m_meta"),
        refresh: document.getElementById("refresh"),
        totalFiles: document.getElementById("totalFiles"),
        totalSize: document.getElementById("totalSize"),
        fileCount: document.getElementById("fileCount"),
        toast: document.getElementById("toast"),
        categories: document.querySelectorAll(".category-chip"),
        sortBtn: document.getElementById("sortBtn"),
        sortText: document.getElementById("sortText"),
        contextMenu: document.getElementById("contextMenu"),
        errorSuggestion: document.getElementById("errorSuggestion"),
        errorMessage: document.getElementById("errorMessage"),
        suggestSendViaBot: document.getElementById("suggestSendViaBot")
    };

    // State
    let state = {
        currentId: null,
        toastTimeout: null,
        filesData: [],
        currentCategory: 'all',
        sortOrder: 'desc',
        longPressTimeout: null,
        currentFile: null,
        previewFile: null
    };

    // Set user info
    if (user) {
        const firstName = user.first_name || '';
        const lastName = user.last_name || '';
        const username = user.username ? `@${user.username}` : '';
        elements.who.textContent = `${firstName} ${lastName}`.trim() || username || 'User';
        elements.status.innerHTML = `<span class="status-dot"></span> Connected`;
    } else {
        elements.who.textContent = "Guest User";
        elements.status.innerHTML = `<span class="status-dot"></span> Demo mode`;
    }

    // Toast function
    function showToast(message, type = 'info', duration = 2000) {
        if (state.toastTimeout) clearTimeout(state.toastTimeout);

        const icon = type === 'success' ? 'fa-check-circle' :
            type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
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
        while (size >= 1024 && unitIndex < units.length - 1) { size /= 1024; unitIndex++; } return `${size.toFixed(unitIndex === 0
            ? 0 : 1)} ${units[unitIndex]}`;
    } function getFileType(fileName, kind) {
        const
            ext = fileName?.split('.').pop()?.toLowerCase() || ''; const type = kind?.toLowerCase() || ''; if
            (type.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
            return {
                category: 'images', icon: 'fa-image', color: '#38bdf8'
            };
        } if (type.includes('video') || ['mp4', 'mov', 'avi'
            , 'mkv', 'webm'].includes(ext)) { return { category: 'videos', icon: 'fa-video', color: '#f97316' }; } if
            (type.includes('audio') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
            return {
                category: 'audio',
                icon: 'fa-music', color: '#8b5cf6'
            };
        } if (['pdf'].includes(ext)) {
            return {
                category: 'documents',
                icon: 'fa-file-pdf', color: '#ef4444'
            };
        } if (['doc', 'docx'].includes(ext)) {
            return {
                category: 'documents',
                icon: 'fa-file-word', color: '#3b82f6'
            };
        } if (['xls', 'xlsx', 'csv'].includes(ext)) {
            return {
                category: 'documents', icon: 'fa-file-excel', color: '#22c55e'
            };
        } if (['zip', 'rar', '7z', 'tar', 'gz'
        ].includes(ext)) { return { category: 'archives', icon: 'fa-file-archive', color: '#a855f7' }; } return {
            category: 'documents', icon: 'fa-file', color: '#6b7280'
        };
    } function updateStats(files) {
        const
            totalFiles = files.length; const totalSize = files.reduce((acc, file) => acc + (file.fileSize || 0), 0);
        elements.totalFiles.textContent = totalFiles;
        elements.totalSize.textContent = formatFileSize(totalSize);
        elements.fileCount.textContent = `${totalFiles} ${totalFiles === 1 ? 'item' : 'items'}`;
    }

    // Send via Bot function
    async function sendViaBot(id, fileName) {
        try {
            showToast('Sending via bot...', 'info');

            const result = await api(`/api/files/${id}/send`, {
                method: 'POST'
            });

            if (result.ok) {
                showToast('File sent to chat ✓', 'success');
                if (tg) {
                    tg.HapticFeedback?.notificationOccurred('success');
                }
            } else {
                throw new Error(result.error || 'Failed to send');
            }
        } catch (error) {
            console.error('Send error:', error);
            showToast('Failed to send', 'error');
            if (tg) {
                tg.HapticFeedback?.notificationOccurred('error');
            }
        }
    }

    // Preview function
    async function previewFile(file) {
        if (!['photo', 'video', 'audio'].includes(file.kind)) {
            showToast('Preview not supported for this file type', 'warning');
            return;
        }

        state.previewFile = file;
        const previewUrl = `/api/files/${file.id}/preview?initData=${encodeURIComponent(initData)}`;

        let previewHtml = '';
        if (file.kind === 'photo') {
            previewHtml = `<img src="${previewUrl}" alt="${file.fileName}"
        style="max-width:100%; max-height:100%; object-fit:contain;">`;
        } else if (file.kind === 'video') {
            previewHtml = `
    <video controls autoplay loop style="max-width:100%; max-height:100%;">
        <source src="${previewUrl}" type="${file.mimeType || 'video/mp4'}">
        Your browser does not support the video tag.
    </video>
    `;
        } else if (file.kind === 'audio') {
            previewHtml = `
    <div style="text-align:center; padding:40px; color:white;">
        <i class="fas fa-music" style="font-size:80px; color:var(--accent); margin-bottom:20px;"></i>
        <h3 style="margin-bottom:20px;">${file.fileName}</h3>
        <audio controls style="width:100%;">
            <source src="${previewUrl}" type="${file.mimeType || 'audio/mpeg'}">
        </audio>
    </div>
    `;
        }

        elements.previewBody.innerHTML = previewHtml;

        const date = new Date(file.createdAt).toLocaleString();
        elements.previewInfo.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
            <strong>${file.fileName}</strong><br>
            <small>${formatFileSize(file.fileSize)} • ${date}</small>
        </div>
        <span style="background:rgba(255,255,255,0.2); padding:6px 12px; border-radius:20px; font-size:12px;">
            <i class="fas ${getFileType(file.fileName, file.kind).icon}"></i>
            ${file.kind}
        </span>
    </div>
    `;

        elements.previewModal.classList.add('show');
        document.body.style.overflow = 'hidden';

        if (tg) {
            tg.HapticFeedback?.impactOccurred('light');
        }
    }

    function closePreview() {
        elements.previewModal.classList.remove('show');
        elements.previewBody.innerHTML = '';
        document.body.style.overflow = '';
        state.previewFile = null;
    }

    // Save file changes
    async function saveFileChanges(id, fileName, note) {
        try {
            elements.saveChanges.disabled = true;
            elements.saveChanges.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

            const result = await api(`/api/files/${id}`, {
                method: 'PATCH', // Note: backend uses PATCH, not PUT
                body: JSON.stringify({ fileName, note })
            });

            if (result.ok) {
                showToast('Changes saved successfully ✓', 'success');
                if (tg) {
                    tg.HapticFeedback?.notificationOccurred('success');
                }
                closeModal();
                load(); // Refresh list
            } else {
                throw new Error(result.error || 'Failed to save');
            }
        } catch (error) {
            console.error('Save error:', error);
            showToast('Failed to save changes', 'error');

            // Show error suggestion
            elements.errorSuggestion.style.display = 'flex';
            elements.errorMessage.textContent = error.message || 'Network error';

            if (tg) {
                tg.HapticFeedback?.notificationOccurred('error');
            }
        } finally {
            elements.saveChanges.disabled = false;
            elements.saveChanges.innerHTML = '<i class="fas fa-save"></i> Save changes';
        }
    }

    // Open edit modal
    function openModal(item) {
        state.currentId = item.id;
        elements.mName.value = item.fileName || '';
        elements.mNote.value = item.note || '';
        elements.errorSuggestion.style.display = 'none';

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
        elements.errorSuggestion.style.display = 'none';
    }

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
            showToast('Files loaded ✓', 'success');
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
            const fileData = JSON.stringify(item).replace(/'/g, "&apos;");

            return `
        <div class="file-card" data-id="${item.id}" data-file='${fileData}'>
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
                    ${['photo', 'video', 'audio'].includes(item.kind) ? `
                    <button class="icon-btn" onclick="window.previewFileHandler('${item.id}')">
                        <i class="fas fa-eye"></i>
                    </button>
                    ` : ''}
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

            // Long press for context menu (mobile)
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

            // Right click for context menu (desktop)
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const fileData = card.dataset.file;
                if (fileData) {
                    try {
                        const file = JSON.parse(fileData.replace(/&apos;/g, "'"));
                        showContextMenu(file, e.clientX, e.clientY);
                    } catch (error) {
                        console.error('Parse error:', error);
                    }
                }
            });
        });
    }

    // Context menu
    function showContextMenu(file, x, y) {
        state.currentFile = file;

        // Adjust position to keep menu in viewport
        const menuWidth = 220;
        const menuHeight = 160;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = x;
        let top = y;

        if (left + menuWidth > viewportWidth) {
            left = viewportWidth - menuWidth - 10;
        }
        if (top + menuHeight > viewportHeight) {
            top = viewportHeight - menuHeight - 10;
        }

        elements.contextMenu.style.display = 'block';
        elements.contextMenu.style.left = `${left}px`;
        elements.contextMenu.style.top = `${top}px`;
        elements.contextMenu.classList.add('show');

        setTimeout(() => {
            document.addEventListener('click', hideContextMenu, { once: true });
        }, 100);

        if (tg) {
            tg.HapticFeedback?.impactOccurred('medium');
        }
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
            case 'preview':
                previewFile(state.currentFile);
                break;
            case 'send':
                sendViaBot(state.currentFile.id, state.currentFile.fileName);
                break;
            case 'edit':
                openModal(state.currentFile);
                break;
        }
    });

    // Global handlers
    window.previewFileHandler = (id) => {
        const file = state.filesData.find(f => f.id === id);
        if (file) previewFile(file);
    };

    window.sendFileHandler = (id) => {
        const file = state.filesData.find(f => f.id === id);
        if (file) sendViaBot(id, file.fileName || 'file');
    };

    // Event listeners for modals
    elements.close.addEventListener('click', closeModal);
    elements.previewClose.addEventListener('click', closePreview);

    elements.modal.addEventListener("click", (e) => {
        if (e.target === elements.modal) closeModal();
    });

    elements.previewModal.addEventListener("click", (e) => {
        if (e.target === elements.previewModal) closePreview();
    });

    // Save changes button
    elements.saveChanges.addEventListener('click', () => {
        if (state.currentId) {
            const fileName = elements.mName.value.trim();
            const note = elements.mNote.value.trim();

            if (!fileName) {
                showToast('File name cannot be empty', 'error');
                return;
            }

            saveFileChanges(state.currentId, fileName, note);
        }
    });

    // Send via bot from modal
    elements.sendToBot.addEventListener('click', () => {
        if (state.currentId) {
            const file = state.filesData.find(f => f.id === state.currentId);
            if (file) {
                sendViaBot(state.currentId, file.fileName);
                closeModal();
            }
        }
    });

    // Suggest send via bot
    elements.suggestSendViaBot.addEventListener('click', () => {
        if (state.currentId) {
            const file = state.filesData.find(f => f.id === state.currentId);
            if (file) {
                sendViaBot(state.currentId, file.fileName);
                closeModal();
            }
        }
    });

    // Preview send
    elements.previewSend.addEventListener('click', () => {
        if (state.previewFile) {
            sendViaBot(state.previewFile.id, state.previewFile.fileName);
            closePreview();
        }
    });

    // Event listeners
    elements.refresh.addEventListener('click', load);

    // Category filter
    elements.categories.forEach(chip => {
        chip.addEventListener('click', () => {
            elements.categories.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            state.currentCategory = chip.dataset.category;
            filterAndRenderFiles();

            if (tg) {
                tg.HapticFeedback?.impactOccurred('light');
            }
        });
    });

    // Sort button
    elements.sortBtn.addEventListener('click', () => {
        state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
        elements.sortText.textContent = state.sortOrder === 'desc' ? 'Latest' : 'Oldest';
        filterAndRenderFiles();

        if (tg) {
            tg.HapticFeedback?.impactOccurred('light');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (elements.modal.classList.contains('show')) {
                closeModal();
            }
            if (elements.previewModal.classList.contains('show')) {
                closePreview();
            }
            if (elements.contextMenu.classList.contains('show')) {
                hideContextMenu();
            }
        }
    });

    // Auto refresh every 60 seconds
    setInterval(load, 60000);

    // Initial load
    setTimeout(load, 100);
})();