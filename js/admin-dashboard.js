/**
 * Portal Karyawan - Admin Dashboard
 * Admin dashboard with employee statistics
 */

const adminDashboard = {
    employees: [],
    attendance: [],
    leaves: [],

    async init() {
        if (!auth.isAdmin()) {
            toast.error('Anda tidak memiliki akses!');
            router.navigate('dashboard');
            return;
        }

        await this.loadData();
        this.updateStats();
        this.renderRecentActivity();
        this.renderOnlineUsers();
    },

    async loadData() {
        try {
            const [empResult, attResult, leaveResult, izinResult] = await Promise.all([
                api.getEmployees(),
                api.getAllAttendance(),
                api.getAllLeaves(),
                api.getAllIzin()
            ]);
            this.employees = empResult.data || [];
            this.attendance = attResult.data || [];
            this.leaves = leaveResult.data || [];
            this.izin = izinResult.data || [];
        } catch (error) {
            console.error('Error loading admin data:', error);
            this.employees = storage.get('admin_employees', []);
            this.attendance = storage.get('attendance', []);
            this.leaves = storage.get('leaves', []);
            this.izin = storage.get('izin', []);
        }
    },

    updateStats() {
        const totalEmployees = this.employees.length;
        const todayStr = dateTime.getLocalDate(); // yyyy-MM-dd

        // Filter attendance to ONLY today's records
        const todayAttendance = this.attendance.filter(a => a.date === todayStr);

        // Compute from real Today records
        let presentToday = 0;
        let lateToday = 0;

        todayAttendance.forEach(att => {
            if (att.clockIn) {
                presentToday++;
                // Check if late
                if (att.status && att.status.toLowerCase() === 'terlambat') {
                    lateToday++;
                }
            }
        });

        // Compute those on leave (cuti / izin) for today
        const onLeave = this.leaves.filter(l => l.status === 'approved' && l.startDate <= todayStr && l.endDate >= todayStr).length +
            this.izin.filter(i => i.status === 'approved' && i.date === todayStr).length;

        // Everyone not present and not on leave is absent
        const absentToday = Math.max(0, totalEmployees - presentToday - onLeave);

        // Count pending requests
        const pendingLeaves = this.leaves.filter(l => l.status === 'pending').length;
        const pendingIzin = this.izin.filter(i => i.status === 'pending').length;
        const totalPending = pendingLeaves + pendingIzin;

        // Update DOM
        const els = {
            'total-employees': totalEmployees,
            'present-today': presentToday,
            'absent-today': absentToday,
            'late-today': lateToday,
            'on-leave': onLeave,
            'pending-requests': totalPending
        };

        Object.entries(els).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) {
                // Animate number
                this.animateNumber(el, parseInt(el.textContent) || 0, value);
            }
        });
    },

    animateNumber(element, start, end) {
        const duration = 1000;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const current = Math.floor(start + (end - start) * easeOutQuart);

            element.textContent = current;

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        requestAnimationFrame(animate);
    },

    renderRecentActivity() {
        const container = document.getElementById('admin-recent-activity');
        if (!container) return;

        const activities = [
            { user: 'Ahmad Rizky', action: 'Clock In', time: '5 menit yang lalu', avatar: 'https://ui-avatars.com/api/?name=Ahmad&background=3B82F6&color=fff' },
            { user: 'Budi Santoso', action: 'Mengajukan Cuti', time: '15 menit yang lalu', avatar: 'https://ui-avatars.com/api/?name=Budi&background=10B981&color=fff' },
            { user: 'Citra Dewi', action: 'Mengisi Jurnal', time: '30 menit yang lalu', avatar: 'https://ui-avatars.com/api/?name=Citra&background=F59E0B&color=fff' },
            { user: 'Dedi Pratama', action: 'Clock Out', time: '1 jam yang lalu', avatar: 'https://ui-avatars.com/api/?name=Dedi&background=EF4444&color=fff' },
            { user: 'Eka Putri', action: 'Izin Sakit', time: '2 jam yang lalu', avatar: 'https://ui-avatars.com/api/?name=Eka&background=8B5CF6&color=fff' }
        ];

        container.innerHTML = activities.map(act => `
            <div class="activity-item">
                <div class="activity-avatar">
                    <img src="${getAvatarUrl(act)}" alt="${act.user}">
                </div>
                <div class="activity-content">
                    <p class="activity-text"><strong>${act.user}</strong> ${act.action}</p>
                    <span class="activity-time">${act.time}</span>
                </div>
            </div>
        `).join('');
    },

    renderOnlineUsers() {
        const container = document.getElementById('admin-online-users');
        if (!container) return;

        const onlineUsers = this.employees.filter(e => e.status === 'active').slice(0, 5);
        const onlineCount = onlineUsers.length;

        const countEl = document.getElementById('online-count');
        if (countEl) countEl.textContent = onlineCount;

        container.innerHTML = onlineUsers.map(user => `
            <div class="online-user-item">
                <div class="user-status-dot"></div>
                <div class="activity-avatar">
                    <img src="${getAvatarUrl(user)}" alt="${user.name}">
                </div>
                <div class="activity-content">
                    <p class="activity-text"><strong>${user.name}</strong></p>
                    <span class="activity-time">${user.department} - ${user.position}</span>
                </div>
            </div>
        `).join('');
    },

    // Charts initialization (placeholder - would use Chart.js in production)
    initCharts() {
        // This would be where Chart.js or similar library is initialized
        // For now, we'll just show placeholders
        const attendanceChart = document.getElementById('admin-attendance-chart');
        const deptChart = document.getElementById('admin-dept-chart');

        if (attendanceChart) {
            attendanceChart.innerHTML = `
                <div class="chart-placeholder">
                    <i class="fas fa-chart-bar"></i>
                    <p>Grafik Kehadiran 30 Hari Terakhir</p>
                </div>
            `;
        }

        if (deptChart) {
            deptChart.innerHTML = `
                <div class="chart-placeholder">
                    <i class="fas fa-chart-pie"></i>
                    <p>Distribusi Kehadiran per Departemen</p>
                </div>
            `;
        }
    }
};

// Global init function
window.initAdminDashboard = () => {
    adminDashboard.init();
    adminDashboard.initCharts();
};

// Expose
window.adminDashboard = adminDashboard;
