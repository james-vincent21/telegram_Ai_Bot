import React, { useState, useEffect } from 'react';
import { Menu, CalendarDays } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Aurora from './components/Aurora';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Stock from './pages/Stock';
import Orders from './pages/Orders';

const TAB_TITLES = {
  dashboard: 'Dashboard',
  products: 'Brands & Plans',
  stock: 'Stock Inventory',
  orders: 'Customer Orders',
};

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('admin_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const handleLogout = () => setUser(null);
    window.addEventListener('auth_logout', handleLogout);
    return () => window.removeEventListener('auth_logout', handleLogout);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setUser(null);
  };

  const changeTab = (tab) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  if (!user) {
    return <Login onLoginSuccess={setUser} />;
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="relative flex h-screen bg-ink-950 text-gray-100 overflow-hidden">
      <Aurora />

      <Sidebar
        activeTab={activeTab}
        setActiveTab={changeTab}
        onLogout={handleLogout}
        user={user}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <main className="relative z-10 flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/60 backdrop-blur-xl">
          <div className="max-w-7xl w-full mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-xl text-gray-300 hover:bg-white/5"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <nav className="flex items-center gap-2 text-sm min-w-0">
                <span className="text-gray-500 hidden sm:inline">Admin</span>
                <span className="text-gray-600 hidden sm:inline">/</span>
                <span className="font-semibold text-white truncate">{TAB_TITLES[activeTab]}</span>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full glass-soft border border-white/5 text-xs text-gray-300">
                <CalendarDays className="w-3.5 h-3.5 text-blue-300" />
                {today}
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-400/20 text-xs font-medium text-emerald-300">
                <span className="relative flex w-2 h-2">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
                </span>
                Bot Live
              </div>
            </div>
          </div>
        </header>

        <div key={activeTab} className="max-w-7xl w-full mx-auto p-4 md:p-8 animate-fade-up">
          {activeTab === 'dashboard' && <Dashboard setActiveTab={changeTab} user={user} />}
          {activeTab === 'products' && <Products />}
          {activeTab === 'stock' && <Stock />}
          {activeTab === 'orders' && <Orders />}
        </div>
      </main>
    </div>
  );
}
