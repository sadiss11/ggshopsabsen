/**
 * Portal Karyawan - Jurnal Kerja
 * Daily work journal functionality
 */

const jurnal = {
    currentDate: new Date(),
    jurnals: [],
    filter: '',
    sort: 'newest',
    currentPhoto: null,

    async init() {
        await this.loadJurnals();
        this.initDateSelector();
        this.initForm();
        this.initFilters();
        this.initPhotoUpload();
        this.renderJurnalList();
        this.updateUI();
    },

    async loadJurnals() {
        const currentUser = auth.getCurrentUser();
        const userId = currentUser?.id || 'demo-user';
        try {
            const result = await api.getJournals(userId);
            this.jurnals = result.data || [];
        } catch (error) {
            console.error('Error loading journals:', error);
            this.jurnals = storage.get('jurnals', []);
        }
    },

    initDateSelector() {
        const prevBtn = document.getElementById('prev-date');
        const nextBtn = document.getElementById('next-date');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.changeDate(-1));
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.changeDate(1));
        }
    },

    changeDate(direction) {
        this.currentDate.setDate(this.currentDate.getDate() + direction);
        this.updateUI();
    },

    initForm() {
        const form = document.getElementById('jurnal-form');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
    },

    initFilters() {
        // Search filter
        const searchInput = document.querySelector('.jurnal-history-card .search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filter = e.target.value.toLowerCase();
                this.renderJurnalList();
            });
        }

        // Sort filter
        const sortSelect = document.querySelector('.jurnal-history-card .select-filter');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sort = e.target.value === 'Terbaru' ? 'newest' : 'oldest';
                this.renderJurnalList();
            });
        }
    },

    initPhotoUpload() {
        const fileInput = document.getElementById('jurnal-photo');
        const uploadArea = document.getElementById('jurnal-upload-area');
        const filePreview = document.getElementById('jurnal-file-preview');
        const imagePreview = document.getElementById('jurnal-image-preview');
        const removeBtn = document.getElementById('jurnal-btn-remove-file');

        if (!fileInput || !uploadArea) return;

        // Click to upload
        uploadArea.addEventListener('click', () => fileInput.click());

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                this.handlePhoto(e.dataTransfer.files[0]);
            }
        });

        // File selected
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                this.handlePhoto(e.target.files[0]);
            }
        });

        // Remove photo
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removePhoto();
            });
        }
    },

    handlePhoto(file) {
        const maxSize = 5 * 1024 * 1024; // 5MB
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];

        if (file.size > maxSize) {
            toast.error('Foto terlalu besar. Maksimum 5MB');
            return;
        }

        if (!allowedTypes.includes(file.type)) {
            toast.error('Format file tidak didukung. Gunakan JPG atau PNG');
            return;
        }

        // Convert to base64
        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentPhoto = e.target.result;
            this.showPhotoPreview();
        };
        reader.readAsDataURL(file);
    },

    showPhotoPreview() {
        const uploadArea = document.getElementById('jurnal-upload-area');
        const filePreview = document.getElementById('jurnal-file-preview');
        const imagePreview = document.getElementById('jurnal-image-preview');

        if (uploadArea) uploadArea.style.display = 'none';
        if (filePreview) filePreview.style.display = 'block';
        if (imagePreview) imagePreview.src = this.currentPhoto;
    },

    removePhoto() {
        this.currentPhoto = null;
        const fileInput = document.getElementById('jurnal-photo');
        const uploadArea = document.getElementById('jurnal-upload-area');
        const filePreview = document.getElementById('jurnal-file-preview');

        if (fileInput) fileInput.value = '';
        if (uploadArea) uploadArea.style.display = 'block';
        if (filePreview) filePreview.style.display = 'none';
    },

    async handleSubmit(e) {
        e.preventDefault();

        const dateStr = this.currentDate.toISOString().split('T')[0];
        const tasks = document.getElementById('jurnal-tasks').value;
        const achievements = document.getElementById('jurnal-achievements').value;
        const obstacles = document.getElementById('jurnal-obstacles').value;
        const plan = document.getElementById('jurnal-plan').value;

        const currentUser = auth.getCurrentUser();

        const jurnalData = {
            date: dateStr,
            userId: currentUser?.id || 'demo-user',
            tasks,
            achievements,
            obstacles,
            plan,
            photo: this.currentPhoto,
            updatedAt: new Date().toISOString()
        };

        try {
            await api.saveJournal(jurnalData);

            // Update local data
            const existingIndex = this.jurnals.findIndex(j => j.date === dateStr);
            if (existingIndex >= 0) {
                this.jurnals[existingIndex] = jurnalData;
            } else {
                this.jurnals.unshift(jurnalData);
            }

            toast.success('Jurnal berhasil disimpan!');
        } catch (error) {
            console.error('Error saving journal:', error);
            toast.error('Gagal menyimpan jurnal');
        }

        // Reset photo after save
        this.currentPhoto = null;
        this.hidePhotoPreview();

        this.renderJurnalList();
        this.updateSummary();
        this.updateStatusBadge('filled');
    },

    updateUI() {
        const dateDisplay = document.getElementById('jurnal-current-date');
        if (dateDisplay) {
            dateDisplay.textContent = dateTime.formatDate(this.currentDate, 'short');
        }

        // Load jurnal for current date if exists
        const dateStr = this.currentDate.toISOString().split('T')[0];
        const jurnal = this.jurnals.find(j => j.date === dateStr);

        const tasksEl = document.getElementById('jurnal-tasks');
        const achievementsEl = document.getElementById('jurnal-achievements');
        const obstaclesEl = document.getElementById('jurnal-obstacles');
        const planEl = document.getElementById('jurnal-plan');

        if (jurnal) {
            if (tasksEl) tasksEl.value = jurnal.tasks || '';
            if (achievementsEl) achievementsEl.value = jurnal.achievements || '';
            if (obstaclesEl) obstaclesEl.value = jurnal.obstacles || '';
            if (planEl) planEl.value = jurnal.plan || '';

            // Load existing photo
            if (jurnal.photo) {
                this.currentPhoto = jurnal.photo;
                this.updatePhotoPreview(jurnal.photo);
            } else {
                this.currentPhoto = null;
                this.hidePhotoPreview();
            }

            this.updateStatusBadge('filled');
        } else {
            // Reset photo
            this.currentPhoto = null;
            this.hidePhotoPreview();
            if (tasksEl) tasksEl.value = '';
            if (achievementsEl) achievementsEl.value = '';
            if (obstaclesEl) obstaclesEl.value = '';
            if (planEl) planEl.value = '';

            // Check if date is today or future
            const today = new Date().toISOString().split('T')[0];
            if (dateStr === today) {
                this.updateStatusBadge('empty');
            } else if (dateStr > today) {
                this.updateStatusBadge('pending');
            } else {
                this.updateStatusBadge('empty');
            }
        }

        // Disable form for future dates
        const form = document.getElementById('jurnal-form');
        if (form) {
            const isFuture = dateStr > today;
            const submitBtn = form.querySelector('button[type="submit"]');

            Array.from(form.querySelectorAll('textarea')).forEach(textarea => {
                textarea.disabled = isFuture;
            });

            if (submitBtn) {
                submitBtn.disabled = isFuture;
                submitBtn.style.opacity = isFuture ? '0.5' : '1';
            }
        }
    },

    updateStatusBadge(status) {
        const badge = document.getElementById('jurnal-status');
        if (!badge) return;

        badge.className = 'entry-status';

        switch (status) {
            case 'filled':
                badge.classList.add('filled');
                badge.textContent = 'Tersimpan';
                break;
            case 'empty':
                badge.classList.add('empty');
                badge.textContent = 'Belum Diisi';
                break;
            case 'pending':
                badge.classList.add('pending');
                badge.textContent = 'Menunggu';
                break;
        }
    },

    renderJurnalList() {
        const list = document.getElementById('jurnal-list');
        if (!list) return;

        // Filter jurnals
        let filteredJurnals = this.jurnals.filter(j => {
            if (!this.filter) return true;
            return j.tasks?.toLowerCase().includes(this.filter) ||
                j.achievements?.toLowerCase().includes(this.filter);
        });

        // Sort jurnals
        filteredJurnals.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return this.sort === 'newest' ? dateB - dateA : dateA - dateB;
        });

        // Take first 10
        const recentJurnals = filteredJurnals.slice(0, 10);

        if (recentJurnals.length === 0) {
            list.innerHTML = `
                <div class="empty-state" style="text-align: center; padding: var(--spacing-xl); color: var(--text-muted);">
                    <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: var(--spacing);"></i>
                    <p>${this.filter ? 'Tidak ada jurnal yang sesuai' : 'Belum ada jurnal'}</p>
                </div>
            `;
            return;
        }

        list.innerHTML = recentJurnals.map(jurnal => {
            const date = new Date(jurnal.date);
            const dayName = dateTime.formatDate(date, 'day');
            const day = date.getDate();
            const month = date.toLocaleDateString('id-ID', { month: 'short' });
            const preview = jurnal.tasks?.substring(0, 60) + '...' || 'Tidak ada deskripsi';
            const hasPhoto = jurnal.photo ? '<span class="photo-badge"><i class="fas fa-image"></i></span>' : '';

            return `
                <div class="jurnal-item">
                    <div class="jurnal-item-header">
                        <div class="jurnal-date">
                            <span class="date-day">${day}</span>
                            <span class="date-month">${month}</span>
                        </div>
                        <div class="jurnal-meta">
                            <span class="jurnal-day">${dayName}</span>
                            <span class="jurnal-time">${dateTime.formatTime(jurnal.updatedAt)} ${hasPhoto}</span>
                        </div>
                    </div>
                    <div class="jurnal-content">
                        <p class="jurnal-preview">${preview}</p>
                    </div>
                    <div class="jurnal-actions">
                        <button class="btn-icon-sm" title="Lihat Detail" onclick="jurnal.viewDetail('${jurnal.date}')">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon-sm" title="Edit" onclick="jurnal.editJurnal('${jurnal.date}')">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    updateSummary() {
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();

        // Count jurnals for current month
        const monthJurnals = this.jurnals.filter(j => {
            const date = new Date(j.date);
            return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
        });

        // Count filled days
        const filledCount = monthJurnals.length;

        // Calculate working days passed this month
        const today = new Date().getDate();
        const workingDaysPassed = Math.min(today, 26); // Assume ~26 working days per month

        // Calculate streak
        let streak = 0;
        const sortedDates = [...this.jurnals]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .map(j => j.date);

        if (sortedDates.length > 0) {
            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (sortedDates[0] === today || sortedDates[0] === yesterdayStr) {
                streak = 1;
                for (let i = 1; i < sortedDates.length; i++) {
                    const curr = new Date(sortedDates[i - 1]);
                    const prev = new Date(sortedDates[i]);
                    const diff = (curr - prev) / (1000 * 60 * 60 * 24);

                    if (diff === 1) {
                        streak++;
                    } else {
                        break;
                    }
                }
            }
        }

        // Update UI
        const summaryItems = document.querySelectorAll('.summary-value');
        if (summaryItems.length >= 3) {
            summaryItems[0].textContent = filledCount;
            summaryItems[1].textContent = Math.max(0, workingDaysPassed - filledCount);
            summaryItems[2].textContent = streak;
        }
    },

    viewDetail(date) {
        const jurnal = this.jurnals.find(j => j.date === date);
        if (!jurnal) return;

        // Create modal content
        const photoHtml = jurnal.photo ? `
            <div class="detail-photo">
                <label>Foto Lampiran:</label>
                <img src="${jurnal.photo}" alt="Foto jurnal" onclick="window.open('${jurnal.photo}', '_blank')">
            </div>
        ` : '';

        const modalContent = `
            <div class="jurnal-detail-modal">
                <h3>Detail Jurnal - ${dateTime.formatDate(new Date(date), 'long')}</h3>
                <div class="detail-section">
                    <label>Tugas:</label>
                    <p>${jurnal.tasks?.replace(/\n/g, '<br>') || '-'}</p>
                </div>
                <div class="detail-section">
                    <label>Pencapaian:</label>
                    <p>${jurnal.achievements?.replace(/\n/g, '<br>') || '-'}</p>
                </div>
                <div class="detail-section">
                    <label>Kendala:</label>
                    <p>${jurnal.obstacles?.replace(/\n/g, '<br>') || '-'}</p>
                </div>
                <div class="detail-section">
                    <label>Rencana:</label>
                    <p>${jurnal.plan?.replace(/\n/g, '<br>') || '-'}</p>
                </div>
                ${photoHtml}
            </div>
        `;

        modal.show('Detail Jurnal', modalContent, [
            { label: 'Tutup', class: 'btn-secondary', onClick: () => modal.close() },
            { label: 'Edit', class: 'btn-primary', onClick: () => { modal.close(); this.editJurnal(date); } }
        ]);
    },

    editJurnal(date) {
        this.currentDate = new Date(date);
        this.updateUI();
    }
};

// Global init function
window.initJurnal = () => {
    jurnal.init();
};

// Expose jurnal object for onclick handlers
window.jurnal = jurnal;
