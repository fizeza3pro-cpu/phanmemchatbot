import { useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  SUPPORTED_MODELS,
  MODEL_PROVIDERS,
  PROVIDER_NAMES,
  type ProviderId,
} from '../../../../backend/shared/models';
import type {
  AdminRequest,
  AuditLog,
  Page,
  Settings,
  SettingsInput,
  Stats,
  User,
} from '../../lib/types';
import { api, patch, post } from '../../lib/api';
import {
  formatDate,
  formatNumber,
  initials,
  modelName,
} from '../../lib/format';
import {
  Brand,
  Dialog,
  Empty,
  ErrorNotice,
  Spinner,
  useToast,
} from '../../components/ui';
import { useAuth } from '../auth';
import { ThemeToggle } from '../theme';

export default function AdminPage() {
  const { user } = useAuth();
  const { data, error, mutate } = useSWR<Stats>(
    user.role === 'admin' ? '/api/admin/stats' : null,
    { refreshInterval: 30_000 }
  );
  if (user.role !== 'admin') return <Navigate to="/chat" replace />;
  return (
    <div className="admin-shell">
      <header className="admin-header">
        <Link to="/chat" className="brand-link">
          <Brand />
        </Link>
        <span className="admin-header-label">
          <ShieldCheck size={18} />
          Quản trị không gian
        </span>
        <ThemeToggle />
        <Link className="button secondary" to="/chat">
          <ArrowLeft size={16} />
          <span>Về trò chuyện</span>
        </Link>
      </header>
      <main className="admin-main">
        <div className="admin-intro">
          <div>
            <h1>Mọi thứ trong tầm nhìn.</h1>
            <p>Quản lý hạn mức, tài khoản và hoạt động của chatbot.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Làm mới thống kê"
            onClick={() => void mutate()}
          >
            <RefreshCw size={19} />
          </button>
        </div>
        {!!error && <ErrorNotice error={error} retry={() => void mutate()} />}
        <div className="stats-strip" aria-label="Thống kê sử dụng">
          <div>
            <span>Tài khoản hoạt động</span>
            <strong>{data ? formatNumber(data.users.active) : '—'}</strong>
            <small>{formatNumber(data?.users.total)} tài khoản</small>
          </div>
          <div>
            <span>Cuộc trò chuyện</span>
            <strong>
              {data ? formatNumber(data.conversations.total) : '—'}
            </strong>
            <small>
              {formatNumber(data?.conversations.locked)} phiên đã khóa
            </small>
          </div>
          <div>
            <span>Token đã sử dụng</span>
            <strong>
              {data ? formatNumber(data.tokens.total_tokens) : '—'}
            </strong>
            <small>Đầu vào + đầu ra đã quyết toán</small>
          </div>
          <div>
            <span>Lượt cần xác nhận</span>
            <strong
              className={
                data?.conversations.usage_pending ? 'warning-text' : ''
              }
            >
              {data ? formatNumber(data.conversations.usage_pending) : '—'}
            </strong>
            <small>
              {formatNumber(data?.requests.completed)} lượt hoàn tất
            </small>
          </div>
        </div>
        <nav className="admin-nav" aria-label="Trang quản trị">
          <NavLink end to="/admin">
            <Settings2 size={17} />
            Cấu hình
          </NavLink>
          <NavLink to="/admin/users">
            <Users size={17} />
            Tài khoản
          </NavLink>
          <NavLink to="/admin/requests">
            <Activity size={17} />
            Lượt gọi AI
          </NavLink>
          <NavLink to="/admin/audit">
            <ClipboardList size={17} />
            Nhật ký thay đổi
          </NavLink>
        </nav>
        <Routes>
          <Route index element={<SettingsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="requests" element={<RequestsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
      <footer className="admin-footer">
        PIPILABU <span>Thay đổi quản trị được lưu trong nhật ký.</span>
      </footer>
    </div>
  );
}
function SettingsPage() {
  const { data, error, mutate, isLoading } = useSWR<Settings>(
    '/api/admin/settings'
  );
  if (error) return <ErrorNotice error={error} retry={() => void mutate()} />;
  if (isLoading || !data) return <Spinner label="Đang tải cấu hình" />;
  return (
    <SettingsForm key={data.version} settings={data} onSaved={() => mutate()} />
  );
}
function SettingsForm({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => Promise<unknown>;
}) {
  const {
    version: _version,
    created_at: _createdAt,
    updated_by: _updatedBy,
    ...initial
  } = settings;
  const [values, setValues] = useState<SettingsInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [limitId, setLimitId] = useState('');
  const [limitValue, setLimitValue] = useState(2000);
  const [limitBusy, setLimitBusy] = useState(false);
  const [limitError, setLimitError] = useState<unknown>(null);
  const notify = useToast();
  const { mutate } = useSWRConfig();
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const setNumber = (name: keyof SettingsInput, value: string) =>
    setValues((v) => ({ ...v, [name]: Number(value) }));
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(values),
      });
      notify('Đã lưu cấu hình cho các phiên mới');
      await Promise.all([
        onSaved(),
        mutate('/api/admin/stats'),
        mutate('/api/chat/config'),
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function changeLimit(event: FormEvent) {
    event.preventDefault();
    setLimitBusy(true);
    setLimitError(null);
    try {
      await patch(
        `/api/admin/conversations/${encodeURIComponent(limitId.trim())}/limit`,
        { token_limit: limitValue }
      );
      notify('Đã đổi hạn mức phiên');
      await mutate('/api/admin/stats');
    } catch (e) {
      setLimitError(e);
    } finally {
      setLimitBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <form onSubmit={save} className="settings-form">
        <div className="section-heading">
          <div>
            <h2>Cấu hình chatbot</h2>
            <p>
              Áp dụng cho phiên mới. Các phiên hiện có giữ nguyên hạn mức và
              model.
            </p>
          </div>
          <span className="version-tag">Phiên bản {settings.version}</span>
        </div>
        <fieldset disabled={busy}>
          <section className="settings-section">
            <div>
              <h3>Ngân sách mỗi phiên</h3>
              <p>Quyết định độ dài cuộc trò chuyện.</p>
            </div>
            <div className="settings-fields">
              <label className="field">
                <span>Giới hạn token mặc định</span>
                <div className="input-unit">
                  <input
                    name="default_token_limit"
                    required
                    type="number"
                    min={1}
                    max={1000000}
                    value={values.default_token_limit}
                    onChange={(e) =>
                      setNumber('default_token_limit', e.target.value)
                    }
                  />
                  <span>token / phiên</span>
                </div>
                <small>
                  Đầu vào và đầu ra được cộng dồn. Không trả lời nếu lượt chat
                  không đủ ngân sách.
                </small>
              </label>
              <label className="field">
                <span>Tối đa cho một câu trả lời</span>
                <div className="input-unit">
                  <input
                    required
                    type="number"
                    min={1}
                    max={4096}
                    value={values.max_output_tokens}
                    onChange={(e) =>
                      setNumber('max_output_tokens', e.target.value)
                    }
                  />
                  <span>token</span>
                </div>
              </label>
              <label className="field">
                <span>Độ dài câu hỏi tối đa</span>
                <div className="input-unit">
                  <input
                    required
                    type="number"
                    min={1}
                    max={65536}
                    value={values.max_input_bytes}
                    onChange={(e) =>
                      setNumber('max_input_bytes', e.target.value)
                    }
                  />
                  <span>byte UTF-8</span>
                </div>
                <small>
                  Tiếng Việt và emoji có thể dùng nhiều byte cho một ký tự.
                </small>
              </label>
            </div>
          </section>
          <section className="settings-section">
            <div>
              <h3>Model và cách trả lời</h3>
              <p>Chọn AI phù hợp với công việc.</p>
            </div>
            <div className="settings-fields">
              <label className="field">
                <span>Dịch vụ AI</span>
                <select
                  value={MODEL_PROVIDERS[values.default_model]}
                  onChange={(event) => {
                    const provider = event.target.value as ProviderId;
                    const model = SUPPORTED_MODELS.find(
                      (item) => MODEL_PROVIDERS[item] === provider
                    )!;
                    setValues((v) => ({
                      ...v,
                      default_model: model,
                      model_allowlist: v.model_allowlist.includes(model)
                        ? v.model_allowlist
                        : [...v.model_allowlist, model],
                    }));
                  }}
                >
                  <option value="cloudflare">Cloudflare Workers AI</option>
                  <option value="groq">Groq · GPT‑OSS</option>
                  <option value="byteplus">BytePlus ModelArk</option>
                </select>
              </label>
              <label className="field">
                <span>Model mặc định</span>
                <select
                  value={values.default_model}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      default_model: e.target
                        .value as SettingsInput['default_model'],
                    }))
                  }
                >
                  {values.model_allowlist
                    .filter(
                      (model) =>
                        MODEL_PROVIDERS[model] ===
                        MODEL_PROVIDERS[values.default_model]
                    )
                    .map((model) => (
                      <option key={model} value={model}>
                        {modelName(model)}
                      </option>
                    ))}
                </select>
              </label>
              <div className="field">
                <span>Model được phép sử dụng</span>
                {SUPPORTED_MODELS.map((model) => (
                  <label className="checkbox-field" key={model}>
                    <input
                      type="checkbox"
                      checked={values.model_allowlist.includes(model)}
                      disabled={model === values.default_model}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          model_allowlist: e.target.checked
                            ? [...v.model_allowlist, model]
                            : v.model_allowlist.filter((m) => m !== model),
                        }))
                      }
                    />
                    {PROVIDER_NAMES[MODEL_PROVIDERS[model]]} ·{' '}
                    {modelName(model)}
                    {model === values.default_model && <small>Mặc định</small>}
                  </label>
                ))}
              </div>
              <label className="field">
                <span>Hướng dẫn cho chatbot</span>
                <textarea
                  required
                  rows={5}
                  maxLength={4000}
                  value={values.system_prompt}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, system_prompt: e.target.value }))
                  }
                />
                <small>
                  Quy định ngôn ngữ, giọng điệu và cách AI hỗ trợ người dùng.
                </small>
              </label>
            </div>
          </section>
          <section className="settings-section">
            <div>
              <h3>Tần suất sử dụng</h3>
              <p>Kiểm soát số lượt gửi liên tiếp.</p>
            </div>
            <div className="settings-fields two-fields">
              <label className="field">
                <span>Tin nhắn / phút / tài khoản</span>
                <input
                  required
                  type="number"
                  min={1}
                  max={120}
                  value={values.message_rate_per_minute}
                  onChange={(e) =>
                    setNumber('message_rate_per_minute', e.target.value)
                  }
                />
              </label>
              <label className="field">
                <span>Phiên mới / giờ / tài khoản</span>
                <input
                  required
                  type="number"
                  min={1}
                  max={1000}
                  value={values.conversation_rate_per_hour}
                  onChange={(e) =>
                    setNumber('conversation_rate_per_hour', e.target.value)
                  }
                />
              </label>
            </div>
          </section>
        </fieldset>
        {!!error && <ErrorNotice error={error} />}
        <div className="settings-save">
          <span>
            {dirty
              ? 'Có thay đổi chưa lưu'
              : `Cập nhật ${formatDate(settings.created_at)}`}
          </span>
          <button className="button" disabled={busy || !dirty}>
            <Check size={17} />
            {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
          </button>
        </div>
      </form>
      <aside className="settings-aside">
        <div className="settings-note">
          <ShieldCheck size={24} />
          <h3>Hạn mức được giữ tại máy chủ</h3>
          <p>
            Người dùng không thể tự bỏ qua giới hạn bằng cách sửa giao diện.
            Phiên đã khóa cần tạo mới để tiếp tục.
          </p>
          <p>
            Hạn mức tính theo từng phiên, chưa bao gồm hạn mức tổng tài khoản
            hoặc theo ngày.
          </p>
        </div>
        <form className="limit-form" onSubmit={changeLimit}>
          <h3>Đổi hạn mức một phiên</h3>
          <p>Chỉ áp dụng cho phiên đang hoạt động và chưa có lượt xử lý.</p>
          <label className="field">
            <span>ID phiên</span>
            <input
              required
              value={limitId}
              placeholder="Dán ID phiên cần thay đổi"
              onChange={(e) => setLimitId(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Hạn mức mới</span>
            <input
              type="number"
              required
              min={1}
              max={1000000}
              value={limitValue}
              onChange={(e) => setLimitValue(Number(e.target.value))}
            />
          </label>
          <small>
            Giảm xuống bằng hoặc thấp hơn mức đã dùng sẽ khóa phiên.
          </small>
          {!!limitError && <ErrorNotice error={limitError} />}
          <button className="button secondary full-width" disabled={limitBusy}>
            {limitBusy ? 'Đang lưu…' : 'Đổi hạn mức phiên'}
          </button>
        </form>
      </aside>
    </div>
  );
}
function Pagination({
  offset,
  next,
  onChange,
}: {
  offset: number;
  next: number | null | undefined;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pagination">
      <span>Trang {Math.floor(offset / 20) + 1}</span>
      <button
        className="icon-button"
        aria-label="Trang trước"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - 20))}
      >
        <ChevronLeft size={18} />
      </button>
      <button
        className="icon-button"
        aria-label="Trang tiếp"
        disabled={next == null}
        onClick={() => onChange(next!)}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
