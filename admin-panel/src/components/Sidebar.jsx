import React from 'react';
import {
  LayoutDashboard,
  Layers,
  Database,
  ShoppingCart,
  LogOut,
  ShieldCheck,
  X,
  Sparkles,
} from 'lucide-react';

const menuItems = [
  { id: 'dashboard', label: 'Dashboard', hint: 'Overview & metrics', icon: LayoutDashboard },
  { id: 'products', label: 'Brands & Plans', hint: 'Catalog & pricing', icon: Layers },
  { id: 'stock', label: 'Stock Inventory', hint: 'Credentials pool', icon: Database },
  { id: 'orders', label: 'Customer Orders', hint: 'Payments & delivery', icon: ShoppingCart },
];

export default function Sidebar({ activeTab, setActiveTab, onLogout, user, mobileOpen, onClose }) {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm lg:hidden transition-opacity ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 flex flex-col h-screen select-none
          border-r border-white/5 bg-ink-900/80 backdrop-blur-2xl
          transition-transform duration-300 ease-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand header */}
        <div className="h-20 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 blur-md opacity-60" />
              <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 flex items-center justify-center text-white">
                <ShieldCheck className="w-6 h-6" />
              </div>
            </div>
            <div>
              <h1 className="font-extrabold text-white text-[17px] leading-tight tracking-tight">Proxy Store</h1>
              <span className="text-[10px] font-bold tracking-[0.2em] bg-gradient-to-r from-violet-300 to-cyan-300 bg-clip-text text-transparent">
                ADMIN PORTAL
              </span>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden p-2 rounded-lg text-gray-400 hover:bg-white/5" aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mx-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          <p className="px-3 pb-2 text-[10px] font-bold tracking-[0.18em] text-gray-500">MENU</p>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`group relative w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl text-left transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-violet-600/25 via-fuchsia-600/10 to-transparent text-white'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.04]'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-r-full bg-gradient-to-b from-violet-400 to-cyan-300 shadow-[0_0_12px_rgba(157,125,255,.9)]" />
                )}
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-glow'
                      : 'bg-white/[0.04] text-gray-400 group-hover:text-blue-300'
                  }`}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className={`block text-[11px] ${isActive ? 'text-blue-200/80' : 'text-gray-500'}`}>{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Promo card */}
        <div className="mx-4 mb-4 p-4 rounded-2xl ring-gradient bg-gradient-to-br from-violet-600/20 via-fuchsia-600/10 to-cyan-500/10">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="w-4 h-4 text-fuchsia-300" /> Auto delivery on
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
            Paid orders get their credentials on Telegram right away.
          </p>
        </div>

        {/* User */}
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center justify-between gap-2 p-2 rounded-2xl hover:bg-white/[0.03] transition">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 p-[2px] flex-shrink-0">
                <div className="w-full h-full rounded-[10px] bg-ink-900 flex items-center justify-center text-white font-bold text-sm">
                  {user?.username?.[0]?.toUpperCase() || 'A'}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-100 truncate">{user?.username || 'Admin'}</p>
                <p className="text-[11px] text-gray-500">Administrator</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              title="Log Out"
              className="p-2.5 text-gray-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
