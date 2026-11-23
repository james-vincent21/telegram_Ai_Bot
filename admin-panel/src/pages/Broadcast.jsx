import React, { useEffect, useState } from 'react';
import {
  Megaphone,
  Send,
  FlaskConical,
  Users,
  ShoppingBag,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  StopCircle,
  Link2,
} from 'lucide-react';
import api from '../api';

const STATUS = {
  sending: 'bg-violet-500/10 text-violet-300 border-violet-400/25',
  done: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/25',
  stopped: 'bg-amber-500/10 text-amber-300 border-amber-400/25',
  interrupted: 'bg-rose-500/10 text-rose-300 border-rose-400/25',
};

// Very small preview of Telegram HTML (b, i, u, s, code, a, blockquote)
function previewHtml(text) {
  const escd = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escd
    .replace(/&lt;(\/?)(b|strong|i|em|u|s|code|blockquote)&gt;/g, '<$1$2>')
    .replace(/&lt;a href="(https?:[^"]+)"&gt;/g, '<a href="$1" target="_blank" rel="noreferrer">')
    .replace(/&lt;\/a&gt;/g, '</a>')
    .replace(/\n/g, '<br/>');
}

export default function Broadcast() {
  const [form, setForm] = useState({ text: '', buttonText: '', buttonUrl: '', addShopButton: true, audience: 'all' });
  const [data, setData] = useState({ broadcasts: [], audience: { all: 0, buyers: 0 }, shopEnabled: false });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/broadcasts');
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load broadcasts');
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Live progress while something is sending
  useEffect(() => {
    if (!data.broadcasts.some((b) => b.status === 'sending')) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [data.broadcasts]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const test = async () => {
    setBusy('test');
    setError('');
    setNotice('');
    try {
      const res = await api.post('/broadcasts/test', form);
      setNotice(`${res.data.message} Check your Telegram.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Test failed');
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    setBusy('send');
    setError('');
    setNotice('');
    setConfirm(false);
    try {
      await api.post('/broadcasts', form);
      setNotice('Broadcast started. You can follow the progress below.');
      setForm({ ...form, text: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start broadcast');
    } finally {
      setBusy('');
    }
  };

  const stop = async (id) => {
    await api.post(`/broadcasts/${id}/stop`).catch(() => {});
    setTimeout(load, 800);
  };

  const audienceCount = form.audience === 'buyers' ? data.audience.buyers : data.audience.all;
  const insert = (tag) => setForm({ ...form, text: `${form.text}<${tag}></${tag}>` });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Broadcast</h1>
        <p className="text-sm text-gray-400 mt-1">Send an announcement or offer to everyone who uses the bot.</p>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-400/25 text-rose-200 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-400/25 text-emerald-200 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Composer */}
        <div className="lg:col-span-3 glass-card border border-white/[0.06] rounded-3xl p-6 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em]">Message</label>
              <div className="flex gap-1">
                {[['b', 'B'], ['i', 'I'], ['u', 'U'], ['code', '</>']].map(([t, l]) => (
                  <button key={t} onClick={() => insert(t)} className="px-2 py-1 rounded-lg glass-soft border border-white/10 text-[11px] font-bold text-gray-300 hover:text-white">
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={form.text}
              onChange={set('text')}
              rows={8}
              maxLength={4000}
              placeholder={'🎉 <b>Eid Offer!</b>\n\nGet 20% off all residential proxies this week.'}
              className="w-full field border border-gray-700 focus:border-blue-500 rounded-2xl px-4 py-3 text-sm text-white outline-none resize-y font-mono"
            />
            <p className="text-[11px] text-gray-500 mt-1.5">
              Telegram HTML is supported: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;code&gt;, &lt;a href=""&gt;, &lt;blockquote&gt;. {form.text.length}/4000
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em]">Button text (optional)</label>
              <input value={form.buttonText} onChange={set('buttonText')} placeholder="🌐 See offer" className="mt-2 w-full field border border-gray-700 focus:border-blue-500 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em]">Button link</label>
              <div className="relative mt-2">
                <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={form.buttonUrl} onChange={set('buttonUrl')} placeholder="https://ipdokan.com/offer" className="w-full field border border-gray-700 focus:border-blue-500 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white outline-none" />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-3 p-3 rounded-2xl glass-soft border border-white/10 cursor-pointer">
            <input type="checkbox" checked={form.addShopButton} onChange={set('addShopButton')} className="w-4 h-4 accent-violet-500" />
            <span className="text-sm text-gray-200">
              Add a green <b>{data.shopEnabled ? '🛍 Open Shop' : '⚡ Buy Proxy'}</b> button
            </span>
          </label>

          <div>
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em]">Send to</label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {[
                { id: 'all', label: 'All users', icon: Users, n: data.audience.all },
                { id: 'buyers', label: 'Buyers only', icon: ShoppingBag, n: data.audience.buyers },
              ].map((a) => (
                <button
                  key={a.id}
                  onClick={() => setForm({ ...form, audience: a.id })}
                  className={`p-4 rounded-2xl text-left border transition ${
                    form.audience === a.id ? 'ring-gradient bg-violet-600/15 border-transparent' : 'glass-soft border-white/10 hover:border-white/20'
                  }`}
                >
                  <a.icon className={`w-5 h-5 ${form.audience === a.id ? 'text-violet-300' : 'text-gray-500'}`} />
                  <div className="mt-2 text-sm font-bold text-white">{a.label}</div>
                  <div className="text-xs text-gray-400">{a.n.toLocaleString()} people</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              onClick={test}
              disabled={!form.text.trim() || busy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl glass-soft border border-white/10 text-sm font-bold text-gray-200 hover:bg-white/5 disabled:opacity-50"
            >
              {busy === 'test' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Send test to admins
            </button>
            <button
              onClick={() => setConfirm(true)}
              disabled={!form.text.trim() || busy || audienceCount === 0}
              className="flex-1 btn-gradient inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold disabled:opacity-50"
            >
              <Send className="w-4 h-4" /> Send to {audienceCount.toLocaleString()}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2 space-y-5">
          <div className="glass-card border border-white/[0.06] rounded-3xl p-6">
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em] mb-3">Preview</div>
            <div className="rounded-2xl p-4 bg-gradient-to-br from-[#1b2a3a] to-[#14202e]">
              <div className="max-w-[90%] rounded-2xl rounded-tl-md bg-[#22303f] px-4 py-3 text-sm text-gray-100 leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:border-sky-400 [&_blockquote]:pl-2 [&_a]:text-sky-300 [&_code]:font-mono [&_code]:text-pink-300">
                {form.text.trim() ? <div dangerouslySetInnerHTML={{ __html: previewHtml(form.text) }} /> : <span className="text-gray-500">Your message will appear here…</span>}
              </div>
              <div className="mt-1.5 max-w-[90%] space-y-1.5">
                {form.buttonText && form.buttonUrl && (
                  <div className="text-center text-sm font-semibold text-white py-2 rounded-xl bg-white/10">{form.buttonText}</div>
                )}
                {form.addShopButton && (
                  <div className="text-center text-sm font-semibold text-white py-2 rounded-xl bg-emerald-600">{data.shopEnabled ? '🛍 Open Shop' : '⚡ Buy Proxy'}</div>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card border border-white/[0.06] rounded-3xl p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.14em]">History</div>
              <button onClick={load} className="text-gray-400 hover:text-white">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            {data.broadcasts.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">
                <Megaphone className="w-6 h-6 mx-auto mb-2 opacity-50" /> No broadcasts yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.broadcasts.map((b) => {
                  const done = b.sent + b.failed + b.blocked;
                  const pct = b.total ? Math.min(100, Math.round((done / b.total) * 100)) : 100;
                  return (
                    <li key={b._id} className="p-3 rounded-2xl glass-soft border border-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border capitalize ${STATUS[b.status]}`}>{b.status}</span>
                        <span className="text-[11px] text-gray-500">{new Date(b.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-gray-300 mt-2 line-clamp-2">{b.text.replace(/<[^>]+>/g, '')}</p>
                      <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-400">
                        <span>
                          <b className="text-emerald-300">{b.sent}</b> sent · <b className="text-amber-300">{b.blocked}</b> blocked · <b className="text-rose-300">{b.failed}</b> failed · {b.total} total
                        </span>
                        {b.status === 'sending' && (
                          <button onClick={() => stop(b._id)} className="inline-flex items-center gap-1 text-rose-300 hover:text-rose-200 font-bold">
                            <StopCircle className="w-3.5 h-3.5" /> Stop
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(false)}>
          <div className="glass-card border border-white/10 rounded-3xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mb-4">
              <Megaphone className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-extrabold text-white">Send to {audienceCount.toLocaleString()} people?</h3>
            <p className="text-sm text-gray-400 mt-1">This can't be undone. Messages go out at about 20 per second.</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setConfirm(false)} className="flex-1 px-4 py-2.5 rounded-xl glass-soft border border-white/10 text-sm font-bold text-gray-200">
                Cancel
              </button>
              <button onClick={send} className="flex-1 btn-gradient px-4 py-2.5 rounded-xl text-sm font-bold">
                {busy === 'send' ? 'Starting…' : 'Yes, send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