function UsersPage() {
  const { user: currentUser, refresh } = useAuth();
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading, mutate } = useSWR<Page<User>>(
    `/api/admin/users?limit=20&offset=${offset}`
  );
  const [editing, setEditing] = useState<User | null>(null);
  const [role, setRole] = useState<User['role']>('user');
  const [status, setStatus] = useState<User['status']>('active');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const notify = useToast();
  const { mutate: mutateCache } = useSWRConfig();
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      await patch(`/api/admin/users/${editing.id}`, { role, status });
      setEditing(null);
      notify('Đã cập nhật tài khoản');
      if (editing.id === currentUser.id) await refresh();
      else await Promise.all([mutate(), mutateCache('/api/admin/stats')]);
    } catch (e) {
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="admin-section">
      <div className="section-heading">
        <div>
          <h2>Tài khoản</h2>
          <p>Cấp quyền quản trị hoặc tạm khóa quyền truy cập.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Làm mới tài khoản"
          onClick={() => void mutate()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {!!error && <ErrorNotice error={error} retry={() => void mutate()} />}{' '}
      {isLoading && <Spinner />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tài khoản</th>
              <th>Quyền</th>
              <th>Trạng thái</th>
              <th>Ngày tạo</th>
              <th>
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((user) => (
              <tr key={user.id}>
                <td>
                  <div className="table-user">
                    <span className="avatar">
                      {initials(user.display_name)}
                    </span>
                    <div>
                      <strong>
                        {user.display_name}
                        {user.id === currentUser.id && <small> (bạn)</small>}
                      </strong>
                      <span>{user.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  {user.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}
                </td>
                <td>
                  <span
                    className={`badge ${user.status === 'active' ? 'success' : 'warning'}`}
                  >
                    {user.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                  </span>
                </td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(user);
                      setRole(user.role);
                      setStatus(user.status);
                      setSaveError(null);
                    }}
                  >
                    Chỉnh sửa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && !error && !data?.items.length && (
        <Empty title="Chưa có tài khoản" />
      )}
      <Pagination
        offset={offset}
        next={data?.next_offset}
        onChange={setOffset}
      />
      {editing && (
        <Dialog
          title="Chỉnh sửa tài khoản"
          onClose={() => {
            if (!saving) setEditing(null);
          }}
        >
          <form onSubmit={save}>
            <p className="dialog-description">{editing.email}</p>
            <label className="field">
              <span>Quyền truy cập</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as User['role'])}
              >
                <option value="user">Người dùng</option>
                <option value="admin">Quản trị viên</option>
              </select>
            </label>
            <label className="field">
              <span>Trạng thái</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as User['status'])}
              >
                <option value="active">Hoạt động</option>
                <option value="blocked">Đã khóa</option>
              </select>
              <small>
                Khóa tài khoản sẽ thu hồi các phiên đăng nhập. Luôn cần ít nhất
                một quản trị viên hoạt động.
              </small>
            </label>
            {!!saveError && <ErrorNotice error={saveError} />}
            <div className="dialog-actions">
              <button
                className="button secondary"
                type="button"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                Hủy
              </button>
              <button className="button" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
const requestLabels: Record<string, string> = {
  processing: 'Đang xử lý',
  completed: 'Hoàn tất',
  rejected: 'Từ chối',
  failed: 'Lỗi',
  usage_pending: 'Chờ xác nhận',
  suppressed: 'Không trả nội dung',
};
function RequestsPage() {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const { data, error, isLoading, mutate } = useSWR<Page<AdminRequest>>(
    `/api/admin/requests?limit=20&offset=${offset}${status ? `&status=${status}` : ''}`,
    { refreshInterval: 15_000 }
  );
  const [selected, setSelected] = useState<AdminRequest | null>(null);
  const [input, setInput] = useState(0);
  const [output, setOutput] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const notify = useToast();
  const { mutate: mutateCache } = useSWRConfig();
  async function reconcile(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      await post(`/api/admin/requests/${selected.id}/reconcile`, {
        input_tokens: input,
        output_tokens: output,
        note: note.trim(),
      });
      setSelected(null);
      notify('Đã đối soát token. Phiên cũ được đóng.');
      await Promise.all([mutate(), mutateCache('/api/admin/stats')]);
    } catch (e) {
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="admin-section">
      <div className="section-heading">
        <div>
          <h2>Lượt gọi AI</h2>
          <p>Theo dõi usage và đối soát các lượt chưa có số token xác nhận.</p>
        </div>
        <label className="filter-select">
          <span className="sr-only">Lọc trạng thái lượt gọi</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(requestLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!!error && <ErrorNotice error={error} retry={() => void mutate()} />}{' '}
      {isLoading && <Spinner />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Lượt gọi</th>
              <th>Trạng thái</th>
              <th>Input / output</th>
              <th>Tổng token</th>
              <th>
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((request) => (
              <tr key={request.id}>
                <td>{formatDate(request.started_at)}</td>
                <td>
                  <span className="short-id">{request.id.slice(0, 8)}</span>
                  {request.error_code && (
                    <small className="cell-detail">{request.error_code}</small>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${request.status === 'completed' ? 'success' : ['failed', 'suppressed', 'usage_pending'].includes(request.status) ? 'warning' : ''}`}
                  >
                    {requestLabels[request.status]}
                  </span>
                </td>
                <td>
                  {request.input_tokens == null
                    ? '—'
                    : `${formatNumber(request.input_tokens)} / ${formatNumber(request.output_tokens)}`}
                </td>
                <td>
                  {request.total_tokens == null
                    ? '—'
                    : formatNumber(request.total_tokens)}
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(request);
                      setInput(0);
                      setOutput(0);
                      setNote('');
                      setSaveError(null);
                    }}
                  >
                    {request.status === 'usage_pending'
                      ? 'Đối soát'
                      : 'Chi tiết'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && !error && !data?.items.length && (
        <Empty
          title="Chưa có lượt gọi phù hợp"
          description="Các lượt gửi tin nhắn sẽ xuất hiện tại đây."
        />
      )}
      <Pagination
        offset={offset}
        next={data?.next_offset}
        onChange={setOffset}
      />
      {selected && (
        <Dialog
          title={
            selected.status === 'usage_pending'
              ? 'Đối soát token'
              : 'Chi tiết lượt gọi'
          }
          onClose={() => {
            if (!saving) setSelected(null);
          }}
        >
          <dl className="request-detail">
            <div>
              <dt>ID lượt gọi</dt>
              <dd>{selected.id}</dd>
            </div>
            <div>
              <dt>ID phiên</dt>
              <dd>{selected.conversation_id}</dd>
            </div>
            <div>
              <dt>ID từ nhà cung cấp</dt>
              <dd>{selected.provider_request_id ?? 'Chưa có'}</dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>{requestLabels[selected.status]}</dd>
            </div>
            <div>
              <dt>Mã lỗi</dt>
              <dd>{selected.error_code ?? 'Không có'}</dd>
            </div>
          </dl>
          {selected.status === 'usage_pending' ? (
            <form onSubmit={reconcile}>
              <div className="notice warning">
                Chỉ nhập usage đã đối chiếu từ nhà cung cấp. Đối soát sẽ đóng
                phiên cũ và không hiển thị câu trả lời bị giữ lại.
              </div>
              <div className="two-fields">
                <label className="field">
                  <span>Token đầu vào</span>
                  <input
                    required
                    type="number"
                    min={0}
                    max={1000000}
                    value={input}
                    onChange={(e) => setInput(Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Token đầu ra</span>
                  <input
                    required
                    type="number"
                    min={0}
                    max={1000000}
                    value={output}
                    onChange={(e) => setOutput(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="field">
                <span>Nguồn đối chiếu và ghi chú</span>
                <textarea
                  required
                  minLength={10}
                  maxLength={1000}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi nguồn usage đã xác minh và lý do đối soát"
                />
              </label>
              {!!saveError && <ErrorNotice error={saveError} />}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={saving}
                  onClick={() => setSelected(null)}
                >
                  Hủy
                </button>
                <button
                  className="button"
                  disabled={saving || note.trim().length < 10}
                >
                  {saving ? 'Đang lưu…' : 'Xác nhận đối soát'}
                </button>
              </div>
            </form>
          ) : (
            <div className="dialog-actions">
              <a
                className="button secondary"
                href="https://dash.cloudflare.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Cloudflare Dashboard
                <ExternalLink size={15} />
              </a>
              <button className="button" onClick={() => setSelected(null)}>
                Đóng
              </button>
            </div>
          )}
        </Dialog>
      )}
    </section>
  );
}
const actionNames: Record<string, string> = {
  'settings.updated': 'Cập nhật cấu hình',
  'user.updated': 'Cập nhật tài khoản',
  'conversation.limit_updated': 'Đổi hạn mức phiên',
  'request.reconciled': 'Đối soát token',
  'request.reconciliation': 'Đối soát token',
};
function AuditPage() {
  const [offset, setOffset] = useState(0);
  const { data, error, isLoading, mutate } = useSWR<Page<AuditLog>>(
    `/api/admin/audit-logs?limit=20&offset=${offset}`
  );
  const [selected, setSelected] = useState<AuditLog | null>(null);
  function metadata(value: string) {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return (
    <section className="admin-section">
      <div className="section-heading">
        <div>
          <h2>Nhật ký thay đổi</h2>
          <p>Lịch sử các thao tác quản trị, không chứa nội dung trò chuyện.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Làm mới nhật ký"
          onClick={() => void mutate()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {!!error && <ErrorNotice error={error} retry={() => void mutate()} />}{' '}
      {isLoading && <Spinner />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Thao tác</th>
              <th>Người thực hiện</th>
              <th>Đối tượng</th>
              <th>
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((log) => (
              <tr key={log.id}>
                <td>{formatDate(log.created_at)}</td>
                <td>{actionNames[log.action] ?? log.action}</td>
                <td>
                  <span title={log.actor_id}>{log.actor_id.slice(0, 8)}</span>
                </td>
                <td>
                  <span title={log.target_id}>
                    {log.target_id.slice(0, 12)}
                  </span>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => setSelected(log)}
                  >
                    Chi tiết
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && !error && !data?.items.length && (
        <Empty title="Chưa có thay đổi quản trị" />
      )}
      <Pagination
        offset={offset}
        next={data?.next_offset}
        onChange={setOffset}
      />
      {selected && (
        <Dialog
          title={actionNames[selected.action] ?? selected.action}
          onClose={() => setSelected(null)}
        >
          <dl className="request-detail">
            <div>
              <dt>Thời gian</dt>
              <dd>{formatDate(selected.created_at)}</dd>
            </div>
            <div>
              <dt>Người thực hiện</dt>
              <dd>{selected.actor_id}</dd>
            </div>
            <div>
              <dt>Đối tượng</dt>
              <dd>{selected.target_id}</dd>
            </div>
          </dl>
          <pre className="audit-metadata">{metadata(selected.metadata)}</pre>
          <div className="dialog-actions">
            <button className="button" onClick={() => setSelected(null)}>
              Đóng
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
