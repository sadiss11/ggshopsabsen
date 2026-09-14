/**
 * Portal Karyawan - API Layer
 * Abstraction layer for backend communication
 * 
 * Mode:
 * - Jika API_BASE_URL kosong → fallback ke localStorage (untuk testing lokal)
 * - Jika API_BASE_URL diisi → semua request dikirim ke Google Apps Script
 */

const API_BASE_URL = 'https://https://script.google.com/macros/s/AKfycbzQYPLurLNUdLrCtm3JpWw5-QSlu4S1LfcZ85q7RgGWNwIOqeM0nLM5IHK6wHZrjJzD/exec'; // Kosongkan untuk mode localStorage, isi dengan URL Web App GAS

const api = {

    // ========== CORE REQUEST ==========

    async request(action, data = {}) {
        // Jika API_BASE_URL kosong, gunakan localStorage fallback
        if (!API_BASE_URL) {
            return this._localFallback(action, data);
        }

        try {
            const response = await fetch(API_BASE_URL, {
                method: 'POST',
                redirect: 'follow',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action, ...data })
            });

            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                console.error('Failed to parse response:', text.substring(0, 200));
                return { success: false, error: 'Invalid response from server' };
            }
        } catch (error) {
            console.error('API Error:', error);
            // Fallback to localStorage on network error
            return this._localFallback(action, data);
        }
    },

    // ========== AUTH ==========

    async login(email, password) {
        if (!API_BASE_URL) {
            return this._localLogin(email, password);
        }
        return this.request('login', { email, password });
    },

    async changePassword(userId, oldPassword, newPassword) {
        if (!API_BASE_URL) {
            return { success: true, data: { message: 'Password changed (local)' } };
        }
        return this.request('changePassword', { userId, oldPassword, newPassword });
    },

    async getEmployeeProfile(userId) {
        if (!API_BASE_URL) {
            return { success: true, data: {} };
        }
        return this.request('getEmployeeProfile', { userId });
    },

    // ========== ATTENDANCE ==========

    async getAttendance(userId) {
        if (!API_BASE_URL) {
            const all = storage.get('attendance', []);
            return { success: true, data: all };
        }
        return this.request('getAttendance', { userId });
    },

    async getTodayAttendance(userId) {
        if (!API_BASE_URL) {
            const today = dateTime.getLocalDate();
            const all = storage.get('attendance', []);
            const todayRecord = all.find(a => a.date === today);
            return {
                success: true,
                data: todayRecord || {
                    date: today, shift: 'Pagi', clockIn: null, clockOut: null,
                    breakStart: null, breakEnd: null, overtimeStart: null, status: 'waiting'
                }
            };
        }
        return this.request('getTodayAttendance', { userId });
    },

    async saveAttendance(data) {
        if (!API_BASE_URL) {
            const all = storage.get('attendance', []);
            const idx = all.findIndex(a => a.date === data.date);
            if (idx >= 0) { all[idx] = data; } else { all.unshift(data); }
            storage.set('attendance', all);
            return { success: true, data: data };
        }
        return this.request('saveAttendance', data);
    },

    async getAllAttendance() {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('attendance', []) };
        }
        return this.request('getAllAttendance');
    },

    // ========== JOURNALS ==========

    async getJournals(userId) {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('jurnals', []) };
        }
        return this.request('getJournals', { userId });
    },

    async saveJournal(data) {
        if (!API_BASE_URL) {
            const all = storage.get('jurnals', []);
            const idx = all.findIndex(j => j.date === data.date);
            if (idx >= 0) { all[idx] = data; } else { all.unshift(data); }
            storage.set('jurnals', all);
            return { success: true, data: data };
        }
        return this.request('saveJournal', data);
    },

    async getAllJournals() {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('jurnals', []) };
        }
        return this.request('getAllJournals');
    },

    // ========== LEAVES (CUTI) ==========

    async getLeaves(userId) {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('leaves', []) };
        }
        return this.request('getLeaves', { userId });
    },

    async submitLeave(data) {
        if (!API_BASE_URL) {
            const all = storage.get('leaves', []);
            data.id = Date.now();
            data.status = 'pending';
            data.appliedAt = new Date().toISOString();
            all.unshift(data);
            storage.set('leaves', all);
            return { success: true, data: data };
        }
        return this.request('submitLeave', data);
    },

    async approveLeave(id) {
        if (!API_BASE_URL) {
            const all = storage.get('leaves', []);
            const leave = all.find(l => l.id === id);
            if (leave) { leave.status = 'approved'; storage.set('leaves', all); }
            return { success: true, data: leave };
        }
        return this.request('approveLeave', { id });
    },

    async rejectLeave(id) {
        if (!API_BASE_URL) {
            const all = storage.get('leaves', []);
            const leave = all.find(l => l.id === id);
            if (leave) { leave.status = 'rejected'; storage.set('leaves', all); }
            return { success: true, data: leave };
        }
        return this.request('rejectLeave', { id });
    },

    async getAllLeaves() {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('leaves', []) };
        }
        return this.request('getAllLeaves');
    },

    // ========== IZIN / PERMISSION ==========

    async getIzin(userId) {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('izin', []) };
        }
        return this.request('getIzin', { userId });
    },

    async submitIzin(data) {
        if (!API_BASE_URL) {
            const all = storage.get('izin', []);
            data.id = Date.now();
            data.status = 'pending';
            data.appliedAt = new Date().toISOString();
            all.unshift(data);
            storage.set('izin', all);
            return { success: true, data: data };
        }
        return this.request('submitIzin', data);
    },

    async approveIzin(id) {
        if (!API_BASE_URL) {
            const all = storage.get('izin', []);
            const item = all.find(i => i.id === id);
            if (item) { item.status = 'approved'; storage.set('izin', all); }
            return { success: true, data: item };
        }
        return this.request('approveIzin', { id });
    },

    async rejectIzin(id) {
        if (!API_BASE_URL) {
            const all = storage.get('izin', []);
            const item = all.find(i => i.id === id);
            if (item) { item.status = 'rejected'; storage.set('izin', all); }
            return { success: true, data: item };
        }
        return this.request('rejectIzin', { id });
    },

    async getAllIzin() {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('izin', []) };
        }
        return this.request('getAllIzin');
    },

    // ========== EMPLOYEES ==========

    async getEmployees() {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('admin_employees', []) };
        }
        return this.request('getEmployees');
    },

    async addEmployee(data) {
        if (!API_BASE_URL) {
            const all = storage.get('admin_employees', []);
            if (all.some(e => e.email === data.email)) {
                return { success: false, error: 'Email sudah terdaftar' };
            }
            data.id = Date.now();
            if (!data.avatar) {
                data.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name)}&background=F59E0B&color=fff`;
            }
            all.unshift(data);
            storage.set('admin_employees', all);
            return { success: true, data: data };
        }
        return this.request('addEmployee', data);
    },

    async updateEmployee(id, data) {
        if (!API_BASE_URL) {
            const all = storage.get('admin_employees', []);
            const idx = all.findIndex(e => e.id === id);
            if (idx >= 0) { Object.assign(all[idx], data); storage.set('admin_employees', all); }
            return { success: true, data: all[idx] };
        }
        return this.request('updateEmployee', { id, ...data });
    },

    async deleteEmployee(id) {
        if (!API_BASE_URL) {
            let all = storage.get('admin_employees', []);
            all = all.filter(e => e.id !== id);
            storage.set('admin_employees', all);
            return { success: true, data: { id } };
        }
        return this.request('deleteEmployee', { id });
    },

    // ========== SETTINGS ==========

    async getSettings() {
        if (!API_BASE_URL) {
            const company = storage.get('company', { name: 'Portal Karyawan', logo: '' });
            return {
                success: true,
                data: { company_name: company.name, company_logo: company.logo }
            };
        }
        return this.request('getSettings');
    },

    async saveSetting(key, value) {
        if (!API_BASE_URL) {
            if (key === 'company_name' || key === 'company_logo') {
                const company = storage.get('company', { name: '', logo: '' });
                if (key === 'company_name') company.name = value;
                if (key === 'company_logo') company.logo = value;
                storage.set('company', company);
            }
            return { success: true, data: { key, value } };
        }
        return this.request('saveSetting', { key, value });
    },

    // ========== SHIFTS ==========

    async getShifts() {
        if (!API_BASE_URL) {
            return { success: true, data: storage.get('shifts', []) };
        }
        return this.request('getShifts');
    },

    async addShift(data) {
        if (!API_BASE_URL) {
            const all = storage.get('shifts', []);
            data.id = Date.now();
            all.push(data);
            storage.set('shifts', all);
            return { success: true, data: data };
        }
        return this.request('addShift', data);
    },

    async updateShift(id, data) {
        if (!API_BASE_URL) {
            const all = storage.get('shifts', []);
            const idx = all.findIndex(s => s.id === id || s.id === Number(id));
            if (idx >= 0) { Object.assign(all[idx], data); storage.set('shifts', all); }
            return { success: true, data: all[idx] };
        }
        return this.request('updateShift', { id, ...data });
    },

    async deleteShift(id) {
        if (!API_BASE_URL) {
            let all = storage.get('shifts', []);
            all = all.filter(s => s.id !== id && s.id !== Number(id));
            storage.set('shifts', all);
            return { success: true, data: { id } };
        }
        return this.request('deleteShift', { id });
    },

    // ========== SCHEDULE ==========

    async getSchedule(month, year) {
        if (!API_BASE_URL) {
            const key = `schedule_${year}_${month}`;
            return { success: true, data: storage.get(key, {}) };
        }
        return this.request('getSchedule', { month, year });
    },

    async saveSchedule(data) {
        if (!API_BASE_URL) {
            const key = `schedule_${data.year}_${data.month}`;
            storage.set(key, data.schedule || {});
            return { success: true };
        }
        return this.request('saveSchedule', data);
    },

    // ========== LOCAL AUTH FALLBACK ==========

    _localLogin(email, password) {
        // In local mode, accept any login with role selection
        // This matches the original frontend behavior
        return { success: true, data: null }; // null means use frontend logic
    },

    _localFallback(action, data) {
        console.warn(`API Fallback: ${action} - using localStorage`);
        // This shouldn't be called normally since each method has its own fallback
        return { success: false, error: 'No fallback for action: ' + action };
    }
};

// Expose to global
window.api = api;

// Helper: always return a valid avatar URL
window.getAvatarUrl = function (emp) {
    if (emp && emp.avatar && emp.avatar.startsWith('http')) {
        return emp.avatar;
    }
    const name = (emp && emp.name) ? emp.name : 'User';
    const colors = ['3B82F6', '10B981', 'F59E0B', 'EF4444', '8B5CF6', 'EC4899', '14B8A6', '6B7280'];
    const colorIdx = name.charCodeAt(0) % colors.length;
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${colors[colorIdx]}&color=fff`;
};
