import React, { useEffect, useRef, useState } from 'react';
import {
  LifeBuoy,
  RefreshCw,
  Search,
  Send,
  CheckCircle2,
  RotateCcw,
  User,
  ShieldCheck,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import api from '../api';

const STATUS = {
  open: { label: 'Waiting for you', cls: 'bg-amber-500/10 text-amber-300 border-amber-400/25', dot: 'bg-amber-400' },
  answered: { label: 'Answered', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/25', dot: 'bg-emerald-400' },
  closed: { label: 'Closed', cls: 'bg-gray-500/10 text-gray-300 border-gray-400/20', dot: 'bg-gray-500' },
};

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
}

export default function Tickets() {
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ open: 0, answered: 0, closed: 0 });
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endRef = useRef(null);

  const load = async (keepSelected = true) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/tickets', { params: { status: filter, search } });
      setTickets(res.data.tickets);
      setCounts(res.data.counts);
      if (keepSelected && selected) {
        const fresh = await api.get(`/tickets/${selected._id}`);
        setSelected(fresh.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => load(false), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search]);

  // Refresh every 30s so new customer messages show up
  useEffect(() => {
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search, selected?._id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.messages?.length]);

  const open = async (t) => {
    setNotice('');
    setReply('');
    try {
      const res = await api.get(`/tickets/${t._id}`);
      setSelected(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to open ticket');
    }
  };

  const sendReply = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    setNotice('');
    try {
      const res = await api.post(`/tickets/${selected._id}/reply`, { text: reply });
      setSelected(res.data.ticket);
      setReply('');
      setNotice(res.data.delivered ? 'Reply sent to the customer on Telegram.' : 'Saved, but Telegram could not deliver it (the customer may have blocked the bot).');
      load(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status) => {
    try {
      const res = await api.post(`/tickets/${selected._id}/status`, { status });
      setSelected(res.data);
      load(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update ticket');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Support Tickets</h1>
          <p className="text-sm text-gray-400 mt-1">Customers open tickets in the bot. Your reply goes straight to their Telegram.</p>
        </div>
        <button
          onClick={() => load(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl glass-soft border border-white/10 text-sm font-semibold text-gray-200 hover:bg-white/5"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-400/25 text-rose-200 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* List */}
        <div className="lg:col-span-2 glass-card border border-white/[0.06] rounded-3xl overflow-hidden flex flex-col max-h-[75vh]">
          <div className="p-4 space-y-3 border-b border-white/5">
            <div className="flex gap-2">
              {['open', 'answered', 'closed', 'all'].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`flex-1 px-2 py-2 rounded-xl text-xs font-bold capitalize transition ${
                    filter === s ? 'btn-gradient' : 'glass-soft text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {s}
                  {s !== 'all' && <span className="ml-1 opacity-80">{counts[s]}</span>}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ticket no, @username, order ID…"
                className="w-full field border border-gray-700 focus:border-blue-500 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {tickets.length === 0 ? (
              <div className="py-16 text-center text-gray-500 text-sm">
                <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" /> No tickets here.
              </div>
            ) : (
              tickets.map((t) => {
                const last = t.messages[t.messages.length - 1];
                const st = STATUS[t.status];
                return (
                  <button
                    key={t._id}
                    onClick={() => open(t)}
                    className={`w-full text-left p-4 border-b border-white/[0.04] transition ${
                      selected?._id === t._id ? 'bg-gradient-to-r from-violet-600/20 to-transparent' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-bold text-white">
                        <span className={`w-2 h-2 rounded-full ${st.dot}`} /> {t.ticketNo}
                      </span>
                      <span className="text-[11px] text-gray-500">{timeAgo(t.lastMessageAt)}</span>
                    </div>
                    <div className="text-xs text-blue-200 mt-1">
                      {t.telegramUsername ? `@${t.telegramUsername}` : t.telegramFirstName || t.telegramId}
                      {t.orderId && <span className="text-gray-500 font-mono"> · {t.orderId}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">
                      {last?.from === 'admin' && <span className="text-emerald-300">You: </span>}
                      {last?.text}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className="lg:col-span-3 glass-card border border-white/[0.06] rounded-3xl flex flex-col max-h-[75vh] min-h-[420px]">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-500">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/30 to-cyan-400/20 flex items-center justify-center mb-3">
                <LifeBuoy className="w-7 h-7 text-blue-300" />
              </div>
              Select a ticket to read and reply.
            </div>
          ) : (
            <>
              <div className="p-5 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold text-white">{selected.ticketNo}</h2>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${STATUS[selected.status].cls}`}>
                      {STATUS[selected.status].label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {selected.telegramUsername ? `@${selected.telegramUsername}` : selected.telegramFirstName} ·{' '}
                    <span className="font-mono">{selected.telegramId}</span>
                    {selected.orderId && <span className="font-mono text-blue-200"> · {selected.orderId}</span>}
                  </p>
                </div>
                {selected.status === 'closed' ? (
                  <button onClick={() => setStatus('open')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl glass-soft border border-white/10 text-xs font-bold text-gray-200">
                    <RotateCcw className="w-3.5 h-3.5" /> Reopen
                  </button>
                ) : (
                  <button onClick={() => setStatus('closed')} className="btn-gradient-rose inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Close ticket
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {selected.messages.map((m, i) => {
                  const mine = m.from === 'admin';
                  return (
                    <div key={i} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center ${mine ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500' : 'bg-white/10'}`}>
                        {mine ? <ShieldCheck className="w-4 h-4 text-white" /> : <User className="w-4 h-4 text-gray-300" />}
                      </div>
                      <div className={`max-w-[80%] ${mine ? 'text-right' : ''}`}>
                        <div
                          className={`inline-block text-left px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                            mine ? 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white rounded-tr-md' : 'glass-soft border border-white/10 text-gray-100 rounded-tl-md'
                          }`}
                        >
                          {m.text}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-1">
                          {mine ? m.adminName || 'Admin' : 'Customer'} · {new Date(m.at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              <div className="p-4 border-t border-white/5 space-y-2">
                {notice && <p className="text-xs text-emerald-300">{notice}</p>}
                <div className="flex gap-2 items-end">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply();
                    }}
                    rows={2}
                    placeholder={selected.status === 'closed' ? 'Ticket is closed. Reopen it to reply.' : 'Write a reply… (Ctrl/⌘ + Enter to send)'}
                    disabled={selected.status === 'closed'}
                    className="flex-1 field border border-gray-700 focus:border-blue-500 rounded-2xl px-4 py-3 text-sm text-white outline-none resize-none disabled:opacity-50"
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !reply.trim() || selected.status === 'closed'}
                    className="btn-gradient h-12 px-5 rounded-2xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
