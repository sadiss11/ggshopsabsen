/**
 * Portal Karyawan - Mobile Responsive
 * Mobile-specific functionality
 */

const mobile = {
    isMobile: false,
    sidebarOpen: false,
    
    init() {
        this.checkMobile();
        this.initSidebar();
        this.initBottomNav();
        this.handleResize();
        
        // Listen for resize events
        window.addEventListener('resize', () => this.handleResize());
    },
    
    checkMobile() {
        this.isMobile = window.innerWidth <= 768;
        return this.isMobile;
    },
    
    handleResize() {
        const wasMobile = this.isMobile;
        this.checkMobile();
        
        // Toggle mobile menu button visibility
        const menuToggle = document.getElementById('mobile-menu-toggle');
        if (menuToggle) {
            menuToggle.style.display = this.isMobile ? 'flex' : 'none';
        }
        
        // Toggle sidebar behavior
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            if (this.isMobile) {
                sidebar.classList.remove('open');
                this.sidebarOpen = false;
            } else {
                sidebar.style.transform = '';
            }
        }
        
        // Toggle bottom nav
        const bottomNav = document.getElementById('bottom-nav');
        if (bottomNav) {
            bottomNav.style.display = this.isMobile ? 'flex' : 'none';
        }
        
        // Update tables to cards on mobile
        this.updateTableViews();
    },
    
    initSidebar() {
        const menuToggle = document.getElementById('mobile-menu-toggle');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const sidebarToggle = document.getElementById('sidebar-toggle');
        
        // Mobile menu toggle
        if (menuToggle) {
            menuToggle.addEventListener('click', () => this.toggleSidebar());
        }
        
        // Sidebar toggle button (collapse/expand on desktop)
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => {
                if (!this.isMobile) {
                    sidebar?.classList.toggle('collapsed');
                }
            });
        }
        
        // Close sidebar when clicking overlay
        if (overlay) {
            overlay.addEventListener('click', () => this.closeSidebar());
        }
        
        // Close sidebar when clicking nav items on mobile
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                if (this.isMobile) {
                    this.closeSidebar();
                }
            });
        });
    },
    
    initBottomNav() {
        const bottomNav = document.getElementById('bottom-nav');
        if (!bottomNav) return;
        
        const navItems = bottomNav.querySelectorAll('.bottom-nav-item');
        
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                if (page) {
                    // Update active state
                    navItems.forEach(n => n.classList.remove('active'));
                    item.classList.add('active');
                    
                    // Navigate
                    router.navigate(page);
                }
            });
        });
    },
    
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        this.sidebarOpen = !this.sidebarOpen;
        
        if (this.sidebarOpen) {
            sidebar?.classList.add('open');
            overlay?.classList.add('show');
            document.body.style.overflow = 'hidden';
        } else {
            this.closeSidebar();
        }
    },
    
    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        this.sidebarOpen = false;
        sidebar?.classList.remove('open');
        overlay?.classList.remove('show');
        document.body.style.overflow = '';
    },
    
    updateTableViews() {
        // Convert tables to cards on mobile if needed
        const tableContainers = document.querySelectorAll('.table-responsive');
        
        tableContainers.forEach(container => {
            const table = container.querySelector('table');
            const mobileCards = container.nextElementSibling;
            
            if (table && mobileCards && mobileCards.classList.contains('mobile-cards')) {
                if (this.isMobile) {
                    container.style.display = 'none';
                    mobileCards.style.display = 'block';
                } else {
                    container.style.display = 'block';
                    mobileCards.style.display = 'none';
                }
            }
        });
    },
    
    // Update bottom nav active state based on current page
    updateBottomNav(page) {
        const bottomNav = document.getElementById('bottom-nav');
        if (!bottomNav) return;
        
        const navItems = bottomNav.querySelectorAll('.bottom-nav-item');
        navItems.forEach(item => {
            item.classList.remove('active');
            if (item.dataset.page === page) {
                item.classList.add('active');
            }
        });
    }
};

// Touch swipe support for sidebar
document.addEventListener('touchstart', handleTouchStart, { passive: true });
document.addEventListener('touchmove', handleTouchMove, { passive: true });

let xDown = null;
let yDown = null;

function handleTouchStart(evt) {
    xDown = evt.touches[0].clientX;
    yDown = evt.touches[0].clientY;
}

function handleTouchMove(evt) {
    if (!xDown || !yDown) return;
    
    const xUp = evt.touches[0].clientX;
    const yUp = evt.touches[0].clientY;
    
    const xDiff = xDown - xUp;
    const yDiff = yDown - yUp;
    
    // Horizontal swipe
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        // Swipe right - open sidebar (from left edge)
        if (xDiff < -50 && xDown < 50 && mobile.isMobile) {
            mobile.toggleSidebar();
        }
        // Swipe left - close sidebar
        if (xDiff > 50 && mobile.sidebarOpen) {
            mobile.closeSidebar();
        }
    }
    
    xDown = null;
    yDown = null;
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    mobile.init();
});

// Expose
window.mobile = mobile;
