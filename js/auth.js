/**
 * Portal Karyawan - Authentication
 * Handle login/logout and session management
 */

const auth = {
    currentUser: null,

    init() {
        // Check for existing session
        const session = storage.get('session');
        if (session) {
            this.currentUser = session;
            this.showApp();
        }

        // Login form handler
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        // Toggle password visibility
        const togglePassword = document.getElementById('toggle-password');
        if (togglePassword) {
            togglePassword.addEventListener('click', () => this.togglePasswordVisibility());
        }

        // Logout button
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Profile click - open profile modal
        const userProfile = document.querySelector('.user-profile');
        if (userProfile) {
            // Make the user info area clickable (not the logout button)
            const userInfoArea = userProfile.querySelector('.user-info');
            const userAvatarArea = userProfile.querySelector('.user-avatar');
            if (userInfoArea) {
                userInfoArea.style.cursor = 'pointer';
                userInfoArea.addEventListener('click', () => this.openProfileModal());
            }
            if (userAvatarArea) {
                userAvatarArea.style.cursor = 'pointer';
                userAvatarArea.addEventListener('click', () => this.openProfileModal());
            }
        }
    },

    async handleLogin(e) {
        e.preventDefault();

        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const role = document.querySelector('input[name="role"]:checked').value;

        // Validate
        if (!email || !password) {
            toast.error('Email dan password harus diisi!');
            return;
        }

        // Show loading
        const submitBtn = e.target.querySelector('.btn-login');
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;

        try {
            const result = await api.login(email, password);

            let user;
            if (result.success && result.data) {
                // Backend mode - user from API (Employees or Users sheet)
                user = {
                    id: result.data.id,
                    email: result.data.email,
                    name: result.data.name,
                    role: result.data.role || role,
                    department: result.data.department || '',
                    position: result.data.position || '',
                    shift: result.data.shift || '',
                    avatar: result.data.avatar || '',
                    loginTime: new Date().toISOString()
                };
            } else if (result.success && !result.data && !API_BASE_URL) {
                // Local-only fallback (no backend configured) - for testing only
                const displayName = email.split('@')[0] || 'User';
                user = {
                    id: 'user_' + Date.now(),
                    email: email,
                    name: role === 'admin' ? 'Admin (Local)' : displayName,
                    role: role,
                    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=F59E0B&color=fff`,
                    loginTime: new Date().toISOString()
                };
            } else {
                toast.error(result.error || 'Email atau password salah!');
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
                return;
            }

            this.currentUser = user;
            storage.set('session', user);

            // Update UI
            this.updateUserUI();

            // Show app
            this.showApp();

            toast.success(`Selamat datang, ${user.name}!`);
        } catch (error) {
            console.error('Login error:', error);
            toast.error('Terjadi kesalahan saat login');
        } finally {
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;
        }
    },

    handleLogout() {
        if (confirm('Apakah Anda yakin ingin logout?')) {
            this.currentUser = null;
            storage.remove('session');
            storage.remove('currentPage');

            this.showLogin();
            toast.info('Anda telah logout');
        }
    },

    showApp() {
        const loginContainer = document.getElementById('login-container');
        const appContainer = document.getElementById('app-container');

        if (loginContainer && appContainer) {
            loginContainer.style.display = 'none';
            appContainer.classList.remove('hidden');

            // Update user UI first
            this.updateUserUI();

            // Show appropriate menu based on role
            const employeeMenu = document.getElementById('employee-menu');
            const adminMenu = document.getElementById('admin-menu-nav');
            const bottomNav = document.getElementById('bottom-nav');

            if (this.currentUser && this.currentUser.role === 'admin') {
                // Show admin menu, hide employee menu
                if (employeeMenu) employeeMenu.classList.add('hidden');
                if (adminMenu) adminMenu.classList.remove('hidden');
                if (bottomNav) bottomNav.style.display = 'none';

                // Navigate to admin dashboard
                router.navigate('admin-dashboard');
            } else {
                // Show employee menu, hide admin menu
                if (employeeMenu) employeeMenu.classList.remove('hidden');
                if (adminMenu) adminMenu.classList.add('hidden');
                if (bottomNav) bottomNav.style.display = window.innerWidth <= 768 ? 'flex' : 'none';

                // Navigate to employee dashboard
                router.navigate('dashboard');
            }

            // Initialize mobile
            if (window.mobile) {
                window.mobile.handleResize();
            }
        }
    },

    showLogin() {
        const loginContainer = document.getElementById('login-container');
        const appContainer = document.getElementById('app-container');

        if (loginContainer && appContainer) {
            appContainer.classList.add('hidden');
            loginContainer.style.display = 'flex';

            // Reset form
            const loginForm = document.getElementById('login-form');
            if (loginForm) loginForm.reset();
        }
    },

    updateUserUI() {
        if (!this.currentUser) return;

        // Update user info in sidebar
        const userNameEl = document.getElementById('user-name');
        const userRoleEl = document.getElementById('user-role');
        const userAvatarEl = document.getElementById('user-avatar');
        const welcomeNameEl = document.getElementById('welcome-name');

        if (userNameEl) userNameEl.textContent = this.currentUser.name;
        if (userRoleEl) userRoleEl.textContent = this.currentUser.role === 'admin' ? 'Administrator' : 'Karyawan';
        if (userAvatarEl) userAvatarEl.src = getAvatarUrl(this.currentUser);
        if (welcomeNameEl) welcomeNameEl.textContent = this.currentUser.name.split(' ')[0];
    },

    async openProfileModal() {
        const modal = document.getElementById('modal-profile');
        if (!modal) return;

        const user = this.currentUser;
        if (!user) return;

        // Set basic info
        document.getElementById('profile-avatar').src = getAvatarUrl(user);
        document.getElementById('profile-name').textContent = user.name || '-';
        document.getElementById('profile-email').textContent = user.email || '-';
        document.getElementById('profile-role').textContent = user.role === 'admin' ? 'Administrator' : 'Karyawan';

        // Employee-specific fields
        const empFields = document.getElementById('profile-employee-fields');
        if (user.role === 'karyawan' || user.role !== 'admin') {
            // Fetch profile from backend
            try {
                const result = await api.getEmployeeProfile(user.id);
                if (result.success && result.data) {
                    const profile = result.data;
                    document.getElementById('profile-department').textContent = profile.department || '-';
                    document.getElementById('profile-position').textContent = profile.position || '-';
                    document.getElementById('profile-shift').textContent = profile.shift || '-';
                }
            } catch (e) {
                document.getElementById('profile-department').textContent = user.department || '-';
                document.getElementById('profile-position').textContent = user.position || '-';
                document.getElementById('profile-shift').textContent = user.shift || '-';
            }
            if (empFields) empFields.style.display = 'block';
        } else {
            if (empFields) empFields.style.display = 'none';
        }

        // Clear password form
        document.getElementById('old-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';

        modal.style.display = 'flex';
    },

    async handleChangePassword() {
        const oldPwd = document.getElementById('old-password').value;
        const newPwd = document.getElementById('new-password').value;
        const confirmPwd = document.getElementById('confirm-password').value;

        if (!oldPwd || !newPwd || !confirmPwd) {
            toast.error('Semua field password harus diisi!');
            return;
        }
        if (newPwd !== confirmPwd) {
            toast.error('Password baru dan konfirmasi tidak cocok!');
            return;
        }
        if (newPwd.length < 4) {
            toast.error('Password minimal 4 karakter!');
            return;
        }

        try {
            const result = await api.changePassword(this.currentUser.id, oldPwd, newPwd);
            if (result.success) {
                toast.success('Password berhasil diubah!');
                document.getElementById('old-password').value = '';
                document.getElementById('new-password').value = '';
                document.getElementById('confirm-password').value = '';
            } else {
                toast.error(result.error || 'Gagal mengubah password');
            }
        } catch (error) {
            console.error('Error changing password:', error);
            toast.error('Terjadi kesalahan');
        }
    },

    togglePasswordVisibility() {
        const passwordInput = document.getElementById('login-password');
        const toggleBtn = document.getElementById('toggle-password');

        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
        } else {
            passwordInput.type = 'password';
            toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
        }
    },

    isLoggedIn() {
        return this.currentUser !== null;
    },

    isAdmin() {
        return this.currentUser && this.currentUser.role === 'admin';
    },

    getCurrentUser() {
        return this.currentUser;
    }
};

// Initialize auth on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    auth.init();
});

// Expose to global
window.auth = auth;
