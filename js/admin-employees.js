/**
 * Portal Karyawan - Admin Employees
 * Employee management for admin
 */

const adminEmployees = {
    employees: [],
    currentPage: 1,
    perPage: 10,
    filters: {
        search: '',
        department: '',
        status: ''
    },

    async init() {
        if (!auth.isAdmin()) {
            toast.error('Anda tidak memiliki akses!');
            router.navigate('dashboard');
            return;
        }

        await this.loadEmployees();
        this.bindEvents();
        this.renderTable();
        this.renderMobileCards();
        this.updatePaginationInfo();
    },

    async loadEmployees() {
        try {
            const result = await api.getEmployees();
            this.employees = result.data || [];
        } catch (error) {
            console.error('Error loading employees:', error);
            this.employees = storage.get('admin_employees', []);
        }
    },

    bindEvents() {
        // Search filter
        const searchInput = document.getElementById('employee-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value.toLowerCase();
                this.currentPage = 1;
                this.renderTable();
                this.renderMobileCards();
                this.updatePaginationInfo();
            });
        }

        // Department filter
        const deptFilter = document.getElementById('dept-filter');
        if (deptFilter) {
            deptFilter.addEventListener('change', (e) => {
                this.filters.department = e.target.value;
                this.currentPage = 1;
                this.renderTable();
                this.renderMobileCards();
                this.updatePaginationInfo();
            });
        }

        // Status filter
        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', (e) => {
                this.filters.status = e.target.value;
                this.currentPage = 1;
                this.renderTable();
                this.renderMobileCards();
                this.updatePaginationInfo();
            });
        }

        // Add employee button
        const addBtn = document.getElementById('btn-add-employee');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAddModal());
        }

        // Close modal
        const closeBtn = document.getElementById('btn-close-modal');
        const cancelBtn = document.getElementById('btn-cancel-add');
        const modal = document.getElementById('modal-add-employee');

        if (closeBtn) closeBtn.addEventListener('click', () => this.hideAddModal());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hideAddModal());

        // Close modal when clicking overlay
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hideAddModal();
            });
        }

        // Form submit
        const form = document.getElementById('form-add-employee');
        if (form) {
            form.addEventListener('submit', (e) => this.handleAddEmployee(e));
        }

        // Set default date
        const joinDateInput = document.getElementById('emp-join-date');
        if (joinDateInput) {
            joinDateInput.valueAsDate = new Date();
        }
    },

    getFilteredEmployees() {
        return this.employees.filter(emp => {
            const matchesSearch = !this.filters.search ||
                emp.name.toLowerCase().includes(this.filters.search) ||
                emp.email.toLowerCase().includes(this.filters.search) ||
                emp.position.toLowerCase().includes(this.filters.search);

            const matchesDept = !this.filters.department || emp.department === this.filters.department;
            const matchesStatus = !this.filters.status || emp.status === this.filters.status;

            return matchesSearch && matchesDept && matchesStatus;
        });
    },

    renderTable() {
        const tbody = document.getElementById('employees-table-body');
        if (!tbody) return;

        const filtered = this.getFilteredEmployees();
        const start = (this.currentPage - 1) * this.perPage;
        const paginated = filtered.slice(start, start + this.perPage);

        if (paginated.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: var(--spacing-xl);">
                        Tidak ada data karyawan
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = paginated.map(emp => `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">
                            <img src="${getAvatarUrl(emp)}" alt="${emp.name}">
                        </div>
                        <div class="employee-details">
                            <span class="employee-name">${emp.name}</span>
                            <span class="employee-email">${emp.email}</span>
                        </div>
                    </div>
                </td>
                <td>EMP${String(emp.id).padStart(3, '0')}</td>
                <td>${emp.department}</td>
                <td>${emp.position}</td>
                <td>${emp.shift}</td>
                <td>
                    <span class="status-badge ${emp.status}">
                        ${this.getStatusLabel(emp.status)}
                    </span>
                </td>
                <td>
                    <button class="btn-action view" onclick="adminEmployees.viewEmployee(${emp.id})" title="Lihat">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-action edit" onclick="adminEmployees.editEmployee(${emp.id})" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-action delete" onclick="adminEmployees.deleteEmployee(${emp.id})" title="Hapus">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        this.updatePagination(filtered.length);
    },

    renderMobileCards() {
        const container = document.getElementById('employees-mobile-cards');
        if (!container) return;

        const filtered = this.getFilteredEmployees();
        const start = (this.currentPage - 1) * this.perPage;
        const paginated = filtered.slice(start, start + this.perPage);

        container.innerHTML = paginated.map(emp => `
            <div class="mobile-card">
                <div class="mobile-card-header">
                    <div class="employee-info">
                        <div class="employee-avatar">
                            <img src="${getAvatarUrl(emp)}" alt="${emp.name}">
                        </div>
                        <div class="employee-details">
                            <span class="employee-name">${emp.name}</span>
                            <span class="employee-email">${emp.email}</span>
                        </div>
                    </div>
                    <span class="status-badge ${emp.status}">${this.getStatusLabel(emp.status)}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="mobile-card-label">ID</span>
                    <span class="mobile-card-value">EMP${String(emp.id).padStart(3, '0')}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="mobile-card-label">Departemen</span>
                    <span class="mobile-card-value">${emp.department}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="mobile-card-label">Jabatan</span>
                    <span class="mobile-card-value">${emp.position}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="mobile-card-label">Shift</span>
                    <span class="mobile-card-value">${emp.shift}</span>
                </div>
                <div style="margin-top: var(--spacing); display: flex; gap: var(--spacing-xs);">
                    <button class="btn-action view" onclick="adminEmployees.viewEmployee(${emp.id})" style="flex: 1;">
                        <i class="fas fa-eye"></i> Lihat
                    </button>
                    <button class="btn-action edit" onclick="adminEmployees.editEmployee(${emp.id})" style="flex: 1;">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                </div>
            </div>
        `).join('');
    },

    updatePagination(totalItems) {
        const totalPages = Math.ceil(totalItems / this.perPage);
        const paginationButtons = document.querySelector('.pagination-buttons');

        if (paginationButtons) {
            let buttonsHtml = `
                <button class="btn-page" ${this.currentPage === 1 ? 'disabled' : ''} onclick="adminEmployees.goToPage(${this.currentPage - 1})">
                    <i class="fas fa-chevron-left"></i>
                </button>
            `;

            for (let i = 1; i <= totalPages; i++) {
                buttonsHtml += `
                    <button class="btn-page ${i === this.currentPage ? 'active' : ''}" onclick="adminEmployees.goToPage(${i})">${i}</button>
                `;
            }

            buttonsHtml += `
                <button class="btn-page" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="adminEmployees.goToPage(${this.currentPage + 1})">
                    <i class="fas fa-chevron-right"></i>
                </button>
            `;

            paginationButtons.innerHTML = buttonsHtml;
        }

        this.updatePaginationInfo();
    },

    updatePaginationInfo() {
        const filtered = this.getFilteredEmployees();
        const start = (this.currentPage - 1) * this.perPage + 1;
        const end = Math.min(start + this.perPage - 1, filtered.length);
        const info = document.querySelector('.pagination-info');

        if (info) {
            info.textContent = `Menampilkan ${filtered.length > 0 ? start : 0}-${end} dari ${filtered.length} karyawan`;
        }
    },

    goToPage(page) {
        const filtered = this.getFilteredEmployees();
        const totalPages = Math.ceil(filtered.length / this.perPage);

        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            this.renderTable();
            this.renderMobileCards();
        }
    },

    getStatusLabel(status) {
        const labels = {
            'active': 'Aktif',
            'on-leave': 'Cuti',
            'inactive': 'Non-Aktif'
        };
        return labels[status] || status;
    },

    showAddModal() {
        const modal = document.getElementById('modal-add-employee');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    },

    hideAddModal() {
        const modal = document.getElementById('modal-add-employee');
        const form = document.getElementById('form-add-employee');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
        if (form) {
            form.reset();
            // Reset date to today
            const joinDateInput = document.getElementById('emp-join-date');
            if (joinDateInput) joinDateInput.valueAsDate = new Date();
        }
    },

    async handleAddEmployee(e) {
        e.preventDefault();

        const name = document.getElementById('emp-name').value;
        const email = document.getElementById('emp-email').value;
        const department = document.getElementById('emp-department').value;
        const position = document.getElementById('emp-position').value;
        const shift = document.getElementById('emp-shift').value;
        const status = document.getElementById('emp-status').value;
        const joinDate = document.getElementById('emp-join-date').value;

        const employeeData = {
            name,
            email,
            department,
            position,
            shift,
            status,
            joinDate,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${this.getRandomColor()}&color=fff`
        };

        try {
            const result = await api.addEmployee(employeeData);
            if (result.success) {
                this.employees.unshift(result.data);

                // Update dept filter options if new department
                this.updateDeptFilterOptions(department);

                this.hideAddModal();
                this.renderTable();
                this.renderMobileCards();
                this.updatePaginationInfo();

                toast.success(`Karyawan ${name} berhasil ditambahkan!`);
            } else {
                toast.error(result.error || 'Gagal menambahkan karyawan');
            }
        } catch (error) {
            console.error('Error adding employee:', error);
            toast.error('Terjadi kesalahan');
        }
    },

    updateDeptFilterOptions(newDept) {
        // Update filter dropdown
        const deptFilter = document.getElementById('dept-filter');
        if (deptFilter) {
            const existingOptions = Array.from(deptFilter.options).map(opt => opt.value);
            if (!existingOptions.includes(newDept)) {
                const option = document.createElement('option');
                option.value = newDept;
                option.textContent = newDept;
                deptFilter.appendChild(option);
            }
        }

        // Update datalist in modal
        const deptList = document.getElementById('dept-list');
        if (deptList) {
            const existingOptions = Array.from(deptList.options).map(opt => opt.value);
            if (!existingOptions.includes(newDept)) {
                const option = document.createElement('option');
                option.value = newDept;
                deptList.appendChild(option);
            }
        }
    },

    getRandomColor() {
        const colors = ['3B82F6', '10B981', 'F59E0B', 'EF4444', '8B5CF6', 'EC4899', '06B6D4'];
        return colors[Math.floor(Math.random() * colors.length)];
    },

    viewEmployee(id) {
        const emp = this.employees.find(e => e.id === id);
        if (emp) {
            alert(`Detail Karyawan:\n\nNama: ${emp.name}\nEmail: ${emp.email}\nDepartemen: ${emp.department}\nJabatan: ${emp.position}\nShift: ${emp.shift}\nStatus: ${this.getStatusLabel(emp.status)}\nBergabung: ${emp.joinDate}`);
        }
    },

    editEmployee(id) {
        toast.info('Fitur edit karyawan akan segera hadir');
    },

    async deleteEmployee(id) {
        if (confirm('Apakah Anda yakin ingin menghapus karyawan ini?')) {
            try {
                await api.deleteEmployee(id);
                this.employees = this.employees.filter(e => e.id !== id);
                this.renderTable();
                this.renderMobileCards();
                this.updatePaginationInfo();
                toast.success('Karyawan berhasil dihapus');
            } catch (error) {
                console.error('Error deleting employee:', error);
                toast.error('Gagal menghapus karyawan');
            }
        }
    }
};

// Global init function
window.initEmployees = () => {
    adminEmployees.init();
};

// Expose
window.adminEmployees = adminEmployees;
