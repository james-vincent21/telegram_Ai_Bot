import React, { useState } from 'react';
import { ShieldCheck, Lock, User, AlertCircle, Loader2, Eye, EyeOff, ArrowRight } from 'lucide-react';
import api from '../api';
import Aurora from '../components/Aurora';

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please fill in both fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api.post('/auth/login', { username, password });
      const { token, user } = response.data;
      localStorage.setItem('admin_token', token);
      localStorage.setItem('admin_user', JSON.stringify(user));
      onLoginSuccess(user);
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center p-4 relative overflow-hidden">
      <Aurora />

      <div className="relative z-10 w-full max-w-md animate-pop">
        <div className="absolute -inset-px rounded-[28px] bg-gradient-to-br from-violet-500/60 via-fuchsia-500/30 to-cyan-400/50 blur-[2px]" />
        <div className="relative glass-card rounded-[28px] p-8 sm:p-10">
          <div className="text-center mb-8">
            <div className="relative w-16 h-16 mx-auto mb-5">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 blur-xl opacity-70" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 flex items-center justify-center text-white">
                <ShieldCheck className="w-8 h-8" />
              </div>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-gradient">Welcome back</h2>
            <p className="text-sm text-gray-400 mt-2">Sign in to manage your proxy store, stock and orders</p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-400/25 flex items-center gap-3 text-rose-200 text-sm animate-fade-up">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-300" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em] mb-2">Username</label>
              <div className="relative group">
                <User className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-300 transition" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full field border border-gray-700/70 focus:border-blue-400 rounded-2xl pl-12 pr-4 py-3.5 text-white text-sm outline-none placeholder:text-gray-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em] mb-2">Password</label>
              <div className="relative group">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-300 transition" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full field border border-gray-700/70 focus:border-blue-400 rounded-2xl pl-12 pr-12 py-3.5 text-white text-sm outline-none placeholder:text-gray-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-500 hover:text-gray-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-gradient w-full mt-2 font-bold py-3.5 px-4 rounded-2xl text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-gray-500">
            Default seed credentials: <code className="text-blue-300">admin</code> / <code className="text-blue-300">admin123</code>
          </p>
        </div>
      </div>
    </div>
  );
}
