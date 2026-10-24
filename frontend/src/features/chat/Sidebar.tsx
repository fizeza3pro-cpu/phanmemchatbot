import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import useSWRInfinite from 'swr/infinite';
import { ArrowUpRight, ChevronDown, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../auth';
import type { Conversation, Page } from '../../lib/types';
import { stateName } from '../../lib/format';
import { Empty, ErrorNotice, Spinner } from '../../components/ui';

export default function Sidebar({
  onNew,
  onClose,
  open,
  creating,
  revision,
}: {
  onNew: () => void;
  onClose: () => void;
  open: boolean;
  creating: boolean;
  revision: number;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !matchMedia('(max-width: 800px)').matches) return;
    const previous = document.activeElement as HTMLElement | null;
    const main = document.getElementById('chat-main');
    if (main) main.inert = true;
    const focusables = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input'
        ) ?? []
      );
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = focusables();
        if (event.shiftKey && document.activeElement === elements[0]) {
          event.preventDefault();
          elements.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === elements.at(-1)
        ) {
          event.preventDefault();
          elements[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if (main) main.inert = false;
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose]);
  useEffect(() => {
    const id = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(id);
  }, [search]);
  const { data, error, isLoading, isValidating, size, setSize, mutate } =
    useSWRInfinite<Page<Conversation>>(
      (index, previous) => {
        if (previous && previous.next_offset === null) return null;
        return `/api/conversations?limit=30&offset=${index === 0 ? 0 : previous!.next_offset}&search=${encodeURIComponent(query)}`;
      },
      { revalidateFirstPage: true, refreshInterval: 30_000 }
    );
  useEffect(() => {
    if (revision > 0) void mutate();
  }, [revision, mutate]);
  const items = data?.flatMap((page) => page.items) ?? [];
  const today = new Date().setHours(0, 0, 0, 0);
  const groups = [
    {
      label: 'Hôm nay',
      items: items.filter(
        (c) => c.status !== 'archived' && c.updated_at >= today
      ),
    },
    {
      label: 'Trước đó',
      items: items.filter(
        (c) => c.status !== 'archived' && c.updated_at < today
      ),
    },
    {
      label: 'Đã lưu trữ',
      items: items.filter((c) => c.status === 'archived'),
    },
  ];
  return (
    <aside
      ref={sidebarRef}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? true : undefined}
      className={`sidebar ${open ? 'is-open' : ''}`}
      aria-label="Lịch sử trò chuyện"
    >
      <div className="sidebar-top">
        <Link to="/chat" className="brand-link" onClick={onClose}>
          <strong className="reference-brand">
            PIPILABU <span>clb</span>
          </strong>
        </Link>
        <button
          className="icon-button mobile-only"
          aria-label="Đóng lịch sử"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <button className="button new-chat" disabled={creating} onClick={onNew}>
        <span aria-hidden="true">+</span>
        {creating ? 'Đang tạo phiên…' : 'Cuộc trò chuyện mới'}
      </button>
      <label className="search-box">
        <input
          aria-label="Tìm cuộc trò chuyện"
          placeholder="Tìm cuộc trò chuyện..."
          maxLength={120}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="history-scroll">
        {isLoading && <Spinner />}
        {!!error && (
          <ErrorNotice error={error} retry={() => void mutate()} />
        )}{' '}
        {!isLoading && !error && !items.length && (
          <Empty
            title={
              query ? 'Chưa tìm thấy phiên phù hợp' : 'Ý tưởng của bạn sẽ ở đây'
            }
            description={
              query
                ? 'Thử một từ khóa khác.'
                : 'Bắt đầu cuộc trò chuyện đầu tiên.'
            }
          />
        )}{' '}
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <section className="history-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.items.map((c) => (
                  <NavLink
                    key={c.id}
                    className={({ isActive }) =>
                      `history-item ${isActive ? 'selected' : ''}`
                    }
                    to={`/chat/${c.id}`}
                    onClick={onClose}
                    title={`${c.title} — ${stateName(c.status)}`}
                  >
                    <span>{c.title}</span>
                    {['limit_reached', 'usage_pending'].includes(c.status) && (
                      <span
                        className={`history-indicator ${c.status}`}
                        aria-label={stateName(c.status)}
                      />
                    )}
                  </NavLink>
                ))}
              </section>
            )
        )}
        {data?.at(-1)?.next_offset != null && (
          <button
            className="text-button history-more"
            disabled={isValidating}
            onClick={() => void setSize(size + 1)}
          >
            <ChevronDown size={15} />
            Tải thêm phiên
          </button>
        )}
      </div>
      <div className="sidebar-bottom">
        {user.role === 'admin' && (
          <Link to="/admin" className="admin-link" onClick={onClose}>
            <ShieldCheck size={18} />
            Quản trị
            <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
    </aside>
  );
}
