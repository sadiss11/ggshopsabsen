/**
 * Portal Karyawan - Settings
 * Admin settings functionality
 */

const settings = {
    shifts: [],

    async init() {
        // Check if admin
        if (!auth.isAdmin()) {
            toast.error('Anda tidak memiliki akses ke halaman ini!');
            router.navigate('dashboard');
            return;
        }

        await this.loadSettings();
        this.initForms();
        this.renderShifts();
    },

    async loadSettings() {
        try {
            const [settingsResult, shiftsResult] = await Promise.all([
                api.getSettings(),
                api.getShifts()
            ]);

            // Fix shift times - Google Sheets converts "08:00" to Date objects
            this.shifts = (shiftsResult.data || []).map(shift => ({
                ...shift,
                startTime: this.normalizeTime(shift.startTime),
                endTime: this.normalizeTime(shift.endTime)
            }));

            const allSettings = settingsResult.data || {};

            // Company info
            const companyName = document.getElementById('company-name');
            const companyLogo = document.getElementById('company-logo');
            if (companyName) companyName.value = allSettings.company_name || '';
            if (companyLogo) companyLogo.value = allSettings.company_logo || '';

            // Working days
            const workdays = allSettings.working_days ? JSON.parse(allSettings.working_days) : null;
            if (workdays) {
                const days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
                days.forEach(day => {
                    const el = document.getElementById(`day-${day}`);
                    if (el) el.checked = workdays[day] !== false;
                });
            }

            // System settings
            if (allSettings.late_tolerance !== undefined) {
                const el = document.getElementById('setting-late-tolerance');
                if (el) el.value = allSettings.late_tolerance;
            }
            if (allSettings.face_recognition !== undefined) {
                const el = document.getElementById('setting-face-recognition');
                if (el) el.checked = allSettings.face_recognition === 'true' || allSettings.face_recognition === true;
            }
            if (allSettings.location_tracking !== undefined) {
                const el = document.getElementById('setting-location-tracking');
                if (el) el.checked = allSettings.location_tracking === 'true' || allSettings.location_tracking === true;
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            this.shifts = storage.get('shifts', []);
            const company = storage.get('company', { name: '', logo: '' });
            const companyName = document.getElementById('company-name');
            const companyLogo = document.getElementById('company-logo');
            if (companyName) companyName.value = company.name;
            if (companyLogo) companyLogo.value = company.logo;
        }
    },

    /**
     * Normalize time values from Google Sheets.
     * Sheets converts "08:00" to a Date (e.g. "1899-12-30T01:00:00.000Z").
     * This extracts HH:mm from whatever format we get.
     */
    normalizeTime(val) {
        if (!val) return '09:00';
        const str = String(val);
        // Already HH:mm format
        if (/^\d{2}:\d{2}$/.test(str)) return str;
        // ISO date string from Sheets - extract time portion based on timezone offset
        if (str.includes('T') || str.includes('1899')) {
            try {
                const d = new Date(str);
                // Google Sheets stores time as a date in 1899 with UTC offset
                // We need to get the time in the original timezone (Asia/Jakarta UTC+7)
                const hours = String(d.getUTCHours() + 7).padStart(2, '0');
                const mins = String(d.getUTCMinutes()).padStart(2, '0');
                const h = parseInt(hours) % 24;
                return String(h).padStart(2, '0') + ':' + mins;
            } catch (e) {
                return '09:00';
            }
        }
        return str;
    },

    initForms() {
        // Company form
        const companyForm = document.getElementById('company-form');
        if (companyForm) {
            companyForm.addEventListener('submit', (e) => this.saveCompany(e));
        }

        // Add shift button
        const addShiftBtn = document.getElementById('btn-add-shift');
        if (addShiftBtn) {
            addShiftBtn.addEventListener('click', () => this.addShift());
        }

        // Save working days
        const saveWorkdaysBtn = document.getElementById('btn-save-workdays');
        if (saveWorkdaysBtn) {
            saveWorkdaysBtn.addEventListener('click', () => this.saveWorkdays());
        }

        // Save system settings
        const saveSystemBtn = document.getElementById('btn-save-system');
        if (saveSystemBtn) {
            saveSystemBtn.addEventListener('click', () => this.saveSystemSettings());
        }
    },

    async saveCompany(e) {
        e.preventDefault();

        const name = document.getElementById('company-name').value;
        const logo = document.getElementById('company-logo').value;

        try {
            await Promise.all([
                api.saveSetting('company_name', name),
                api.saveSetting('company_logo', logo)
            ]);
            // Also update localStorage for immediate UI update
            storage.set('company', { name, logo });
            updateCompanyUI();
            toast.success('Informasi perusahaan berhasil disimpan!');
        } catch (error) {
            console.error('Error saving company:', error);
            toast.error('Gagal menyimpan');
        }
    },

    async saveWorkdays() {
        const days = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
        const workdays = {};
        days.forEach(day => {
            const el = document.getElementById(`day-${day}`);
            workdays[day] = el ? el.checked : false;
        });

        try {
            await api.saveSetting('working_days', JSON.stringify(workdays));
            toast.success('Hari kerja berhasil disimpan!');
        } catch (error) {
            console.error('Error saving workdays:', error);
            toast.error('Gagal menyimpan hari kerja');
        }
    },

    async saveSystemSettings() {
        const lateTolerance = document.getElementById('setting-late-tolerance');
        const faceRecognition = document.getElementById('setting-face-recognition');
        const locationTracking = document.getElementById('setting-location-tracking');

        try {
            await Promise.all([
                api.saveSetting('late_tolerance', lateTolerance ? lateTolerance.value : '15'),
                api.saveSetting('face_recognition', faceRecognition ? String(faceRecognition.checked) : 'true'),
                api.saveSetting('location_tracking', locationTracking ? String(locationTracking.checked) : 'true')
            ]);
            toast.success('Pengaturan sistem berhasil disimpan!');
        } catch (error) {
            console.error('Error saving system settings:', error);
            toast.error('Gagal menyimpan pengaturan sistem');
        }
    },

    renderShifts() {
        const container = document.getElementById('shifts-list');
        if (!container) return;

        if (this.shifts.length === 0) {
            container.innerHTML = '<p class="empty-state">Belum ada shift</p>';
            return;
        }

        container.innerHTML = this.shifts.map((shift, index) => `
            <div class="shift-item" data-index="${index}">
                <div class="shift-input-group">
                    <label>Nama Shift</label>
                    <input type="text" value="${shift.name}" placeholder="Nama Shift" 
                           onchange="settings.updateShift(${index}, 'name', this.value)">
                </div>
                <div class="shift-input-group">
                    <label>Jam Masuk</label>
                    <input type="time" value="${shift.startTime}" 
                           onchange="settings.updateShift(${index}, 'startTime', this.value)">
                </div>
                <div class="shift-input-group">
                    <label>Jam Pulang</label>
                    <input type="time" value="${shift.endTime}" 
                           onchange="settings.updateShift(${index}, 'endTime', this.value)">
                </div>
                <button type="button" class="btn-delete-shift" onclick="settings.deleteShift(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    },

    async addShift() {
        const newShift = {
            name: 'Shift Baru',
            startTime: '09:00',
            endTime: '18:00'
        };

        try {
            const result = await api.addShift(newShift);
            if (result.success) {
                this.shifts.push(result.data);
                this.renderShifts();
                toast.success('Shift baru ditambahkan!');
            }
        } catch (error) {
            console.error('Error adding shift:', error);
        }
    },

    async updateShift(index, field, value) {
        if (this.shifts[index]) {
            this.shifts[index][field] = value;
            try {
                await api.updateShift(this.shifts[index].id, { [field]: value });
                toast.success('Shift berhasil diperbarui!');
            } catch (error) {
                console.error('Error updating shift:', error);
            }
        }
    },

    async deleteShift(index) {
        if (confirm('Apakah Anda yakin ingin menghapus shift ini?')) {
            try {
                const shiftId = this.shifts[index].id;
                await api.deleteShift(shiftId);
                this.shifts.splice(index, 1);
                this.renderShifts();
                toast.info('Shift dihapus');
            } catch (error) {
                console.error('Error deleting shift:', error);
            }
        }
    },

    getShiftOptions() {
        return this.shifts.map(shift => ({
            value: shift.name,
            label: `${shift.name} (${shift.startTime} - ${shift.endTime})`
        }));
    }
};

// Global init function
window.initSettings = () => {
    settings.init();
};

// Expose settings object
window.settings = settings;
