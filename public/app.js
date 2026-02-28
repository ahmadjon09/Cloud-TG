// ===== CLOUD STORAGE - PREMIUM APP.JS =====
(function () {
    const tg = window.Telegram?.WebApp;
    let initData = "";
    let user = null;
    let firstLoad = true;

    if (tg) {
        tg.ready();
        tg.expand();
        tg.enableClosingConfirmation();
        initData = tg.initData || "";
        user = tg.initDataUnsafe?.user;
        if (tg.colorScheme) document.body.setAttribute('data-tg-theme', tg.colorScheme);
        tg.MainButton.setText('📤 Upload File');
        tg.MainButton.onClick(() => showToast('Send files to the bot in Telegram', 'info'));
        tg.MainButton.show();
    } else {
        initData = "test_init_data";
        user = { id: "123456789", username: "test_user", first_name: "Test", last_name: "User" };
    }

    // ===== DOM =====
    const $ = id => document.getElementById(id);
    const el = {
        who: $('who'), status: $('status'), list: $('list'),
        modal: $('modal'), previewModal: $('previewModal'),
        previewBody: $('previewBody'), previewInfo: $('previewInfo'),
        previewClose: $('previewClose'), previewSend: $('previewSend'),
        close: $('close'), saveChanges: $('saveChanges'), sendToBot: $('sendToBot'),
        mName: $('m_name'), mNote: $('m_note'), mMeta: $('m_meta'),
        refresh: $('refresh'), totalFiles: $('totalFiles'), totalSize: $('totalSize'),
        fileCount: $('fileCount'), toast: $('toast'),
        categories: document.querySelectorAll('.category-chip'),
        sortBtn: $('sortBtn'), sortText: $('sortText'),
        contextMenu: $('contextMenu'),
        errorSuggestion: $('errorSuggestion'), errorMessage: $('errorMessage'),
        suggestSendViaBot: $('suggestSendViaBot'),
        previewTitle: $('previewTitle')
    };

    // ===== STATE =====
    let state = {
        currentId: null,
        toastTimeout: null,
        filesData: [],
        currentCategory: 'all',
        sortOrder: 'desc',
        longPressTimeout: null,
        currentFile: null,
        previewFile: null,
        // Music player state
        mp: {
            audio: null,
            playlist: [],
            currentIdx: 0,
            isPlaying: false,
            isRepeat: false,
            isShuffle: false,
            duration: 0,
            progressInterval: null
        },
        // Video player state
        vp: {
            video: null,
            hideTimeout: null
        }
    };

    // ===== USER INFO =====
    if (user) {
        const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'User';
        el.who.textContent = name;
        el.status.innerHTML = `<span class="status-dot"></span> Connected`;
    } else {
        el.who.textContent = 'Guest User';
        el.status.innerHTML = `<span class="status-dot"></span> Demo mode`;
    }

    // ===== UTILITIES =====
    function showToast(msg, type = 'info', dur = 2500) {
        if (state.toastTimeout) clearTimeout(state.toastTimeout);
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-triangle-exclamation' };
        el.toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i>${msg}`;
        el.toast.className = `toast ${type === 'success' || type === 'error' ? type : ''}`;
        el.toast.classList.add('show');
        state.toastTimeout = setTimeout(() => el.toast.classList.remove('show'), dur);
    }

    function setStatus(text, loading = false) {
        el.status.innerHTML = loading
            ? `<span class="spinner"></span> ${text}`
            : `<span class="status-dot"></span> ${text}`;
    }

    function formatSize(bytes) {
        if (!bytes) return '0 B';
        const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, s = bytes;
        while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
        return `${s.toFixed(i ? 1 : 0)} ${u[i]}`;
    }

    function formatTime(secs) {
        if (!secs || isNaN(secs)) return '0:00';
        const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function getFileType(name, kind) {
        const ext = (name || '').split('.').pop().toLowerCase();
        const k = (kind || '').toLowerCase();
        if (k.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico'].includes(ext))
            return { category: 'images', icon: 'fa-image', color: '#38bdf8' };
        if (k.includes('video') || ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', '3gp'].includes(ext))
            return { category: 'videos', icon: 'fa-video', color: '#fb923c' };
        if (k.includes('audio') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma', 'opus', 'aiff', 'ape', 'alac', 'mp2', 'm3u'].includes(ext))
            return { category: 'audio', icon: 'fa-music', color: '#a78bfa' };
        if (ext === 'pdf') return { category: 'documents', icon: 'fa-file-pdf', color: '#ef4444' };
        if (['doc', 'docx'].includes(ext)) return { category: 'documents', icon: 'fa-file-word', color: '#3b82f6' };
        if (['xls', 'xlsx', 'csv'].includes(ext)) return { category: 'documents', icon: 'fa-file-excel', color: '#22c55e' };
        if (['ppt', 'pptx'].includes(ext)) return { category: 'documents', icon: 'fa-file-powerpoint', color: '#f97316' };
        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return { category: 'archives', icon: 'fa-file-archive', color: '#a855f7' };
        return { category: 'documents', icon: 'fa-file', color: '#6b7280' };
    }

    function isAudio(file) {
        return getFileType(file.fileName, file.kind).category === 'audio';
    }
    function isVideo(file) {
        return getFileType(file.fileName, file.kind).category === 'videos';
    }
    function isImage(file) {
        return getFileType(file.fileName, file.kind).category === 'images';
    }
    function canPreview(file) {
        return isAudio(file) || isVideo(file) || isImage(file);
    }

    // ===== API =====
    async function api(path, opts = {}) {
        const headers = {
            'x-telegram-init-data': initData,
            'content-type': 'application/json',
            ...opts.headers
        };
        const r = await fetch(path, { ...opts, headers });
        if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
        return r.json();
    }

    // ===== STATS =====
    function updateStats(files) {
        const total = files.length;
        const size = files.reduce((a, f) => a + (f.fileSize || 0), 0);
        el.totalFiles.textContent = total;
        el.totalSize.textContent = formatSize(size);
        el.fileCount.textContent = `${total} ${total === 1 ? 'item' : 'items'}`;
    }

    // ===== LOAD =====
    async function load() {
        setStatus('Loading...', true);
        el.refresh.disabled = true;
        try {
            const items = await api('/api/files');
            state.filesData = items;
            updateStats(items);
            filterAndRenderFiles();
            setStatus('Updated');
            // Only show toast on first load
            if (firstLoad) { firstLoad = false; showToast('Files loaded ✓', 'success', 1800); }
        } catch (e) {
            console.error(e);
            setStatus('Error');
            el.list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div>
          <div class="empty-state-title">Failed to load</div>
          <div class="empty-state-text">${e.message}</div>
          <button class="btn btn-primary btn-small" style="margin-top:20px;flex:none;" onclick="window.location.reload()">
            <i class="fas fa-sync-alt"></i> Try again
          </button>
        </div>`;
        } finally {
            el.refresh.disabled = false;
        }
    }

    function filterAndRenderFiles() {
        let filtered = state.filesData;
        if (state.currentCategory !== 'all') {
            filtered = filtered.filter(f => getFileType(f.fileName, f.kind).category === state.currentCategory);
        }
        filtered = [...filtered].sort((a, b) => {
            const da = new Date(a.createdAt).getTime(), db = new Date(b.createdAt).getTime();
            return state.sortOrder === 'desc' ? db - da : da - db;
        });
        renderFiles(filtered);
    }

    function renderFiles(items) {
        if (!items.length) {
            el.list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><i class="fas fa-folder-open"></i></div>
          <div class="empty-state-title">No files here</div>
          <div class="empty-state-text">Send files to the bot to see them here</div>
        </div>`;
            return;
        }

        el.list.innerHTML = items.map((item, idx) => {
            const type = getFileType(item.fileName, item.kind);
            const date = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const safeName = String(item.fileName || 'Unnamed').replace(/[<>"]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            const fileData = JSON.stringify(item).replace(/'/g, "&#39;");
            const preview = canPreview(item);

            return `
        <div class="file-card" data-id="${item.id}" data-file='${fileData}' style="animation-delay:${idx * 0.03}s">
          <div class="file-header">
            <div class="file-info">
              <div class="file-icon" style="background:${type.color}18;color:${type.color}">
                <i class="fas ${type.icon}"></i>
              </div>
              <div class="file-details">
                <span class="file-name" title="${safeName}">${safeName}</span>
                <div class="file-meta">
                  <span><i class="fas fa-tag"></i>${item.kind || 'File'}</span>
                  <span><i class="fas fa-database"></i>${formatSize(item.fileSize)}</span>
                  <span><i class="fas fa-calendar"></i>${date}</span>
                </div>
              </div>
            </div>
            <div class="file-actions">
              ${preview ? `<button class="icon-btn" data-action-preview="${item.id}" title="Preview"><i class="fas fa-eye"></i></button>` : ''}
              <button class="icon-btn primary" data-action-send="${item.id}" title="Send"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>
          ${item.note ? `<div class="file-note"><i class="fas fa-sticky-note"></i>${item.note}</div>` : ''}
        </div>`;
        }).join('');

        attachFileListeners();
    }

    function attachFileListeners() {
        el.list.querySelectorAll('.file-card').forEach(card => {
            // Preview button
            const pBtn = card.querySelector('[data-action-preview]');
            if (pBtn) {
                pBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    const id = pBtn.dataset.actionPreview;
                    const file = state.filesData.find(f => f.id === id);
                    if (file) openPreview(file);
                });
            }
            // Send button
            const sBtn = card.querySelector('[data-action-send]');
            if (sBtn) {
                sBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    const id = sBtn.dataset.actionSend;
                    const file = state.filesData.find(f => f.id === id);
                    if (file) sendViaBot(id, file.fileName);
                });
            }
            // Click card → open modal
            card.addEventListener('click', e => {
                if (e.target.closest('[data-action-preview]') || e.target.closest('[data-action-send]')) return;
                try {
                    const file = JSON.parse(card.dataset.file.replace(/&#39;/g, "'"));
                    openModal(file);
                } catch { }
            });
            // Long press
            card.addEventListener('touchstart', e => {
                state.longPressTimeout = setTimeout(() => {
                    try {
                        const file = JSON.parse(card.dataset.file.replace(/&#39;/g, "'"));
                        showContextMenu(file, e.touches[0].clientX, e.touches[0].clientY);
                    } catch { }
                }, 520);
            }, { passive: true });
            card.addEventListener('touchend', () => clearTimeout(state.longPressTimeout));
            card.addEventListener('touchmove', () => clearTimeout(state.longPressTimeout));
            card.addEventListener('contextmenu', e => {
                e.preventDefault();
                try {
                    const file = JSON.parse(card.dataset.file.replace(/&#39;/g, "'"));
                    showContextMenu(file, e.clientX, e.clientY);
                } catch { }
            });
        });
    }

    // ===== CONTEXT MENU =====
    function showContextMenu(file, x, y) {
        state.currentFile = file;
        const m = el.contextMenu, mw = 220, mh = 170;
        let l = Math.min(x, window.innerWidth - mw - 8);
        let t = Math.min(y, window.innerHeight - mh - 8);
        m.style.left = `${Math.max(8, l)}px`;
        m.style.top = `${Math.max(8, t)}px`;
        m.classList.add('show');
        setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 100);
        tg?.HapticFeedback?.impactOccurred('medium');
    }

    function hideContextMenu() {
        el.contextMenu.classList.remove('show');
    }

    el.contextMenu.addEventListener('click', e => {
        const action = e.target.closest('.context-item')?.dataset.action;
        if (!action || !state.currentFile) return;
        hideContextMenu();
        if (action === 'preview') openPreview(state.currentFile);
        else if (action === 'send') sendViaBot(state.currentFile.id, state.currentFile.fileName);
        else if (action === 'edit') openModal(state.currentFile);
    });

    // ===== SEND VIA BOT =====
    async function sendViaBot(id, name) {
        try {
            showToast('Sending...', 'info', 1500);
            const r = await api(`/api/files/${id}/send`, { method: 'POST' });
            if (r.ok) { showToast('Sent ✓', 'success'); tg?.HapticFeedback?.notificationOccurred('success'); }
            else throw new Error(r.error || 'Failed');
        } catch (e) {
            showToast('Failed to send', 'error');
            tg?.HapticFeedback?.notificationOccurred('error');
        }
    }

    // ===== MODAL =====
    function openModal(item) {
        state.currentId = item.id;
        el.mName.value = item.fileName || '';
        el.mNote.value = item.note || '';
        el.errorSuggestion.style.display = 'none';
        const date = new Date(item.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        el.mMeta.innerHTML = `
      <div class="meta-item"><span class="meta-label"><i class="fas fa-tag"></i>Type</span><span class="meta-value">${item.kind || 'Unknown'}</span></div>
      <div class="meta-item"><span class="meta-label"><i class="fas fa-database"></i>Size</span><span class="meta-value">${formatSize(item.fileSize)}</span></div>
      <div class="meta-item"><span class="meta-label"><i class="fas fa-calendar"></i>Created</span><span class="meta-value">${date}</span></div>`;
        el.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        el.modal.classList.remove('show');
        document.body.style.overflow = '';
        state.currentId = null;
        el.errorSuggestion.style.display = 'none';
    }

    async function saveFileChanges(id, fileName, note) {
        try {
            el.saveChanges.disabled = true;
            el.saveChanges.innerHTML = '<span class="spinner"></span> Saving...';
            const r = await api(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify({ fileName, note }) });
            if (r.ok) {
                showToast('Saved ✓', 'success');
                tg?.HapticFeedback?.notificationOccurred('success');
                closeModal();
                load();
            } else throw new Error(r.error || 'Failed');
        } catch (e) {
            showToast('Failed to save', 'error');
            el.errorSuggestion.style.display = 'flex';
            el.errorMessage.textContent = e.message;
            tg?.HapticFeedback?.notificationOccurred('error');
        } finally {
            el.saveChanges.disabled = false;
            el.saveChanges.innerHTML = '<i class="fas fa-save"></i> Save changes';
        }
    }

    // ===== PREVIEW =====
    function openPreview(file) {
        state.previewFile = file;
        const type = getFileType(file.fileName, file.kind);
        const previewUrl = `/api/files/${file.id}/preview?initData=${encodeURIComponent(initData)}`;

        if (el.previewTitle) el.previewTitle.textContent = file.fileName || 'Preview';

        if (type.category === 'audio') {
            // Build music player
            const audioFiles = state.filesData.filter(f => getFileType(f.fileName, f.kind).category === 'audio');
            const idx = audioFiles.findIndex(f => f.id === file.id);
            buildMusicPlayer(audioFiles, Math.max(0, idx));
        } else if (type.category === 'video') {
            buildVideoPlayer(file, previewUrl);
        } else if (type.category === 'images') {
            buildImageViewer(file, previewUrl);
        }

        el.previewModal.classList.add('show');
        document.body.style.overflow = 'hidden';
        tg?.HapticFeedback?.impactOccurred('light');
    }

    function closePreview() {
        // Destroy audio
        if (state.mp.audio) {
            state.mp.audio.pause();
            state.mp.audio.src = '';
            state.mp.audio = null;
        }
        if (state.mp.progressInterval) { clearInterval(state.mp.progressInterval); state.mp.progressInterval = null; }
        // Destroy video
        if (state.vp.video) {
            state.vp.video.pause();
            state.vp.video.src = '';
            state.vp.video = null;
        }
        clearTimeout(state.vp.hideTimeout);

        el.previewModal.classList.remove('show');
        el.previewBody.innerHTML = '';
        document.body.style.overflow = '';
        state.previewFile = null;
        state.mp.isPlaying = false;
    }

    // ===== IMAGE VIEWER =====
    function buildImageViewer(file, url) {
        el.previewBody.innerHTML = `
      <div class="img-preview-wrap">
        <img src="${url}" alt="${file.fileName || 'Image'}" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'">
        <div style="display:none;flex-direction:column;align-items:center;gap:12px;color:var(--text3);">
          <i class="fas fa-image" style="font-size:48px"></i>
          <span>Failed to load image</span>
        </div>
      </div>`;
    }

    // ===== MUSIC PLAYER =====
    function buildMusicPlayer(playlist, startIdx) {
        state.mp.playlist = playlist;
        state.mp.currentIdx = startIdx;
        state.mp.isPlaying = false;

        el.previewBody.innerHTML = `
      <div class="music-player-wrap" id="mpWrap">
        <div class="music-player-bg"></div>
        <div class="music-player-content">
          <div class="mp-art-section">
            <div class="mp-art paused" id="mpArt">
              <div class="mp-art-inner">
                <i class="fas fa-music mp-art-icon" id="mpArtIcon"></i>
              </div>
            </div>
            <div class="mp-track-info">
              <div class="mp-title" id="mpTitle">Loading...</div>
              <div class="mp-subtitle" id="mpSubtitle">AUDIO</div>
            </div>
          </div>

          <div class="mp-progress-section">
            <div class="mp-time-row">
              <span id="mpCurrent">0:00</span>
              <span id="mpTotal">0:00</span>
            </div>
            <div class="mp-progress-bar" id="mpProgressBar">
              <div class="mp-progress-fill" id="mpProgressFill" style="width:0%"></div>
            </div>
          </div>

          <div class="mp-controls">
            <button class="mp-btn mp-btn-sm" id="mpPrev" title="Previous"><i class="fas fa-backward-step"></i></button>
            <button class="mp-btn mp-btn-lg" id="mpPlay" title="Play/Pause"><i class="fas fa-play" id="mpPlayIcon"></i></button>
            <button class="mp-btn mp-btn-sm" id="mpNext" title="Next"><i class="fas fa-forward-step"></i></button>
          </div>

          <div class="mp-extra-row">
            <i class="fas fa-volume-low mp-vol-icon"></i>
            <input type="range" class="mp-volume" id="mpVolume" min="0" max="1" step="0.01" value="1">
            <button class="mp-option-btn" id="mpShuffle" title="Shuffle"><i class="fas fa-shuffle"></i></button>
            <button class="mp-option-btn" id="mpRepeat" title="Repeat"><i class="fas fa-repeat"></i></button>
          </div>

          ${playlist.length > 1 ? `
          <div class="mp-playlist">
            <div class="mp-playlist-title">Playlist · ${playlist.length} tracks</div>
            <div id="mpPlaylistItems"></div>
          </div>` : ''}
        </div>
      </div>`;

        initMusicPlayer();
    }

    function initMusicPlayer() {
        const p = state.mp;
        const mpPlay = $('mpPlay'), mpPlayIcon = $('mpPlayIcon'), mpPrev = $('mpPrev'), mpNext = $('mpNext');
        const mpArt = $('mpArt'), mpTitle = $('mpTitle'), mpSubtitle = $('mpSubtitle');
        const mpCurrent = $('mpCurrent'), mpTotal = $('mpTotal');
        const mpProgressBar = $('mpProgressBar'), mpProgressFill = $('mpProgressFill');
        const mpVolume = $('mpVolume'), mpShuffle = $('mpShuffle'), mpRepeat = $('mpRepeat');

        function loadTrack(idx) {
            if (idx < 0 || idx >= p.playlist.length) return;
            p.currentIdx = idx;
            const file = p.playlist[idx];
            const url = `/api/files/${file.id}/preview?initData=${encodeURIComponent(initData)}`;

            if (p.audio) { p.audio.pause(); p.audio.src = ''; }
            if (p.progressInterval) clearInterval(p.progressInterval);

            p.audio = new Audio();
            p.audio.volume = parseFloat(mpVolume.value);
            p.audio.src = url;

            const name = file.fileName || 'Unknown';
            mpTitle.textContent = name;
            mpSubtitle.textContent = (name.split('.').pop() || 'AUDIO').toUpperCase();
            mpCurrent.textContent = '0:00';
            mpTotal.textContent = '0:00';
            mpProgressFill.style.width = '0%';

            p.audio.addEventListener('loadedmetadata', () => {
                mpTotal.textContent = formatTime(p.audio.duration);
            });

            p.audio.addEventListener('ended', () => {
                if (p.isRepeat) { p.audio.currentTime = 0; p.audio.play(); }
                else if (p.isShuffle) { loadTrack(Math.floor(Math.random() * p.playlist.length)); autoPlay(); }
                else if (p.currentIdx < p.playlist.length - 1) { loadTrack(p.currentIdx + 1); autoPlay(); }
                else { p.isPlaying = false; updatePlayUI(); mpArt.className = 'mp-art paused'; }
            });

            p.audio.addEventListener('error', () => showToast('Cannot play this file', 'error'));

            // Progress interval
            p.progressInterval = setInterval(() => {
                if (p.audio && !p.audio.paused && p.audio.duration) {
                    const pct = (p.audio.currentTime / p.audio.duration) * 100;
                    mpProgressFill.style.width = `${pct}%`;
                    mpCurrent.textContent = formatTime(p.audio.currentTime);
                }
            }, 300);

            updatePlaylistUI();
        }

        function autoPlay() {
            setTimeout(() => { if (p.audio) { p.audio.play().catch(() => { }); p.isPlaying = true; updatePlayUI(); mpArt.className = 'mp-art playing'; } }, 100);
        }

        function updatePlayUI() {
            mpPlayIcon.className = p.isPlaying ? 'fas fa-pause' : 'fas fa-play';
        }

        function updatePlaylistUI() {
            const container = $('mpPlaylistItems');
            if (!container) return;
            container.innerHTML = p.playlist.map((f, i) => {
                const type = getFileType(f.fileName, f.kind);
                const isActive = i === p.currentIdx;
                return `
          <div class="mp-pl-item ${isActive ? 'active' : ''}" data-pl-idx="${i}">
            <span class="mp-pl-num">${isActive ? '<i class="fas fa-volume-up" style="font-size:10px"></i>' : i + 1}</span>
            <div class="mp-pl-icon" style="background:${type.color}18;color:${type.color}">
              <i class="fas ${type.icon}"></i>
            </div>
            <span class="mp-pl-name">${(f.fileName || 'Unknown').replace(/[<>]/g, '')}</span>
            <span class="mp-pl-dur">${formatSize(f.fileSize)}</span>
          </div>`;
            }).join('');

            container.querySelectorAll('.mp-pl-item').forEach(item => {
                item.addEventListener('click', () => {
                    const idx = parseInt(item.dataset.plIdx);
                    loadTrack(idx);
                    autoPlay();
                });
            });
        }

        // Seek
        mpProgressBar.addEventListener('click', e => {
            if (!p.audio) return;
            const rect = mpProgressBar.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            if (p.audio.duration) { p.audio.currentTime = pct * p.audio.duration; }
        });

        // Touch seek
        mpProgressBar.addEventListener('touchstart', e => {
            if (!p.audio) return;
            const rect = mpProgressBar.getBoundingClientRect();
            const pct = (e.touches[0].clientX - rect.left) / rect.width;
            if (p.audio.duration) { p.audio.currentTime = Math.max(0, Math.min(1, pct)) * p.audio.duration; }
        }, { passive: true });

        // Play/Pause
        mpPlay.addEventListener('click', () => {
            if (!p.audio) return;
            if (p.isPlaying) { p.audio.pause(); p.isPlaying = false; mpArt.className = 'mp-art paused'; }
            else { p.audio.play().catch(() => showToast('Playback failed', 'error')); p.isPlaying = true; mpArt.className = 'mp-art playing'; }
            updatePlayUI();
            tg?.HapticFeedback?.impactOccurred('light');
        });

        mpPrev.addEventListener('click', () => {
            const prev = p.isShuffle ? Math.floor(Math.random() * p.playlist.length) : Math.max(0, p.currentIdx - 1);
            loadTrack(prev);
            if (p.isPlaying) autoPlay();
            tg?.HapticFeedback?.impactOccurred('light');
        });

        mpNext.addEventListener('click', () => {
            const next = p.isShuffle ? Math.floor(Math.random() * p.playlist.length) : Math.min(p.playlist.length - 1, p.currentIdx + 1);
            loadTrack(next);
            if (p.isPlaying) autoPlay();
            tg?.HapticFeedback?.impactOccurred('light');
        });

        mpVolume.addEventListener('input', () => { if (p.audio) p.audio.volume = parseFloat(mpVolume.value); });

        mpShuffle.addEventListener('click', () => {
            p.isShuffle = !p.isShuffle;
            mpShuffle.classList.toggle('active', p.isShuffle);
            tg?.HapticFeedback?.impactOccurred('light');
        });

        mpRepeat.addEventListener('click', () => {
            p.isRepeat = !p.isRepeat;
            mpRepeat.classList.toggle('active', p.isRepeat);
            tg?.HapticFeedback?.impactOccurred('light');
        });

        // Load and auto play
        loadTrack(p.currentIdx);
        autoPlay();
    }

    // ===== VIDEO PLAYER =====
    function buildVideoPlayer(file, url) {
        el.previewBody.innerHTML = `
      <div class="video-player-wrap controls-visible" id="vpWrap">
        <div class="video-main" id="vpMain">
          <video id="vpVideo" playsinline webkit-playsinline preload="metadata">
            <source src="${url}">
            Your browser does not support video.
          </video>
          <div class="video-overlay" id="vpOverlay">
            <div class="video-controls">
              <div class="video-progress-wrap">
                <div class="video-time-row">
                  <span id="vpCurrent">0:00</span>
                  <span id="vpTotal">0:00</span>
                </div>
                <input type="range" class="video-seekbar" id="vpSeekbar" min="0" max="100" step="0.1" value="0">
              </div>
              <div class="video-btn-row">
                <button class="vid-btn play-btn" id="vpPlay"><i class="fas fa-play" id="vpPlayIcon"></i></button>
                <button class="vid-btn" id="vpMute"><i class="fas fa-volume-high"></i></button>
                <input type="range" class="vid-volume" id="vpVolume" min="0" max="1" step="0.01" value="1">
                <span class="vid-spacer"></span>
                <span class="vid-info" id="vpInfo">${file.fileName || ''}</span>
                <button class="vid-btn" id="vpFullscreen" title="Fullscreen"><i class="fas fa-expand"></i></button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

        initVideoPlayer(file);
    }

    function initVideoPlayer(file) {
        const wrap = $('vpWrap'), vid = $('vpVideo');
        if (!vid) return;
        state.vp.video = vid;

        const vpPlay = $('vpPlay'), vpPlayIcon = $('vpPlayIcon');
        const vpMute = $('vpMute'), vpVolume = $('vpVolume');
        const vpCurrent = $('vpCurrent'), vpTotal = $('vpTotal'), vpSeekbar = $('vpSeekbar');
        const vpFullscreen = $('vpFullscreen'), vpMain = $('vpMain');

        function showControls() {
            wrap.classList.add('controls-visible');
            clearTimeout(state.vp.hideTimeout);
            state.vp.hideTimeout = setTimeout(() => { if (!vid.paused) wrap.classList.remove('controls-visible'); }, 3000);
        }

        function updatePlayUI() {
            const playing = !vid.paused;
            vpPlayIcon.className = playing ? 'fas fa-pause' : 'fas fa-play';
        }

        vid.addEventListener('loadedmetadata', () => {
            vpTotal.textContent = formatTime(vid.duration);
            vpSeekbar.max = vid.duration;
        });

        vid.addEventListener('timeupdate', () => {
            vpCurrent.textContent = formatTime(vid.currentTime);
            vpSeekbar.value = vid.currentTime;
        });

        vid.addEventListener('ended', () => { updatePlayUI(); wrap.classList.add('controls-visible'); });
        vid.addEventListener('error', () => showToast('Cannot play this video', 'error'));
        vid.addEventListener('play', updatePlayUI);
        vid.addEventListener('pause', updatePlayUI);

        vpPlay.addEventListener('click', () => {
            if (vid.paused) vid.play().catch(() => showToast('Playback failed', 'error'));
            else vid.pause();
            showControls();
        });

        vpMute.addEventListener('click', () => {
            vid.muted = !vid.muted;
            vpMute.innerHTML = `<i class="fas ${vid.muted ? 'fa-volume-xmark' : 'fa-volume-high'}"></i>`;
        });

        vpVolume.addEventListener('input', () => { vid.volume = parseFloat(vpVolume.value); });

        vpSeekbar.addEventListener('input', () => { vid.currentTime = parseFloat(vpSeekbar.value); });

        vpFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                (vpMain.requestFullscreen?.() || vid.webkitEnterFullscreen?.() || vid.requestFullscreen?.());
                vpFullscreen.innerHTML = '<i class="fas fa-compress"></i>';
            } else {
                document.exitFullscreen?.();
                vpFullscreen.innerHTML = '<i class="fas fa-expand"></i>';
            }
        });

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) vpFullscreen.innerHTML = '<i class="fas fa-expand"></i>';
        });

        vpMain.addEventListener('click', e => {
            if (!e.target.closest('.vid-btn') && !e.target.closest('.video-seekbar') && !e.target.closest('.vid-volume')) {
                if (wrap.classList.contains('controls-visible') && !vid.paused) {
                    // Toggle play on tap
                    vid.pause();
                }
                showControls();
            }
        });

        vpMain.addEventListener('touchstart', showControls, { passive: true });

        // Auto play
        vid.play().catch(() => { });
        showControls();
    }

    // ===== MODAL EVENTS =====
    el.close.addEventListener('click', closeModal);
    el.previewClose.addEventListener('click', closePreview);

    el.modal.addEventListener('click', e => { if (e.target === el.modal) closeModal(); });
    el.previewModal.addEventListener('click', e => { if (e.target === el.previewModal) closePreview(); });

    el.saveChanges.addEventListener('click', () => {
        if (!state.currentId) return;
        const name = el.mName.value.trim();
        if (!name) { showToast('File name cannot be empty', 'error'); return; }
        saveFileChanges(state.currentId, name, el.mNote.value.trim());
    });

    el.sendToBot.addEventListener('click', () => {
        if (!state.currentId) return;
        const f = state.filesData.find(f => f.id === state.currentId);
        if (f) { sendViaBot(state.currentId, f.fileName); closeModal(); }
    });

    el.suggestSendViaBot.addEventListener('click', () => {
        if (!state.currentId) return;
        const f = state.filesData.find(f => f.id === state.currentId);
        if (f) { sendViaBot(state.currentId, f.fileName); closeModal(); }
    });

    el.previewSend.addEventListener('click', () => {
        if (state.previewFile) { sendViaBot(state.previewFile.id, state.previewFile.fileName); closePreview(); }
    });

    // ===== CONTROLS =====
    el.refresh.addEventListener('click', () => { firstLoad = false; load(); });

    el.categories.forEach(chip => {
        chip.addEventListener('click', () => {
            el.categories.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.currentCategory = chip.dataset.category;
            filterAndRenderFiles();
            tg?.HapticFeedback?.impactOccurred('light');
        });
    });

    el.sortBtn.addEventListener('click', () => {
        state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
        el.sortText.textContent = state.sortOrder === 'desc' ? 'Latest' : 'Oldest';
        filterAndRenderFiles();
        tg?.HapticFeedback?.impactOccurred('light');
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (el.previewModal.classList.contains('show')) closePreview();
            else if (el.modal.classList.contains('show')) closeModal();
            else if (el.contextMenu.classList.contains('show')) hideContextMenu();
        }
        // Space to toggle music playback when player open
        if (e.key === ' ' && el.previewModal.classList.contains('show') && state.mp.audio) {
            e.preventDefault();
            if (state.mp.isPlaying) { state.mp.audio.pause(); state.mp.isPlaying = false; }
            else { state.mp.audio.play(); state.mp.isPlaying = true; }
            const icon = $('mpPlayIcon');
            if (icon) icon.className = state.mp.isPlaying ? 'fas fa-pause' : 'fas fa-play';
            const art = $('mpArt');
            if (art) art.className = `mp-art ${state.mp.isPlaying ? 'playing' : 'paused'}`;
        }
    });

    // Global handlers (for backward compat if needed)
    window.previewFileHandler = id => { const f = state.filesData.find(f => f.id === id); if (f) openPreview(f); };
    window.sendFileHandler = id => { const f = state.filesData.find(f => f.id === id); if (f) sendViaBot(id, f.fileName); };

    // ===== AUTO REFRESH =====
    setInterval(() => { firstLoad = false; load(); }, 60000);

    // ===== INIT =====
    setTimeout(load, 100);
})();