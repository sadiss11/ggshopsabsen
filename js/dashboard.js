/**
 * Portal Karyawan - Dashboard
 * Dashboard functionality and charts
 */

const dashboard = {
    initialized: false,
    attendanceData: [],

    async init() {
        if (this.initialized) return;

        await this.loadData();

        this.updateWelcomeCard();
        this.updateStats();
        this.updateSessionInfo();
        this.updateProgressBar();

        this.initialized = true;
    },

    async loadData() {
        try {
            const currentUser = auth.getCurrentUser();
            if (currentUser && currentUser.id) {
                // Fetch attendance and global settings concurrently
                const [attResult, settingsRes] = await Promise.all([
                    api.getAttendance(currentUser.id),
                    api.getSettings()
                ]);

                this.attendanceData = (attResult && attResult.success) ? attResult.data : [];

                // Sync global schedule shift mapping from Admin to this employee's local instance
                if (settingsRes && settingsRes.success && settingsRes.data) {
                    const globalSettings = settingsRes.data;
                    const loadedSchedules = {};
                    Object.keys(globalSettings).forEach(k => {
                        if (k.startsWith('shift_schedule_')) {
                            const monthKey = k.replace('shift_schedule_', '');
                            try {
                                loadedSchedules[monthKey] = JSON.parse(globalSettings[k]);
                            } catch (e) { }
                        }
                    });
                    if (Object.keys(loadedSchedules).length > 0) {
                        storage.set('shift_schedule', loadedSchedules);
                    }
                }
            }
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            this.attendanceData = [];
        }
    },

    updateWelcomeCard() {
        const welcomeCard = document.querySelector('.welcome-card');
        const greetingEl = document.querySelector('.welcome-content h2');
        const shiftEl = document.getElementById('welcome-shift');
        const iconEl = document.querySelector('.welcome-illustration i');

        if (!welcomeCard || !greetingEl) return;

        const hour = new Date().getHours();
        let greeting = 'Selamat Pagi';
        let icon = 'fa-sun';
        let className = 'morning';

        if (hour >= 11 && hour < 15) {
            greeting = 'Selamat Siang';
            icon = 'fa-sun';
            className = 'afternoon';
        } else if (hour >= 15 && hour < 18) {
            greeting = 'Selamat Sore';
            icon = 'fa-cloud-sun';
            className = 'evening';
        } else if (hour >= 18) {
            greeting = 'Selamat Malam';
            icon = 'fa-moon';
            className = 'evening';
        }

        const userName = auth.getCurrentUser()?.name?.split(' ')[0] || 'User';
        greetingEl.innerHTML = `${greeting}, <span id="welcome-name">${userName}</span>! 👋`;

        if (iconEl) {
            iconEl.className = `fas ${icon}`;
        }

        // Update card class for different gradient
        welcomeCard.className = `welcome-card ${className}`;

        // Update shift info
        const shifts = storage.get('shifts', []);
        let currentShiftName = auth.getCurrentUser()?.shift || 'Pagi';

        // Automated shift lookup from admin schedule
        try {
            const userId = String(auth.getCurrentUser()?.id);
            const schedules = storage.get('shift_schedule', {});
            const todayObj = new Date();
            const currentYear = todayObj.getFullYear();
            const currentMonth = todayObj.getMonth();
            const currentDay = todayObj.getDate();
            const key = `${currentYear}-${currentMonth}`;

            console.log('Dashboard Shift Sync - Key:', key, 'UserId:', userId, 'Day:', currentDay);

            if (schedules[key] && schedules[key][userId]) {
                const assignedShift = schedules[key][userId][currentDay];
                console.log('Dashboard Shift Sync - Found Shift:', assignedShift);
                if (assignedShift) {
                    currentShiftName = assignedShift;
                }
            } else {
                console.log('Dashboard Shift Sync - Missing Schedule key or User record.');
            }
        } catch (e) {
            console.error('Error reading shift schedule:', e);
        }

        const activeShift = shifts.find(s => s.name === currentShiftName) || shifts[0] || { name: 'Pagi', startTime: '08:00', endTime: '17:00' };

        if (shiftEl) {
            if (currentShiftName === 'Libur') {
                shiftEl.textContent = `Shift: Libur (Tidak ada jadwal)`;
            } else {
                shiftEl.textContent = `Shift: ${activeShift.name} (${activeShift.startTime} - ${activeShift.endTime})`;
            }
        }
    },

    updateStats() {
        const attendance = this.attendanceData;

        // Calculate stats
        const total = Math.max(26, attendance.length); // Assuming min 26 working days base
        const present = attendance.filter(a => a.status === 'ontime').length;
        const late = attendance.filter(a => a.status === 'late').length;
        const absent = attendance.filter(a => a.status === 'absent').length;

        // Update donut chart values
        const presentPercent = total > 0 ? Math.round((present / total) * 100) : 0;

        // Update center text
        const donutValue = document.querySelector('.donut-value');
        if (donutValue) {
            donutValue.textContent = `${presentPercent}%`;
        }

        // Update legend
        const legendValues = document.querySelectorAll('.legend-value');
        if (legendValues.length >= 3) {
            legendValues[0].textContent = `${present} hari`;
            legendValues[1].textContent = `${late} hari`;
            legendValues[2].textContent = `${absent} hari`;
        }
    },

    updateSessionInfo() {
        // Get today's attendance
        const today = dateTime.getLocalDate();
        const attendance = this.attendanceData;
        const todayAttendance = attendance.find(a => a.date === today);

        const clockInEl = document.getElementById('dashboard-clock-in');
        const clockOutEl = document.getElementById('dashboard-clock-out');
        const durationEl = document.getElementById('dashboard-duration');

        if (clockInEl) clockInEl.textContent = '--:--';
        if (clockOutEl) clockOutEl.textContent = '--:--';
        if (durationEl) durationEl.textContent = '0j 0m';

        if (todayAttendance) {
            if (clockInEl) clockInEl.textContent = todayAttendance.clockIn || '--:--';
            if (clockOutEl) clockOutEl.textContent = todayAttendance.clockOut || '--:--';

            if (todayAttendance.clockIn && todayAttendance.clockOut && durationEl) {
                durationEl.textContent = dateTime.calculateDuration(
                    todayAttendance.clockIn,
                    todayAttendance.clockOut
                );
            }
        }
    },

    updateProgressBar() {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour + (currentMinute / 60);

        // Assuming 8-hour work day from 8 AM to 5 PM
        const startHour = 8;
        const endHour = 17;
        const totalHours = endHour - startHour;

        let progress = ((currentTime - startHour) / totalHours) * 100;
        progress = Math.max(0, Math.min(100, progress));

        const progressFill = document.getElementById('work-progress');
        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
    }
};

// Global init function called by router
window.initDashboard = async () => {
    await dashboard.init();
};

// Auto-update progress every minute
setInterval(() => {
    if (document.getElementById('page-dashboard')?.classList.contains('active')) {
        dashboard.updateProgressBar();
    }
}, 60000);
