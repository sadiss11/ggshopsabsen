/**
 * Portal Karyawan - Admin Reports
 * Reports and exports for admin
 */

const adminReports = {
    attendanceData: [],
    jurnalData: [],
    leaveData: [],
    filters: {
        attendance: { month: '', dept: '', status: '' },
        jurnal: { month: '', employee: '', status: '' },
        leave: { month: '', type: '', status: '' }
    },

    async initAttendanceReports() {
        if (!auth.isAdmin()) {
            toast.error('Anda tidak memiliki akses!');
            router.navigate('dashboard');
            return;
        }

        await this.loadData();
        this.bindAttendanceEvents();
        this.populateEmployeeFilter();
        this.renderAttendanceReports();
    },

    async initJurnalReports() {
        if (!auth.isAdmin()) {
            toast.error('Anda tidak memiliki akses!');
            router.navigate('dashboard');
            return;
        }

        await this.loadData();
        this.bindJurnalEvents();
        this.populateEmployeeFilter();
        this.renderJurnalReports();
    },

    async initLeaveReports() {
        if (!auth.isAdmin()) {
            toast.error('Anda tidak memiliki akses!');
            router.navigate('dashboard');
            return;
        }

        await this.loadData();
        this.bindLeaveEvents();
        this.renderLeaveReports();
    },

    async loadData() {
        let employees = [];
        let jurnals = [];
        let leaves = [];
        let izinList = [];
        let attendances = [];

        try {
            const [empResult, jurnalResult, leaveResult, izinResult, attResult] = await Promise.all([
                api.getEmployees(),
                api.getAllJournals(),
                api.getAllLeaves(),
                api.getAllIzin(),
                api.getAllAttendance()
            ]);
            employees = empResult.data || [];
            jurnals = jurnalResult.data || [];
            leaves = leaveResult.data || [];
            izinList = izinResult.data || [];
            attendances = attResult.data || [];
        } catch (error) {
            console.error('Error loading report data:', error);
            employees = storage.get('admin_employees', []);
            jurnals = storage.get('jurnals', []);
            leaves = storage.get('leaves', []);
            izinList = storage.get('izin', []);
            attendances = storage.get('attendance', []);
        }

        // Generate attendance data from real database records
        this.rawAttendance = attendances;
        this.rawEmployees = employees;

        this.attendanceData = employees.map(emp => {
            const empAtt = attendances.filter(a => String(a.userId) === String(emp.id));
            let present = 0;
            let late = 0;

            empAtt.forEach(a => {
                if (a.clockIn) {
                    present++;
                    if (a.status && a.status.toLowerCase() === 'terlambat') {
                        late++;
                    }
                }
            });

            // Calculate leave/absent (Cutis & Izins)
            const empLeaves = leaves.filter(l => String(l.userId) === String(emp.id) && l.status === 'approved');
            const empIzin = izinList.filter(i => String(i.userId) === String(emp.id) && i.status === 'approved');

            // Simplified sum: duration of valid leaves + single-day izin
            let leaveDays = 0;
            empLeaves.forEach(l => leaveDays += parseInt(l.duration) || 1);
            empIzin.forEach(i => leaveDays += parseInt(i.duration) || 1);

            const absent = leaveDays;

            return {
                name: emp.name,
                department: emp.department,
                present: present,
                late: late,
                absent: absent,
                total: present + absent
            };
        });

        const currentUser = auth.getCurrentUser();

        this.jurnalData = jurnals.map(j => {
            let emp = employees.find(e => e.id === j.userId);
            if (!emp && currentUser) {
                emp = { name: currentUser.name, department: currentUser.department || '-' };
            }
            if (!emp) {
                emp = { name: 'Karyawan', department: '-' };
            }
            return {
                date: j.date,
                name: emp.name,
                department: emp.department,
                tasks: j.tasks || '-',
                achievements: j.achievements || '-',
                obstacles: j.obstacles || '-',
                plan: j.plan || '-',
                photo: j.photo || null,
                status: j.tasks ? 'filled' : 'empty',
                updatedAt: j.updatedAt
            };
        });

        this.leaveData = [
            ...leaves.map(l => ({
                name: l.typeLabel === 'Cuti Tahunan' ? 'Budi Santoso' : 'Citra Dewi',
                department: l.typeLabel === 'Cuti Tahunan' ? 'HR' : 'Finance',
                type: l.type === 'annual' ? 'Cuti' : l.type,
                dates: l.startDate === l.endDate ? l.startDate : `${l.startDate} - ${l.endDate}`,
                duration: l.duration,
                reason: l.reason,
                status: l.status
            })),
            ...izinList.map(i => ({
                name: 'Dedi Pratama',
                department: 'Marketing',
                type: 'Izin',
                dates: i.date,
                duration: i.duration,
                reason: i.reason,
                status: i.status
            }))
        ];
    },

    populateEmployeeFilter() {
        const employees = storage.get('admin_employees', []);
        const select = document.getElementById('jurnal-employee-filter');
        if (select) {
            select.innerHTML = '<option value="">Semua Karyawan</option>' +
                employees.map(emp => `<option value="${emp.name}">${emp.name}</option>`).join('');
        }
    },

    bindAttendanceEvents() {
        // Export button
        const exportBtn = document.getElementById('btn-export-attendance');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToExcel('attendance'));
        }

        // Print button
        const printBtn = document.getElementById('btn-print-attendance');
        if (printBtn) {
            printBtn.addEventListener('click', () => this.printReport('attendance'));
        }

        // Month filter
        const monthFilter = document.getElementById('attendance-month');
        if (monthFilter) {
            monthFilter.addEventListener('change', (e) => {
                this.filters.attendance.month = e.target.value;
                this.renderAttendanceReports();
            });
        }

        // Department filter
        const deptFilter = document.getElementById('report-dept-filter');
        if (deptFilter) {
            deptFilter.addEventListener('change', (e) => {
                this.filters.attendance.dept = e.target.value;
                this.renderAttendanceReports();
            });
        }

        // Status filter
        const statusFilter = document.getElementById('report-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.filters.attendance.status = e.target.value;
                this.renderAttendanceReports();
            });
        }
    },

    bindJurnalEvents() {
        const exportBtn = document.getElementById('btn-export-jurnal');
        const printBtn = document.getElementById('btn-print-jurnal');

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToExcel('jurnal'));
        }

        if (printBtn) {
            printBtn.addEventListener('click', () => this.printReport('jurnal'));
        }

        // Month filter
        const monthFilter = document.getElementById('jurnal-month');
        if (monthFilter) {
            monthFilter.addEventListener('change', (e) => {
                this.filters.jurnal.month = e.target.value;
                this.renderJurnalReports();
            });
        }

        // Employee filter
        const empFilter = document.getElementById('jurnal-employee-filter');
        if (empFilter) {
            empFilter.addEventListener('change', (e) => {
                this.filters.jurnal.employee = e.target.value;
                this.renderJurnalReports();
            });
        }

        // Status filter
        const statusFilter = document.getElementById('jurnal-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.filters.jurnal.status = e.target.value;
                this.renderJurnalReports();
            });
        }
    },

    bindLeaveEvents() {
        const exportBtn = document.getElementById('btn-export-leave');
        const printBtn = document.getElementById('btn-print-leave');

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToExcel('leave'));
        }

        if (printBtn) {
            printBtn.addEventListener('click', () => this.printReport('leave'));
        }

        // Month filter
        const monthFilter = document.getElementById('leave-month');
        if (monthFilter) {
            monthFilter.addEventListener('change', (e) => {
                this.filters.leave.month = e.target.value;
                this.renderLeaveReports();
            });
        }

        // Type filter
        const typeFilter = document.getElementById('leave-type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', (e) => {
                this.filters.leave.type = e.target.value;
                this.renderLeaveReports();
            });
        }

        // Status filter
        const statusFilter = document.getElementById('leave-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.filters.leave.status = e.target.value;
                this.renderLeaveReports();
            });
        }
    },

    getFilteredAttendance() {
        return this.attendanceData.filter(row => {
            const matchesDept = !this.filters.attendance.dept || row.department === this.filters.attendance.dept;
            const matchesStatus = !this.filters.attendance.status ||
                (this.filters.attendance.status === 'present' && row.present > 0) ||
                (this.filters.attendance.status === 'absent' && row.absent > 0) ||
                (this.filters.attendance.status === 'late' && row.late > 0);
            return matchesDept && matchesStatus;
        });
    },

    getFilteredJurnal() {
        return this.jurnalData.filter(row => {
            const matchesEmp = !this.filters.jurnal.employee || row.name === this.filters.jurnal.employee;
            const matchesStatus = !this.filters.jurnal.status || row.status === this.filters.jurnal.status;
            return matchesEmp && matchesStatus;
        });
    },

    getFilteredLeave() {
        return this.leaveData.filter(row => {
            const matchesType = !this.filters.leave.type ||
                (this.filters.leave.type === 'cuti' && row.type.toLowerCase().includes('cuti')) ||
                (this.filters.leave.type === 'izin' && row.type.toLowerCase().includes('izin')) ||
                (this.filters.leave.type === 'sakit' && row.type.toLowerCase().includes('sakit'));
            const matchesStatus = !this.filters.leave.status || row.status === this.filters.leave.status;
            return matchesType && matchesStatus;
        });
    },

    renderAttendanceReports() {
        const tbody = document.getElementById('attendance-reports-body');
        if (!tbody) return;

        const data = this.getFilteredAttendance();

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-details">
                            <span class="employee-name">${row.name}</span>
                        </div>
                    </div>
                </td>
                <td>${row.department}</td>
                <td class="text-center" style="color: var(--color-success); font-weight: 600;">${row.present}</td>
                <td class="text-center" style="color: var(--color-warning); font-weight: 600;">${row.late}</td>
                <td class="text-center" style="color: var(--color-danger); font-weight: 600;">${row.absent}</td>
                <td class="text-center">${row.total}</td>
                <td>
                    <button class="btn-action view" onclick="adminReports.viewDetail('${row.name}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        // Render mobile cards
        const mobileContainer = document.getElementById('attendance-mobile-cards');
        if (mobileContainer) {
            mobileContainer.innerHTML = data.map(row => `
                <div class="mobile-card">
                    <div class="mobile-card-header">
                        <span class="mobile-card-title">${row.name}</span>
                        <span style="font-size: var(--font-size-xs); color: var(--text-muted);">${row.department}</span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="mobile-card-label">Hadir</span>
                        <span class="mobile-card-value" style="color: var(--color-success);">${row.present}</span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="mobile-card-label">Terlambat</span>
                        <span class="mobile-card-value" style="color: var(--color-warning);">${row.late}</span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="mobile-card-label">Absen</span>
                        <span class="mobile-card-value" style="color: var(--color-danger);">${row.absent}</span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="mobile-card-label">Total</span>
                        <span class="mobile-card-value">${row.total}</span>
                    </div>
                </div>
            `).join('');
        }
    },

    renderJurnalReports() {
        const tbody = document.getElementById('jurnal-reports-body');
        if (!tbody) return;

        const data = this.getFilteredJurnal();

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.date}</td>
                <td>${row.name}</td>
                <td>${row.department}</td>
                <td>${row.tasks.substring(0, 30)}${row.tasks.length > 30 ? '...' : ''}</td>
                <td>
                    ${row.photo ?
                `<img src="${row.photo}" class="jurnal-thumbnail" onclick="adminReports.viewPhoto('${row.photo}')" title="Klik untuk melihat">` :
                '<span class="no-photo-cell">-</span>'
            }
                </td>
                <td>
                    <span class="status-badge ${row.status}">
                        ${row.status === 'filled' ? 'Terisi' : 'Kosong'}
                    </span>
                </td>
                <td>
                    <button class="btn-action view" onclick="adminReports.viewJurnalDetail('${row.name}', '${row.date}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    },

    renderLeaveReports() {
        const tbody = document.getElementById('leave-reports-body');
        if (!tbody) return;

        const data = this.getFilteredLeave();
        const statusLabels = {
            'pending': 'Menunggu',
            'approved': 'Disetujui',
            'rejected': 'Ditolak'
        };

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.name}</td>
                <td>${row.department}</td>
                <td>${row.type}</td>
                <td>${row.dates}</td>
                <td>${row.duration} hari</td>
                <td>${row.reason}</td>
                <td>
                    <span class="status-badge ${row.status}">
                        ${statusLabels[row.status]}
                    </span>
                </td>
                <td>
                    <button class="btn-action view" onclick="adminReports.viewLeaveDetail('${row.name}')">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    },

    exportToExcel(type) {
        let data = [];
        let filename = '';

        switch (type) {
            case 'attendance':
                data = this.getFilteredAttendance();
                filename = 'Rekap_Absensi.csv';
                break;
            case 'jurnal':
                data = this.getFilteredJurnal();
                filename = 'Rekap_Jurnal.csv';
                break;
            case 'leave':
                data = this.getFilteredLeave();
                filename = 'Rekap_Cuti_Izin.csv';
                break;
        }

        // For demo, we'll export as CSV
        const csv = this.convertToCSV(data);
        this.downloadFile(csv, filename, 'text/csv');

        toast.success(`Data berhasil diexport ke ${filename}`);
    },

    convertToCSV(data) {
        if (data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const rows = data.map(row =>
            headers.map(header => {
                const val = row[header];
                return `"${val}"`;
            }).join(',')
        );

        return [headers.join(','), ...rows].join('\n');
    },

    downloadFile(content, filename, contentType) {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    printReport(type) {
        window.print();
    },

    viewDetail(name) {
        toast.info(`Detail untuk ${name} akan ditampilkan`);
    },

    viewJurnalDetail(name, date) {
        const jurnal = this.jurnalData.find(j => j.name === name && j.date === date);
        if (!jurnal) {
            toast.error('Data jurnal tidak ditemukan');
            return;
        }

        const photoHtml = jurnal.photo ? `
            <div class="detail-photo-section">
                <label>Foto Lampiran:</label>
                <img src="${jurnal.photo}" alt="Foto jurnal" class="jurnal-photo-preview" onclick="window.open('${jurnal.photo}', '_blank')">
            </div>
        ` : '<div class="detail-photo-section"><label>Foto Lampiran:</label><p class="no-photo">Tidak ada foto</p></div>';

        const content = `
            <div class="jurnal-detail-content">
                <div class="detail-row">
                    <label>Nama:</label>
                    <p>${jurnal.name}</p>
                </div>
                <div class="detail-row">
                    <label>Departemen:</label>
                    <p>${jurnal.department}</p>
                </div>
                <div class="detail-row">
                    <label>Tanggal:</label>
                    <p>${dateTime.formatDate(new Date(jurnal.date), 'long')}</p>
                </div>
                <div class="detail-section">
                    <label>Tugas:</label>
                    <p>${jurnal.tasks.replace(/\n/g, '<br>')}</p>
                </div>
                <div class="detail-section">
                    <label>Pencapaian:</label>
                    <p>${jurnal.achievements.replace(/\n/g, '<br>')}</p>
                </div>
                <div class="detail-section">
                    <label>Kendala:</label>
                    <p>${jurnal.obstacles.replace(/\n/g, '<br>')}</p>
                </div>
                <div class="detail-section">
                    <label>Rencana:</label>
                    <p>${jurnal.plan.replace(/\n/g, '<br>')}</p>
                </div>
                ${photoHtml}
            </div>
        `;

        modal.show('Detail Jurnal', content, [
            { label: 'Tutup', class: 'btn-secondary', onClick: () => modal.close() }
        ]);
    },

    viewPhoto(photoUrl) {
        if (!photoUrl) return;

        const content = `
            <div class="photo-viewer-modal">
                <img src="${photoUrl}" alt="Foto jurnal" class="full-photo">
            </div>
        `;

        modal.show('Foto Lampiran', content, [
            { label: 'Tutup', class: 'btn-secondary', onClick: () => modal.close() },
            { label: 'Buka di Tab Baru', class: 'btn-primary', onClick: () => window.open(photoUrl, '_blank') }
        ]);
    },

    viewLeaveDetail(name) {
        toast.info(`Detail cuti/izin ${name}`);
    }
};

// Global init functions
window.initAttendanceReports = () => {
    adminReports.initAttendanceReports();
};

window.initJurnalReports = () => {
    adminReports.initJurnalReports();
};

window.initLeaveReports = () => {
    adminReports.initLeaveReports();
};

// Expose
window.adminReports = adminReports;
