// ===== GALLERY PAGE JAVASCRIPT =====
(function () {
    const tg = window.Telegram?.WebApp;
    let initData = "";
    let currentUser = null;
    let galleryImages = [];
    let currentLightboxIndex = 0;

    // Initialize Telegram WebApp
    if (tg) {
        tg.ready();
        tg.expand();
        initData = tg.initData || "";
        currentUser = tg.initDataUnsafe?.user;

        // Set theme
        if (tg.colorScheme) {
            document.body.setAttribute('data-tg-theme', tg.colorScheme);
        }
    } else {
        initData = "test_init_data";
        currentUser = {
            id: "123456789",
            first_name: "Test",
            username: "test_user",
            photo_url: ""
        };
    }

    // DOM Elements
    const elements = {
        userAvatar: $('userAvatar'),
        galleryGrid: $('galleryGrid'),
        emptyState: $('emptyState'),
        loadingState: $('loadingState'),
        totalImages: $('totalImages'),
        totalSize: $('totalSize'),
        lastUpdated: $('lastUpdated'),
        lightbox: $('lightbox'),
        lightboxImage: $('lightboxImage'),
        lightboxFilename: $('lightboxFilename'),
        lightboxDate: $('lightboxDate'),
        toast: $('toast'),
        toastMessage: $('toastMessage')
    };

    // Helper function
    function $(id) {
        return document.getElementById(id);
    }

    // Set user avatar
    function setUserAvatar() {
        if (currentUser?.photo_url) {
            elements.userAvatar.src = currentUser.photo_url;
        } else {
            // Default avatar
            elements.userAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.first_name || 'User')}&background=4f8ef7&color=fff`;
        }
    }

    // Load gallery
    async function loadGallery() {
        showLoading(true);

        try {
            const response = await fetch('/api/gallery', {
                headers: {
                    'x-telegram-init-data': initData
                }
            });

            if (!response.ok) {
                throw new Error('Failed to load gallery');
            }

            const data = await response.json();

            if (data.ok) {
                galleryImages = data.images;
                renderGallery();
                updateStats(data.images);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            console.error('Gallery load error:', error);
            showToast('Failed to load gallery', 'error');
            showEmptyState();
        } finally {
            showLoading(false);
        }
    }

    // Render gallery grid
    function renderGallery() {
        if (!galleryImages.length) {
            showEmptyState();
            return;
        }

        elements.galleryGrid.innerHTML = galleryImages.map((img, index) => `
            <div class="gallery-item" data-index="${index}" onclick="openLightbox(${index})">
                <img src="/api/files/${img.id}/preview?initData=${encodeURIComponent(initData)}" 
                     alt="${escapeHtml(img.fileName)}"
                     loading="lazy">
                <div class="gallery-item-overlay">
                    <div class="gallery-item-info">
                        <div class="gallery-item-size">${formatSize(img.fileSize)}</div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Update stats
    function updateStats(images) {
        elements.totalImages.textContent = images.length;

        const totalSize = images.reduce((sum, img) => sum + (img.fileSize || 0), 0);
        elements.totalSize.textContent = formatSize(totalSize);

        const now = new Date();
        elements.lastUpdated.textContent = now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Open lightbox
    window.openLightbox = function (index) {
        currentLightboxIndex = index;
        const img = galleryImages[index];

        elements.lightboxImage.src = `/api/files/${img.id}/preview?initData=${encodeURIComponent(initData)}`;
        elements.lightboxFilename.textContent = img.fileName || 'Image';
        elements.lightboxDate.textContent = formatDate(img.createdAt);

        elements.lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Haptic feedback
        tg?.HapticFeedback?.impactOccurred('light');
    };

    // Close lightbox
    window.closeLightbox = function () {
        elements.lightbox.classList.remove('active');
        document.body.style.overflow = '';
        elements.lightboxImage.src = '';
    };

    // Navigate lightbox
    window.navigateLightbox = function (direction) {
        currentLightboxIndex += direction;

        if (currentLightboxIndex < 0) {
            currentLightboxIndex = galleryImages.length - 1;
        } else if (currentLightboxIndex >= galleryImages.length) {
            currentLightboxIndex = 0;
        }

        const img = galleryImages[currentLightboxIndex];
        elements.lightboxImage.src = `/api/files/${img.id}/preview?initData=${encodeURIComponent(initData)}`;
        elements.lightboxFilename.textContent = img.fileName || 'Image';
        elements.lightboxDate.textContent = formatDate(img.createdAt);

        tg?.HapticFeedback?.impactOccurred('light');
    };

    // Download current image
    window.downloadCurrent = async function () {
        const img = galleryImages[currentLightboxIndex];

        try {
            const response = await fetch(`/api/files/${img.id}/download?initData=${encodeURIComponent(initData)}`);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = img.fileName || 'image.jpg';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            showToast('Downloaded successfully', 'success');
        } catch (error) {
            showToast('Download failed', 'error');
        }
    };

    // Send current image
    window.sendCurrent = async function () {
        const img = galleryImages[currentLightboxIndex];

        try {
            const response = await fetch(`/api/files/${img.id}/send`, {
                method: 'POST',
                headers: {
                    'x-telegram-init-data': initData
                }
            });

            const data = await response.json();

            if (data.ok) {
                showToast('Sent successfully', 'success');
                tg?.HapticFeedback?.notificationOccurred('success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            showToast('Failed to send', 'error');
            tg?.HapticFeedback?.notificationOccurred('error');
        }
    };

    // Delete current image
    window.deleteCurrent = async function () {
        if (!confirm('Are you sure you want to delete this image?')) {
            return;
        }

        const img = galleryImages[currentLightboxIndex];

        try {
            const response = await fetch(`/api/files/${img.id}`, {
                method: 'DELETE',
                headers: {
                    'x-telegram-init-data': initData
                }
            });

            const data = await response.json();

            if (data.ok) {
                showToast('Deleted successfully', 'success');
                galleryImages.splice(currentLightboxIndex, 1);
                renderGallery();
                updateStats(galleryImages);
                closeLightbox();
                tg?.HapticFeedback?.notificationOccurred('success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            showToast('Failed to delete', 'error');
            tg?.HapticFeedback?.notificationOccurred('error');
        }
    };

    // Navigation
    window.goBack = function () {
        if (tg) {
            tg.BackButton.show();
            tg.BackButton.onClick(() => {
                window.location.href = '/app';
            });
        } else {
            window.location.href = '/app';
        }
    };

    window.goToMain = function () {
        window.location.href = '/app';
    };

    // UI Helpers
    function showLoading(show) {
        elements.loadingState.style.display = show ? 'block' : 'none';
        elements.galleryGrid.style.display = show ? 'none' : 'grid';
    }

    function showEmptyState() {
        elements.emptyState.style.display = 'block';
        elements.galleryGrid.style.display = 'none';
        elements.loadingState.style.display = 'none';
    }

    function showToast(message, type = 'info') {
        elements.toastMessage.textContent = message;
        elements.toast.className = `toast ${type} show`;

        setTimeout(() => {
            elements.toast.classList.remove('show');
        }, 3000);
    }

    function formatSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        let size = bytes;

        while (size >= 1024 && i < units.length - 1) {
            size /= 1024;
            i++;
        }

        return `${size.toFixed(i ? 1 : 0)} ${units[i]}`;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (!elements.lightbox.classList.contains('active')) return;

        if (e.key === 'Escape') {
            closeLightbox();
        } else if (e.key === 'ArrowLeft') {
            navigateLightbox(-1);
        } else if (e.key === 'ArrowRight') {
            navigateLightbox(1);
        }
    });

    // Initialize
    setUserAvatar();
    loadGallery();

    // Auto refresh every 60 seconds
    setInterval(loadGallery, 60000);
})();