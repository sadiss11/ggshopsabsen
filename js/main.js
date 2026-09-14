/**
 * Portal Karyawan - Main JavaScript
 * Utility functions and shared functionality
 */

// Storage Manager
const storage = {
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    },

    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    },

    remove(key) {
        localStorage.removeItem(key);
    },

    clear() {
        localStorage.clear();
    }
};

// Toast Notification System
const toast = {
    container: null,

    init() {
        this.container = document.getElementById('toast-container');
    },

    show(message, type = 'info', title = '', duration = 3000) {
        if (!this.container) this.init();

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-times-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        const titles = {
            success: 'Berhasil',
            error: 'Error',
            warning: 'Peringatan',
            info: 'Info'
        };

        const toastEl = document.createElement('div');
        toastEl.className = `toast ${type}`;
        toastEl.innerHTML = `
            <div class="toast-icon">
                <i class="fas ${icons[type]}"></i>
            </div>
            <div class="toast-content">
                <div class="toast-title">${title || titles[type]}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

        this.container.appendChild(toastEl);

        // Auto remove
        setTimeout(() => {
            toastEl.style.opacity = '0';
            toastEl.style.transform = 'translateX(100%)';
            setTimeout(() => toastEl.remove(), 300);
        }, duration);
    },

    success(message, title) {
        this.show(message, 'success', title);
    },

    error(message, title) {
        this.show(message, 'error', title);
    },

    warning(message, title) {
        this.show(message, 'warning', title);
    },

    info(message, title) {
        this.show(message, 'info', title);
    }
};

// Date & Time Utilities
const dateTime = {
    formatDate(date, format = 'full') {
        const d = new Date(date);
        const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

        const dayName = days[d.getDay()];
        const day = d.getDate();
        const month = months[d.getMonth()];
        const year = d.getFullYear();

        if (format === 'full') {
            return `${dayName}, ${day} ${month} ${year}`;
        } else if (format === 'short') {
            return `${day} ${months[d.getMonth()].substring(0, 3)} ${year}`;
        } else if (format === 'day') {
            return dayName;
        }
        return `${day}/${d.getMonth() + 1}/${year}`;
    },

    formatTime(date) {
        const d = new Date(date);
        return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    },

    formatDateTime(date) {
        return `${this.formatDate(date)} ${this.formatTime(date)}`;
    },

    getCurrentTime() {
        return new Date().toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    },

    getCurrentDate() {
        return this.formatDate(new Date());
    },

    getLocalDate() {
        // Returns YYYY-MM-DD for the local timezone, not UTC
        const today = new Date();
        return new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    },

    getGreeting() {
        const hour = new Date().getHours();
        if (hour < 11) return 'Selamat Pagi';
        if (hour < 15) return 'Selamat Siang';
        if (hour < 18) return 'Selamat Sore';
        return 'Selamat Malam';
    },

    calculateDuration(start, end) {
        const startTime = new Date(`2000-01-01 ${start}`);
        const endTime = new Date(`2000-01-01 ${end}`);
        const diff = endTime - startTime;

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);

        return `${hours}j ${minutes}m`;
    }
};

// Form Utilities
const formUtils = {
    serialize(form) {
        const formData = new FormData(form);
        const data = {};
        for (let [key, value] of formData.entries()) {
            data[key] = value;
        }
        return data;
    },

    validate(form) {
        const inputs = form.querySelectorAll('input[required], textarea[required], select[required]');
        let isValid = true;

        inputs.forEach(input => {
            if (!input.value.trim()) {
                isValid = false;
                input.classList.add('error');
                input.addEventListener('input', () => input.classList.remove('error'), { once: true });
            }
        });

        return isValid;
    },

    clear(form) {
        form.reset();
        form.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    }
};

// Animation Utilities
const animations = {
    fadeIn(element, duration = 300) {
        element.style.opacity = '0';
        element.style.display = 'block';
        element.style.transition = `opacity ${duration}ms ease`;

        requestAnimationFrame(() => {
            element.style.opacity = '1';
        });
    },

    fadeOut(element, duration = 300) {
        element.style.transition = `opacity ${duration}ms ease`;
        element.style.opacity = '0';

        setTimeout(() => {
            element.style.display = 'none';
        }, duration);
    },

    slideDown(element, duration = 300) {
        element.style.maxHeight = '0';
        element.style.overflow = 'hidden';
        element.style.transition = `max-height ${duration}ms ease`;

        requestAnimationFrame(() => {
            element.style.maxHeight = element.scrollHeight + 'px';
        });
    }
};

// Initialize default data
function initializeData() {
    // Company settings
    if (!storage.get('company')) {
        storage.set('company', {
            name: 'Portal Karyawan',
            logo: ''
        });
    }

    // Shifts
    if (!storage.get('shifts')) {
        storage.set('shifts', [
            { id: 1, name: 'Pagi', startTime: '08:00', endTime: '17:00' },
            { id: 2, name: 'Siang', startTime: '14:00', endTime: '23:00' },
            { id: 3, name: 'Malam', startTime: '23:00', endTime: '08:00' }
        ]);
    }

    // Dummy attendance data
    if (!storage.get('attendance')) {
        storage.set('attendance', [
            { date: '2026-03-06', shift: 'Pagi', clockIn: '07:55', clockOut: '17:15', status: 'ontime' },
            { date: '2026-03-05', shift: 'Pagi', clockIn: '08:10', clockOut: '17:05', status: 'late' },
            { date: '2026-03-04', shift: 'Pagi', clockIn: '07:50', clockOut: '17:20', status: 'ontime' }
        ]);
    }

    // Dummy jurnal data
    if (!storage.get('jurnals')) {
        storage.set('jurnals', [
            {
                date: '2026-03-06',
                tasks: 'Mengerjakan fitur dashboard, meeting dengan tim development',
                achievements: 'Selesai membuat komponen chart',
                obstacles: 'Kendala pada integrasi API',
                plan: 'Melanjutkan integrasi API'
            },
            {
                date: '2026-03-05',
                tasks: 'Fix bug pada modul absensi, update UI',
                achievements: 'Bug fixed',
                obstacles: '',
                plan: 'Testing'
            }
        ]);
    }

    // Dummy leave data
    if (!storage.get('leaves')) {
        storage.set('leaves', [
            {
                id: 1,
                type: 'annual',
                typeLabel: 'Cuti Tahunan',
                startDate: '2026-03-15',
                endDate: '2026-03-17',
                duration: 3,
                reason: 'Liburan keluarga',
                status: 'pending',
                appliedAt: '2026-03-01'
            },
            {
                id: 2,
                type: 'sick',
                typeLabel: 'Cuti Sakit',
                startDate: '2026-02-20',
                endDate: '2026-02-20',
                duration: 1,
                reason: 'Demam dan flu',
                status: 'approved',
                appliedAt: '2026-02-19'
            },
            {
                id: 3,
                type: 'important',
                typeLabel: 'Cuti Penting',
                startDate: '2026-02-10',
                endDate: '2026-02-10',
                duration: 1,
                reason: 'Urusan keluarga',
                status: 'rejected',
                appliedAt: '2026-02-08'
            }
        ]);
    }

    // Dummy izin data
    if (!storage.get('izin')) {
        storage.set('izin', []);
    }

    // Dummy admin employees data
    if (!storage.get('admin_employees')) {
        storage.set('admin_employees', [
            { id: 1, name: 'Ahmad Rizky', email: 'ahmad@company.com', department: 'IT', position: 'Developer', shift: 'Pagi', status: 'active', joinDate: '2024-01-15', avatar: 'https://ui-avatars.com/api/?name=Ahmad&background=3B82F6&color=fff' },
            { id: 2, name: 'Budi Santoso', email: 'budi@company.com', department: 'HR', position: 'HR Manager', shift: 'Pagi', status: 'active', joinDate: '2023-06-01', avatar: 'https://ui-avatars.com/api/?name=Budi&background=10B981&color=fff' },
            { id: 3, name: 'Citra Dewi', email: 'citra@company.com', department: 'Finance', position: 'Accountant', shift: 'Pagi', status: 'on-leave', joinDate: '2024-03-10', avatar: 'https://ui-avatars.com/api/?name=Citra&background=F59E0B&color=fff' },
            { id: 4, name: 'Dedi Pratama', email: 'dedi@company.com', department: 'Marketing', position: 'Marketing Staff', shift: 'Siang', status: 'active', joinDate: '2024-02-20', avatar: 'https://ui-avatars.com/api/?name=Dedi&background=EF4444&color=fff' },
            { id: 5, name: 'Eka Putri', email: 'eka@company.com', department: 'IT', position: 'UI/UX Designer', shift: 'Pagi', status: 'active', joinDate: '2024-01-05', avatar: 'https://ui-avatars.com/api/?name=Eka&background=8B5CF6&color=fff' },
            { id: 6, name: 'Fajar Nugraha', email: 'fajar@company.com', department: 'Operations', position: 'Supervisor', shift: 'Malam', status: 'inactive', joinDate: '2023-09-12', avatar: 'https://ui-avatars.com/api/?name=Fajar&background=6B7280&color=fff' }
        ]);
    }
}

// Update company name in UI
function updateCompanyUI() {
    const company = storage.get('company', { name: 'Portal Karyawan' });

    const elements = {
        'login-company-name': company.name,
        'footer-company': company.name,
        'sidebar-brand': company.name.substring(0, 10)
    };

    Object.entries(elements).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });

    document.title = company.name;
}

// DOM Ready
function onDOMReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
    } else {
        callback();
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeData();
    updateCompanyUI();

    // Update time display
    const timeEl = document.getElementById('current-time');
    if (timeEl) {
        setInterval(() => {
            const now = new Date();
            const time = timeEl.querySelector('.time');
            const date = timeEl.querySelector('.date');
            if (time) time.textContent = dateTime.formatTime(now);
            if (date) date.textContent = dateTime.formatDate(now);
        }, 1000);
    }
});

// Export for other modules
window.storage = storage;
window.toast = toast;
window.dateTime = dateTime;
window.formUtils = formUtils;
window.animations = animations;
window.updateCompanyUI = updateCompanyUI;
window.onDOMReady = onDOMReady;
