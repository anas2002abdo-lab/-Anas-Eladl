import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Headphones,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  User,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { Language, SupportMessageRecord, SupportTicketRecord } from '../shared/types.ts';

interface Props {
  lang: Language;
  onNotify: (msg: string) => void;
  onRefreshCore?: () => Promise<void>;
}

export const SupportCenterSection: React.FC<Props> = ({ lang, onNotify, onRefreshCore }) => {
  const isAr = lang === 'ar';
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessageRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [replyText, setReplyText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);

  const loadTickets = async (keepSelection = true) => {
    setLoading(true);
    try {
      const list = await api.getSupportTickets(
        statusFilter !== 'all' ? { status: statusFilter } : undefined
      );
      setTickets(list);
      if (list.length > 0) {
        const nextId =
          keepSelection && selectedTicketId && list.some((t) => t.id === selectedTicketId)
            ? selectedTicketId
            : list[0].id;
        setSelectedTicketId(nextId);
      } else {
        setSelectedTicketId(null);
        setMessages([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (ticketId: string) => {
    try {
      const data = await api.getSupportMessages(ticketId);
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    }
  };

  useEffect(() => {
    loadTickets(false);
  }, [statusFilter]);

  useEffect(() => {
    if (selectedTicketId) {
      loadMessages(selectedTicketId);
    }
  }, [selectedTicketId]);

  const filteredTickets = tickets.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      t.customer_name.toLowerCase().includes(q) ||
      t.ticket_number.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      (t.customer_phone || '').toLowerCase().includes(q)
    );
  });

  const activeTicket = tickets.find((t) => t.id === selectedTicketId) || null;

  const statusLabel = (s: SupportTicketRecord['status']) => {
    if (s === 'open') return isAr ? 'جديد / مفتوح' : 'Open';
    if (s === 'in_progress') return isAr ? 'قيد المتابعة' : 'In Progress';
    if (s === 'resolved') return isAr ? 'تم الحل' : 'Resolved';
    return isAr ? 'مغلق' : 'Closed';
  };

  const statusBadgeClass = (s: SupportTicketRecord['status']) => {
    if (s === 'open') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (s === 'in_progress') return 'bg-amber-100 text-amber-800 border-amber-200';
    if (s === 'resolved') return 'bg-teal-100 text-teal-800 border-teal-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !replyText.trim() || sending) return;
    setSending(true);
    try {
      await api.sendSupportMessage(activeTicket.id, {
        sender_role: 'admin',
        sender_name: isAr ? 'إدارة اطلبها' : 'Otlobha Admin',
        message_text: replyText.trim(),
      });
      setReplyText('');
      await Promise.all([loadMessages(activeTicket.id), loadTickets(true)]);
      if (onRefreshCore) await onRefreshCore();
      onNotify(
        isAr
          ? `تم إرسال رد الإدارة للعميل ${activeTicket.customer_name} وإشعاره فورًا`
          : `Reply sent to ${activeTicket.customer_name}`
      );
    } catch (err) {
      onNotify((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (nextStatus: SupportTicketRecord['status']) => {
    if (!activeTicket) return;
    try {
      await api.updateSupportTicketStatus(activeTicket.id, nextStatus);
      await loadTickets(true);
      if (onRefreshCore) await onRefreshCore();
      onNotify(isAr ? `تم تحديث حالة التذكرة إلى: ${statusLabel(nextStatus)}` : 'Ticket status updated');
    } catch (err) {
      onNotify((err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-red-50 border border-red-200 text-[#A92224] flex items-center justify-center shrink-0">
            <Headphones className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {isAr ? 'مركز التواصل مع العملاء والإدارة والدعم الفني' : 'Customer & Admin Support Center'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAr
                ? 'استقبال رسائل واستفسارات العملاء من القائمة الجانبية للتطبيق والرد عليها مباشرة مع إرسال إشعار فوري للعميل.'
                : 'Live inbox for customer inquiries and direct admin responses.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => loadTickets(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{isAr ? 'تحديث الرسائل' : 'Refresh'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Ticket List */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'ابحث باسم العميل، رقم التذكرة، أو الموضوع...' : 'Search tickets...'}
              className="w-full ps-9 pe-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'all', label: isAr ? 'الكل' : 'All' },
              { id: 'open', label: isAr ? 'مفتوحة' : 'Open' },
              { id: 'in_progress', label: isAr ? 'قيد المتابعة' : 'In Progress' },
              { id: 'resolved', label: isAr ? 'تم الحل' : 'Resolved' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === f.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
            {filteredTickets.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">
                {isAr ? 'لا توجد رسائل دعم مطابقة حاليًا' : 'No matching support tickets'}
              </p>
            ) : (
              filteredTickets.map((t) => {
                const selected = t.id === selectedTicketId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTicketId(t.id)}
                    className={`w-full text-start p-3 rounded-lg transition-colors my-1 ${
                      selected ? 'bg-orange-50 border border-orange-200' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        <span>{t.customer_name}</span>
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass(t.status)}`}>
                        {statusLabel(t.status)}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 mt-1 line-clamp-1">{t.subject}</p>
                    {t.last_message_text && (
                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{t.last_message_text}</p>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 font-mono-num">
                      <span>{t.ticket_number}</span>
                      <span>{t.messages_count ?? 0} {isAr ? 'رسائل' : 'msgs'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Active Conversation Pane */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col min-h-[520px]">
          {!activeTicket ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
              <MessageSquare className="w-8 h-8" />
              <p>{isAr ? 'اختر محادثة من القائمة لعرض التفاصيل والرد على العميل' : 'Select a ticket to view messages'}</p>
            </div>
          ) : (
            <>
              <div className="pb-3 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-num text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {activeTicket.ticket_number}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900">{activeTicket.subject}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {isAr ? 'العميل:' : 'Customer:'} <strong className="text-slate-800">{activeTicket.customer_name}</strong>
                    {activeTicket.customer_phone && (
                      <span dir="ltr" className="mx-2 font-mono-num">· {activeTicket.customer_phone}</span>
                    )}
                    {activeTicket.customer_email && (
                      <span dir="ltr" className="font-mono-num">· {activeTicket.customer_email}</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(['open', 'in_progress', 'resolved', 'closed'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleStatusChange(st)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                        activeTicket.status === st
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {statusLabel(st)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 py-4 space-y-3 overflow-y-auto max-h-[380px]">
                {messages.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">
                    {isAr ? 'لا توجد رسائل في هذه التذكرة بعد' : 'No messages yet'}
                  </p>
                ) : (
                  messages.map((m) => {
                    const isAdmin = m.sender_role === 'admin';
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isAdmin ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs space-y-1 ${
                            isAdmin
                              ? 'bg-slate-900 text-white'
                              : 'bg-orange-50 border border-orange-200 text-slate-900'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3 text-[10px] opacity-75">
                            <span className="font-bold">
                              {m.sender_name} ({isAdmin ? (isAr ? 'الإدارة' : 'Admin') : (isAr ? 'العميل' : 'Customer')})
                            </span>
                            <span className="font-mono-num">{m.created_at}</span>
                          </div>
                          <p className="leading-relaxed whitespace-pre-wrap">{m.message_text}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleSendReply} className="pt-3 border-t border-slate-100 flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={isAr ? 'اكتب رد الإدارة للعميل...' : 'Write admin reply...'}
                  className="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-orange-500"
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isAr ? 'إرسال الرد' : 'Send Reply'}</span>
                </button>
              </form>

              {activeTicket.status === 'resolved' && (
                <p className="mt-2 text-[11px] text-teal-700 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isAr ? 'تم تعليم هذه التذكرة كمحلولة.' : 'Marked as resolved.'}</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
