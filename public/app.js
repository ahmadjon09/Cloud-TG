(function () {
    const tg = window.Telegram?.WebApp;
    let initData = "";
    let user = null;

    // Agar Telegramda bo'lsa
    if (tg) {
        tg.ready();
        tg.expand();
        initData = tg.initData || "";
        user = tg.initDataUnsafe?.user;

        if (tg.colorScheme) {
            document.body.setAttribute('data-tg-theme', tg.colorScheme);
        }
    } else {
        // TEST UCHUN: Telegram bo'lmasa ham ishlayveradi
        console.log("Not in Telegram - running in test mode");
        initData = "test_init_data";
        user = { id: "123456789", username: "test_user" };
    }

    // DOM Elements
    const whoEl = document.getElementById("who");
    const statusEl = document.getElementById("status");
    const listEl = document.getElementById("list");
    const modal = document.getElementById("modal");
    const closeBtn = document.getElementById("close");
    const saveBtn = document.getElementById("save");
    const dlBtn = document.getElementById("download");
    const mName = document.getElementById("m_name");
    const mNote = document.getElementById("m_note");
    const mMeta = document.getElementById("m_meta");
    const refreshBtn = document.getElementById("refresh");
    const totalFilesEl = document.getElementById("totalFiles");
    const totalSizeEl = document.getElementById("totalSize");
    const fileCountEl = document.getElementById("fileCount");
    const toastEl = document.getElementById("toast");
    const downloadProgress = document.getElementById("downloadProgress");
    const progressFilename = document.getElementById("progressFilename");
    const progressStats = document.getElementById("progressStats");
    const progressPercent = document.getElementById("progressPercent");
    const progressCircle = document.getElementById("progressCircle");

    let currentId = null;
    let toastTimeout = null;
    let filesData = [];

    // Set user info TEZ KORINISHI UCHUN
    if (user) {
        const username = user.username ? `@${user.username}` : 'No username';
        whoEl.textContent = `${username}`;
        statusEl.textContent = 'Connected';
    } else {
        whoEl.textContent = "Demo User";
        statusEl.textContent = 'Demo mode';
    }

    // Toast function
    function showToast(message, duration = 2000) {
        if (toastTimeout) clearTimeout(toastTimeout);
        toastEl.textContent = message;
        toastEl.classList.add('show');
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('show');
            toastTimeout = null;
        }, duration);
    }

    function setStatus(text, loading = false) {
        if (loading) {
            statusEl.innerHTML = `<span class="spinner"></span> ${text}`;
        } else {
            statusEl.textContent = text;
        }
    }

    // Progress functions
    function showDownloadProgress(filename) {
        progressFilename.textContent = filename.substring(0, 30);
        progressPercent.textContent = '0%';
        progressStats.textContent = '0 B / 0 B';
        progressCircle.style.background = 'conic-gradient(var(--primary) 0deg, var(--border) 0deg)';
        downloadProgress.classList.add('show');
    }

    function updateProgress(current, total) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const degrees = (percent / 100) * 360;
        progressPercent.textContent = `${percent}%`;
        progressCircle.style.background = `conic-gradient(var(--primary) ${degrees}deg, var(--border) ${degrees}deg)`;
        progressStats.textContent = `${formatFileSize(current)} / ${formatFileSize(total)}`;
    }

    function hideDownloadProgress() {
        downloadProgress.classList.remove('show');
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
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function getFileIcon(kind = '') {
        const k = String(kind).toLowerCase();
        if (k.includes('image') || k.includes('jpg') || k.includes('png') || k.includes('photo')) return '🖼️';
        if (k.includes('video') || k.includes('mp4')) return '🎥';
        if (k.includes('audio') || k.includes('mp3')) return '🎵';
        if (k.includes('pdf')) return '📕';
        if (k.includes('word') || k.includes('doc')) return '📘';
        if (k.includes('excel') || k.includes('xls')) return '📗';
        if (k.includes('zip') || k.includes('rar')) return '🗜️';
        return '📄';
    }

    function updateStats(files) {
        const totalFiles = files.length;
        const totalSize = files.reduce((acc, file) => acc + (file.fileSize || 0), 0);
        totalFilesEl.textContent = totalFiles;
        totalSizeEl.textContent = formatFileSize(totalSize);
        fileCountEl.textContent = `${totalFiles} ${totalFiles === 1 ? 'item' : 'items'}`;
    }

    function openModal(item) {
        currentId = item.id;
        mName.value = item.fileName || '';
        mNote.value = item.note || '';

        const date = new Date(item.createdAt).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        mMeta.innerHTML = `
                    <div><span style="opacity:0.7;">Type:</span> ${item.kind || 'Unknown'}</div>
                    <div><span style="opacity:0.7;">Size:</span> ${formatFileSize(item.fileSize)}</div>
                    <div><span style="opacity:0.7;">Created:</span> ${date}</div>
                `;

        modal.style.display = "flex";
    }

    function closeModal() {
        modal.style.display = "none";
        currentId = null;
    }

    closeBtn.onclick = closeModal;
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

    // Download function
    async function downloadFile(id, fileName) {
        try {
            const url = `/api/files/${id}/download?initData=${encodeURIComponent(initData)}`;
            showDownloadProgress(fileName);

            const response = await fetch(url);
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
            showToast('✅ Download completed');
            return true;
        } catch (error) {
            console.error('Download error:', error);
            hideDownloadProgress();
            showToast('❌ Download failed');
            return false;
        }
    }

    // Load files
    async function load() {
        setStatus("Loading...", true);
        refreshBtn.disabled = true;

        // TEST UCHUN: Agar API bo'lmasa, demo data ko'rsatamiz
        try {
            // Real API dan olishga urinamiz
            let items = [];
            try {
                items = await api("/api/files");
            } catch (e) {
                console.log("API not available, using demo data");
                // Demo data
                items = [
                    { id: "1", fileName: "photo.jpg", kind: "photo", fileSize: 1024 * 1024 * 2.5, createdAt: new Date(), note: "Vacation photo" },
                    { id: "2", fileName: "document.pdf", kind: "document", fileSize: 1024 * 1024 * 1.2, createdAt: new Date(Date.now() - 86400000), note: "Important document" },
                    { id: "3", fileName: "video.mp4", kind: "video", fileSize: 1024 * 1024 * 15, createdAt: new Date(Date.now() - 172800000), note: "Meeting recording" },
                    { id: "4", fileName: "audio.mp3", kind: "audio", fileSize: 1024 * 512, createdAt: new Date(Date.now() - 259200000), note: "Podcast episode" }
                ];
            }

            filesData = items;
            updateStats(items);

            if (!items.length) {
                listEl.innerHTML = `
                            <div class="empty-state">
                                <div class="empty-state-icon">📁</div>
                                <div class="empty-state-title">No files yet</div>
                                <div class="empty-state-text">Send files to the bot</div>
                            </div>
                        `;
            } else {
                listEl.innerHTML = items.map(it => {
                    const fileIcon = getFileIcon(it.kind);
                    const safeName = String(it.fileName || 'Unnamed file').replace(/[<>]/g, '');
                    return `
                                <div class="file-card">
                                    <div class="file-header">
                                        <div class="file-info">
                                            <div class="file-icon">${fileIcon}</div>
                                            <span class="file-name">${safeName}</span>
                                        </div>
                                        <div class="file-actions">
                                            <button class="icon-btn" onclick="window.downloadFileHandler('${it.id}', '${safeName}')">⬇️</button>
                                            <button class="icon-btn primary" onclick="window.editFileHandler('${it.id}')">✎</button>
                                        </div>
                                    </div>
                                    <div class="file-meta">
                                        <span>📄 ${it.kind || 'File'}</span>
                                        <span>💾 ${formatFileSize(it.fileSize)}</span>
                                        <span>🕒 ${new Date(it.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    ${it.note ? `<div class="file-note">📝 ${it.note}</div>` : ''}
                                </div>
                            `;
                }).join('');
            }

            setStatus(`Updated ${new Date().toLocaleTimeString()}`);
            showToast('Files loaded');
        } catch (e) {
            console.error(e);
            setStatus("Error");
            listEl.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">⚠️</div>
                            <div class="empty-state-title">Error</div>
                            <div class="empty-state-text">${e.message}</div>
                            <button class="btn btn-primary" style="margin-top:16px;" onclick="load()">Try again</button>
                        </div>
                    `;
        } finally {
            refreshBtn.disabled = false;
        }
    }

    // Global handlers
    window.downloadFileHandler = (id, name) => {
        const file = filesData.find(f => f.id === id);
        if (file) downloadFile(id, file.fileName || 'file');
    };

    window.editFileHandler = (id) => {
        const file = filesData.find(f => f.id === id);
        if (file) openModal(file);
    };

    // Event listeners
    refreshBtn.onclick = load;

    saveBtn.onclick = async () => {
        if (!currentId) return;
        saveBtn.innerHTML = '<span class="spinner"></span> Saving...';
        saveBtn.disabled = true;
        try {
            await api(`/api/files/${currentId}`, {
                method: "PATCH",
                body: JSON.stringify({
                    fileName: mName.value.trim() || null,
                    note: mNote.value.trim() || null
                })
            });
            closeModal();
            await load();
            showToast('✅ Saved');
        } catch {
            showToast('❌ Error');
        } finally {
            saveBtn.innerHTML = '💾 Save';
            saveBtn.disabled = false;
        }
    };

    dlBtn.onclick = () => {
        if (!currentId) return;
        const file = filesData.find(f => f.id === currentId);
        if (file) {
            downloadFile(currentId, file.fileName || 'file');
            closeModal();
        }
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
    });


    setTimeout(load, 100);
})();