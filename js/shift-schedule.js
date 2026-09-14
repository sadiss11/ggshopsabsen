/**
 * Portal Karyawan - Shift Schedule
 * Employee shift schedule management for admin
 */

const shiftSchedule = {
    employees: [],
    shifts: [],
    scheduleData: {},
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    filters: {
        department: '',
        search: ''
    },

    async init() {
        // Check if admin
        if (!auth.isAdmin()) {
            toast.error('Anda tidak memiliki akses ke halaman ini!');
            router.navigate('dashboard');
            return;
        }

        await this.loadData();
        this.bindEvents();
        this.renderTable();
        this.updateSummary();
    },

    async loadData() {
        // Load employees and shifts from API
        try {
            const [empResult, shiftResult, settingsRes] = await Promise.all([
                api.getEmployees(),
                api.getShifts(),
                api.getSettings()
            ]);
            this.employees = empResult.data || [];
            this.shifts = shiftResult.data || [];

            // Extract schedules from global settings string blobs
            const loadedSchedules = {};
            if (settingsRes.success && settingsRes.data) {
                const globalSettings = settingsRes.data;
                Object.keys(globalSettings).forEach(k => {
                    if (k.startsWith('shift_schedule_')) {
                        const monthKey = k.replace('shift_schedule_', '');
                        try {
                            loadedSchedules[monthKey] = JSON.parse(globalSettings[k]);
                        } catch (e) { }
                    }
                });

                if (Object.keys(loadedSchedules).length > 0) {
                    this.scheduleData = loadedSchedules;
                    storage.set('shift_schedule', loadedSchedules);
                } else {
                    this.scheduleData = storage.get('shift_schedule', {});
                }
            }
        } catch (error) {
            console.error('Error loading schedule data:', error);
            this.employees = storage.get('admin_employees', []);
            this.shifts = storage.get('shifts', []);
            this.scheduleData = storage.get('shift_schedule', {});
        }

        // Set current month/year from selectors
        const monthSelect = document.getElementById('schedule-month');
        const yearSelect = document.getElementById('schedule-year');

        if (monthSelect) this.currentMonth = parseInt(monthSelect.value);
        if (yearSelect) this.currentYear = parseInt(yearSelect.value);

        // Generate sample data if empty (for demo)
        this.generateSampleData();
    },

    generateSampleData() {
        const key = `${this.currentYear}-${this.currentMonth}`;
        if (!this.scheduleData[key]) {
            this.scheduleData[key] = {};
        }

        // Generate random shifts for demo if no data exists
        this.employees.forEach(emp => {
            if (!this.scheduleData[key][emp.id]) {
                this.scheduleData[key][emp.id] = {};
                const daysInMonth = this.getDaysInMonth(this.currentMonth, this.currentYear);

                for (let day = 1; day <= daysInMonth; day++) {
                    const date = new Date(this.currentYear, this.currentMonth, day);
                    const dayOfWeek = date.getDay();

                    // Weekend = libur
                    if (dayOfWeek === 0 || dayOfWeek === 6) {
                        this.scheduleData[key][emp.id][day] = 'Libur';
                    } else {
                        // Random shift for weekdays
                        const shifts = ['Pagi', 'Pagi', 'Pagi', 'Siang', 'Malam']; // Weighted towards Pagi
                        const randomShift = shifts[Math.floor(Math.random() * shifts.length)];
                        this.scheduleData[key][emp.id][day] = randomShift;
                    }
                }
            }
        });

        storage.set('shift_schedule', this.scheduleData);
    },

    bindEvents() {
        // Month selector
        const monthSelect = document.getElementById('schedule-month');
        if (monthSelect) {
            monthSelect.addEventListener('change', (e) => {
                this.currentMonth = parseInt(e.target.value);
                this.renderTable();
                this.updateSummary();
            });
        }

        // Year selector
        const yearSelect = document.getElementById('schedule-year');
        if (yearSelect) {
            yearSelect.addEventListener('change', (e) => {
                this.currentYear = parseInt(e.target.value);
                this.renderTable();
                this.updateSummary();
            });
        }

        // Department filter
        const deptFilter = document.getElementById('schedule-dept-filter');
        if (deptFilter) {
            deptFilter.addEventListener('change', (e) => {
                this.filters.department = e.target.value;
                this.renderTable();
                this.updateSummary();
            });
        }

        // Search filter
        const searchInput = document.getElementById('schedule-employee-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.toLowerCase();
                this.renderTable();
                this.updateSummary();
            });
        }

        // Save button
        const saveBtn = document.getElementById('btn-save-schedule');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSchedule());
        }

        // Copy from last month button
        const copyBtn = document.getElementById('btn-copy-schedule');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyFromLastMonth());
        }
    },

    getDaysInMonth(month, year) {
        return new Date(year, month + 1, 0).getDate();
    },

    getDayName(dayIndex) {
        const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
        return days[dayIndex];
    },

    getFilteredEmployees() {
        return this.employees.filter(emp => {
            const matchDept = !this.filters.department || emp.department === this.filters.department;
            const matchSearch = !this.filters.search ||
                emp.name.toLowerCase().includes(this.filters.search) ||
                emp.email.toLowerCase().includes(this.filters.search);
            return matchDept && matchSearch;
        });
    },

    renderTable() {
        const headerRow = document.querySelector('#shift-schedule-table thead tr');
        const tbody = document.getElementById('shift-schedule-body');

        if (!headerRow || !tbody) return;

        // Clear existing date headers (keep employee header)
        const existingDateHeaders = headerRow.querySelectorAll('.date-header-col');
        existingDateHeaders.forEach(th => th.remove());

        // Get days in current month
        const daysInMonth = this.getDaysInMonth(this.currentMonth, this.currentYear);

        // Generate date headers
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(this.currentYear, this.currentMonth, day);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            const th = document.createElement('th');
            th.className = `date-header-col ${isWeekend ? 'weekend' : ''}`;
            th.innerHTML = `
                <div class="date-header ${isWeekend ? 'weekend' : ''}">
                    <span class="date-day">${this.getDayName(dayOfWeek)}</span>
                    <span class="date-number">${day}</span>
                </div>
            `;
            headerRow.appendChild(th);
        }

        // Clear tbody
        tbody.innerHTML = '';

        // Get filtered employees
        const filteredEmployees = this.getFilteredEmployees();

        if (filteredEmployees.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="${daysInMonth + 1}" class="shift-schedule-empty">
                        <i class="fas fa-users-slash"></i>
                        <p>Tidak ada karyawan yang sesuai dengan filter</p>
                    </td>
                </tr>
            `;
            return;
        }

        // Generate employee rows
        const key = `${this.currentYear}-${this.currentMonth}`;
        const monthData = this.scheduleData[key] || {};

        filteredEmployees.forEach(emp => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-employee-id', emp.id);

            // Employee cell (sticky)
            const empCell = document.createElement('td');
            empCell.className = 'sticky-col';
            empCell.innerHTML = `
                <div class="employee-cell">
                    <img src="${getAvatarUrl(emp)}" alt="${emp.name}" class="employee-avatar">
                    <div class="employee-info">
                        <span class="employee-name">${emp.name}</span>
                        <span class="employee-dept">${emp.department}</span>
                    </div>
                </div>
            `;
            tr.appendChild(empCell);

            // Shift cells for each day
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(this.currentYear, this.currentMonth, day);
                const dayOfWeek = date.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                const currentShift = monthData[emp.id]?.[day] || (isWeekend ? 'Libur' : '');

                const td = document.createElement('td');
                td.className = `shift-select-cell ${isWeekend ? 'weekend' : ''}`;

                // Create shift select dropdown
                const select = document.createElement('select');
                select.className = `shift-select ${currentShift ? 'shift-' + currentShift.toLowerCase() : ''}`;
                select.setAttribute('data-employee-id', emp.id);
                select.setAttribute('data-day', day);

                // Add options
                select.innerHTML = `
                    <option value="">-</option>
                    ${this.shifts.map(shift => `
                        <option value="${shift.name}" ${currentShift === shift.name ? 'selected' : ''}>
                            ${shift.name}
                        </option>
                    `).join('')}
                    <option value="Libur" ${currentShift === 'Libur' ? 'selected' : ''}>Libur</option>
                `;

                // Add change event
                select.addEventListener('change', (e) => {
                    this.updateShift(emp.id, day, e.target.value);
                    // Update class for styling
                    select.className = `shift-select ${e.target.value ? 'shift-' + e.target.value.toLowerCase() : ''}`;
                    this.updateSummary();
                });

                td.appendChild(select);
                tr.appendChild(td);
            }

            tbody.appendChild(tr);
        });
    },

    updateShift(employeeId, day, shiftValue) {
        const key = `${this.currentYear}-${this.currentMonth}`;

        if (!this.scheduleData[key]) {
            this.scheduleData[key] = {};
        }
        if (!this.scheduleData[key][employeeId]) {
            this.scheduleData[key][employeeId] = {};
        }

        this.scheduleData[key][employeeId][day] = shiftValue;

        // Auto save to localStorage
        storage.set('shift_schedule', this.scheduleData);
    },

    async saveSchedule() {
        try {
            const saveBtn = document.getElementById('btn-save-schedule');
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyimpan...';

            const key = `${this.currentYear}-${this.currentMonth}`;
            const monthData = this.scheduleData[key] || {};

            // Push exact month map configuration to Database API Global Settings
            await api.saveSetting(`shift_schedule_${key}`, JSON.stringify(monthData));

            // Maintain cache locally
            storage.set('shift_schedule', this.scheduleData);

            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> Simpan Jadwal';
            toast.success('Jadwal shift berhasil disimpan ke Server!');
        } catch (error) {
            console.error('Save error', error);
            const saveBtn = document.getElementById('btn-save-schedule');
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> Simpan Jadwal';
            toast.error('Gagal menyimpan jadwal ke server!');
        }
    },

    copyFromLastMonth() {
        const lastMonth = this.currentMonth === 0 ? 11 : this.currentMonth - 1;
        const lastYear = this.currentMonth === 0 ? this.currentYear - 1 : this.currentYear;

        const lastKey = `${lastYear}-${lastMonth}`;
        const currentKey = `${this.currentYear}-${this.currentMonth}`;

        if (!this.scheduleData[lastKey]) {
            toast.error('Tidak ada data jadwal di bulan sebelumnya!');
            return;
        }

        if (confirm('Apakah Anda yakin ingin menyalin jadwal dari bulan lalu?')) {
            // Copy data from last month
            this.scheduleData[currentKey] = JSON.parse(JSON.stringify(this.scheduleData[lastKey]));
            storage.set('shift_schedule', this.scheduleData);

            this.renderTable();
            this.updateSummary();
            toast.success('Jadwal bulan lalu berhasil disalin!');
        }
    },

    updateSummary() {
        const key = `${this.currentYear}-${this.currentMonth}`;
        const monthData = this.scheduleData[key] || {};
        const filteredEmployees = this.getFilteredEmployees();

        let pagiCount = 0;
        let siangCount = 0;
        let malamCount = 0;
        let liburCount = 0;

        filteredEmployees.forEach(emp => {
            const empData = monthData[emp.id] || {};
            Object.values(empData).forEach(shift => {
                switch (shift) {
                    case 'Pagi': pagiCount++; break;
                    case 'Siang': siangCount++; break;
                    case 'Malam': malamCount++; break;
                    case 'Libur': liburCount++; break;
                }
            });
        });

        // Update summary elements
        const totalEl = document.getElementById('summary-total-employees');
        const pagiEl = document.getElementById('summary-pagi');
        const siangEl = document.getElementById('summary-siang');
        const malamEl = document.getElementById('summary-malam');
        const liburEl = document.getElementById('summary-libur');

        if (totalEl) totalEl.textContent = filteredEmployees.length;
        if (pagiEl) pagiEl.textContent = pagiCount;
        if (siangEl) siangEl.textContent = siangCount;
        if (malamEl) malamEl.textContent = malamCount;
        if (liburEl) liburEl.textContent = liburCount;
    }
};

// Global init function
window.initShiftSchedule = () => {
    shiftSchedule.init();
};

// Expose shiftSchedule object
window.shiftSchedule = shiftSchedule;
