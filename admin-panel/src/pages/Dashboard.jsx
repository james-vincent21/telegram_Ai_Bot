import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  ShoppingCart,
  Users,
  AlertTriangle,
  ArrowUpRight,
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  Package,
  Zap,
} from 'lucide-react';
import api from '../api';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const STAT_THEMES = {
  violet: {
    icon: 'from-violet-500 to-fuchsia-500',
    glow: 'bg-violet-500/25',
    accent: 'text-violet-300',
  },
  cyan: {
    icon: 'from-sky-500 to-cyan-400',
    glow: 'bg-cyan-500/20',
    accent: 'text-cyan-300',
  },
  emerald: {
    icon: 'from-emerald-500 to-teal-400',
    glow: 'bg-emerald-500/20',
    accent: 'text-emerald-300',
  },
  amber: {
    icon: 'from-amber-500 to-orange-500',
    glow: 'bg-amber-500/20',
    accent: 'text-amber-300',
  },
};

function StatCard({ label, value, unit, sub, icon: Icon, theme = 'violet', delay = 0 }) {
  const t = STAT_THEMES[theme];
  return (
    <div
      className="group relative glass-card border border-white/[0.06] rounded-3xl p-5 overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-white/10 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl ${t.glow} opacity-60 group-hover:opacity-100 transition`} />
      <div className="relative flex items-start justify-between">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em]">{label}</span>
        <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${t.icon} text-white flex items-center justify-center shadow-lg`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="relative mt-4">
        <h3 className="text-3xl font-extrabold text-white tracking-tight tabular-nums">
          {value}
          {unit && <span className="ml-1.5 text-xs font-semibold text-gray-400">{unit}</span>}
        </h3>
        <div className={`text-xs mt-2 font-medium ${t.accent}`}>{sub}</div>
      </div>
    </div>
  );
}

export default function Dashboard({ setActiveTab, user }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/stats');
      setStats(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Status mix of the recent orders, for the breakdown bar
  const statusMix = useMemo(() => {
    const list = stats?.recentOrders || [];
    const counts = { delivered: 0, paid: 0, stock_pending: 0, pending: 0, other: 0 };
    list.forEach((o) => {
      if (counts[o.status] !== undefined) counts[o.status] += 1;
      else counts.other += 1;
    });
    return { counts, total: list.length };
  }, [stats]);

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="h-40 rounded-3xl glass-card animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-3xl glass-card animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-3xl glass-card animate-pulse" />
      </div>
    );
  }

  const lowStock = stats?.lowStockAlerts || [];
  const mixSegments = [
    { key: 'delivered', label: 'Delivered', color: 'from-emerald-400 to-teal-400', dot: 'bg-emerald-400' },
    { key: 'paid', label: 'Paid', color: 'from-violet-500 to-fuchsia-500', dot: 'bg-violet-400' },
    { key: 'stock_pending', label: 'Stock pending', color: 'from-amber-400 to-orange-500', dot: 'bg-amber-400' },
    { key: 'pending', label: 'Pending', color: 'from-gray-500 to-gray-400', dot: 'bg-gray-400' },
    { key: 'other', label: 'Failed / cancelled', color: 'from-rose-500 to-pink-500', dot: 'bg-rose-400' },
  ];

  return (
    <div className="space-y-7">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl ring-gradient border border-white/5 p-6 md:p-8 bg-gradient-to-br from-violet-700/40 via-fuchsia-700/20 to-cyan-600/20">
        <div className="absolute -right-16 -top-16 w-72 h-72 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute right-40 -bottom-24 w-64 h-64 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-[11px] font-semibold text-white/90 backdrop-blur">
              <Zap className="w-3.5 h-3.5 text-amber-300" /> Live overview
            </span>
            <h1 className="mt-4 text-3xl md:text-4xl font-extrabold tracking-tight text-white">
              {greeting()}, <span className="text-gradient">{user?.username || 'Admin'}</span>
            </h1>
            <p className="mt-2 text-sm text-white/70 max-w-lg">
              Sales, proxy stock and Telegram orders, all on one screen.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-[11px] uppercase tracking-[0.14em] text-white/60 font-bold">Today's revenue</p>
              <p className="text-2xl font-extrabold text-white tabular-nums">
                {stats?.revenue?.today?.toLocaleString() || 0} <span className="text-xs font-semibold text-white/60">BDT</span>
              </p>
            </div>
            <button
              onClick={fetchStats}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm font-semibold backdrop-blur transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-400/25 text-rose-200 text-sm">{error}</div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Total Revenue"
          value={stats?.revenue?.total?.toLocaleString() || 0}
          unit="BDT"
          icon={Wallet}
          theme="violet"
          sub={
            <span className="inline-flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5" /> Today: {stats?.revenue?.today?.toLocaleString() || 0} BDT
            </span>
          }
        />
        <StatCard
          label="Completed Orders"
          value={stats?.orders?.totalPaid || 0}
          icon={ShoppingCart}
          theme="cyan"
          delay={60}
          sub={
            <span className="text-gray-400">
              Today <strong className="text-white">{stats?.orders?.today || 0}</strong>
              <span className="mx-1.5 text-gray-600">•</span>
              Pending <strong className="text-amber-300">{stats?.orders?.pending || 0}</strong>
            </span>
          }
        />
        <StatCard
          label="Telegram Users"
          value={stats?.customers || 0}
          icon={Users}
          theme="emerald"
          delay={120}
          sub="Registered Telegram buyers"
        />
        <StatCard
          label="Low Stock Plans"
          value={lowStock.length}
          icon={AlertTriangle}
          theme="amber"
          delay={180}
          sub={lowStock.length ? 'Restock needed now' : 'All plans have enough stock'}
        />
      </div>

      {/* Low stock + status mix */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 glass-card border border-white/[0.06] rounded-3xl p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Stock health</h2>
                <p className="text-xs text-gray-400">Plans with fewer than 5 credentials left</p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('stock')}
              className="btn-gradient px-4 py-2 text-xs font-bold rounded-xl whitespace-nowrap"
            >
              Add Stock
            </button>
          </div>

          <div className="mt-5">
            {lowStock.length === 0 ? (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-400/20 text-sm text-emerald-200">
                <CheckCircle2 className="w-5 h-5 text-emerald-300" /> All plans have enough stock.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {lowStock.map((item, idx) => {
                  const pct = Math.max(6, Math.min(100, (item.availableStock / 5) * 100));
                  return (
                    <li key={idx} className="p-3 rounded-2xl glass-soft border border-white/5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-200 font-medium truncate">
                          {item.brandEmoji} {item.brandName} <span className="text-gray-500">—</span> {item.planLabel}
                        </span>
                        <span className={`text-xs font-bold ${item.availableStock === 0 ? 'text-rose-300' : 'text-amber-300'}`}>
                          {item.availableStock} left
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${
                            item.availableStock === 0 ? 'from-rose-500 to-pink-500' : 'from-amber-400 to-orange-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 glass-card border border-white/[0.06] rounded-3xl p-6">
          <h2 className="text-base font-bold text-white">Order status mix</h2>
          <p className="text-xs text-gray-400">Across the {statusMix.total} most recent orders</p>

          <div className="mt-6 flex h-3 rounded-full overflow-hidden bg-white/5 gap-0.5">
            {statusMix.total > 0 &&
              mixSegments.map((seg) =>
                statusMix.counts[seg.key] ? (
                  <div
                    key={seg.key}
                    title={`${seg.label}: ${statusMix.counts[seg.key]}`}
                    className={`h-full bg-gradient-to-r ${seg.color}`}
                    style={{ width: `${(statusMix.counts[seg.key] / statusMix.total) * 100}%` }}
                  />
                ) : null
              )}
          </div>

          <ul className="mt-6 space-y-3">
            {mixSegments.map((seg) => (
              <li key={seg.key} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2.5 text-gray-300">
                  <span className={`w-2.5 h-2.5 rounded-full ${seg.dot}`} />
                  {seg.label}
                </span>
                <span className="font-bold text-white tabular-nums">{statusMix.counts[seg.key]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Recent orders */}
      <div className="glass-card border border-white/[0.06] rounded-3xl overflow-hidden">
        <div className="p-5 md:px-6 flex items-center justify-between border-b border-white/5">
          <div>
            <h2 className="text-base font-bold text-white">Recent customer orders</h2>
            <p className="text-xs text-gray-400">Latest activity from the Telegram bot</p>
          </div>
          <button
            onClick={() => setActiveTab('orders')}
            className="text-xs text-blue-300 hover:text-white font-semibold flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-white/5 transition"
          >
            View all <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-300">
            <thead className="glass-soft text-[11px] font-bold text-gray-400 uppercase">
              <tr>
                <th className="py-3 px-6">Order ID</th>
                <th className="py-3 px-6">Customer</th>
                <th className="py-3 px-6">Package</th>
                <th className="py-3 px-6">Amount</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {!stats?.recentOrders?.length ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-gray-500 text-sm">
                    No orders yet.
                  </td>
                </tr>
              ) : (
                stats.recentOrders.map((ord) => {
                  const name = ord.telegramUsername ? `@${ord.telegramUsername}` : ord.telegramFirstName || 'User';
                  return (
                    <tr key={ord._id} className="hover:bg-white/[0.03] transition">
                      <td className="py-3.5 px-6 font-mono text-xs text-blue-200">{ord.orderId}</td>
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/40 to-cyan-400/30 border border-white/10 flex items-center justify-center text-xs font-bold text-white">
                            {name.replace('@', '')[0]?.toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="font-semibold text-white text-xs">{name}</div>
                            <div className="text-[11px] text-gray-500 font-mono">ID: {ord.telegramId}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-6 text-xs text-gray-300">
                        {ord.brandId?.name || 'Proxy'} <span className="text-gray-600">—</span> {ord.planId?.label || 'Plan'}
                        {ord.quantity > 1 && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-200 text-[10px] font-bold">
                            ×{ord.quantity}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-6 font-bold text-white text-xs tabular-nums">
                        {ord.amount} <span className="text-gray-500 font-medium">{ord.currency}</span>
                      </td>
                      <td className="py-3.5 px-6">
                        <StatusBadge status={ord.status} />
                      </td>
                      <td className="py-3.5 px-6 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(ord.createdAt).toLocaleDateString()}{' '}
                        <span className="text-gray-500">
                          {new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border';
  switch (status) {
    case 'delivered':
      return (
        <span className={`${base} bg-emerald-500/10 text-emerald-300 border-emerald-400/25`}>
          <CheckCircle2 className="w-3 h-3" /> Delivered
        </span>
      );
    case 'paid':
      return (
        <span className={`${base} bg-violet-500/10 text-violet-300 border-violet-400/25`}>
          <CheckCircle2 className="w-3 h-3" /> Paid
        </span>
      );
    case 'stock_pending':
      return (
        <span className={`${base} bg-amber-500/10 text-amber-300 border-amber-400/25`}>
          <Clock className="w-3 h-3" /> Stock Pending
        </span>
      );
    case 'pending':
      return (
        <span className={`${base} bg-gray-500/10 text-gray-300 border-gray-400/20`}>
          <Clock className="w-3 h-3" /> Pending
        </span>
      );
    default:
      return (
        <span className={`${base} bg-rose-500/10 text-rose-300 border-rose-400/25`}>
          <XCircle className="w-3 h-3" /> {status}
        </span>
      );
  }
}
