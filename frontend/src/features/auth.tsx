import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import {
  ArrowUpRight,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import { api, ApiError, errorMessage, post } from '../lib/api';
import type { User } from '../lib/types';
import { Brand, ErrorNotice, Spinner } from '../components/ui';
import { ThemeToggle } from './theme';

const AuthContext = createContext<{
  user: User;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
} | null>(null);
const accountCache = { provider: () => new Map() };
export const useAuth = () => {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('Thiếu phiên đăng nhập.');
  return auth;
};
export function AuthProvider({ children }: { children: ReactNode }) {
  const { mutate: mutateCache } = useSWRConfig();
  const {
    data: user,
    error,
    isLoading,
    mutate,
  } = useSWR<User | null, ApiError>(
    '/api/me',
    async () => {
      try {
        return await api<User>('/api/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    { shouldRetryOnError: false, refreshInterval: 60_000 }
  );
  useEffect(() => {
    const expire = () => {
      void mutate(null, false);
      void mutateCache((key) => key !== '/api/me', undefined, {
        revalidate: false,
      });
    };
    window.addEventListener('auth-expired', expire);
    return () => window.removeEventListener('auth-expired', expire);
  }, [mutate, mutateCache]);
  const logout = async () => {
    await post('/api/auth/logout', {});
    try {
      sessionStorage.removeItem('mach:pending:v1');
    } catch {
      /* Storage may be disabled by the browser. */
    }
    await mutateCache(() => true, undefined, { revalidate: false });
    await mutate(null, false);
  };
  if (isLoading)
    return (
      <div className="fullscreen-loading">
        <Brand />
        <Spinner label="Đang mở không gian trò chuyện" />
      </div>
    );
  if (error)
    return (
      <div className="fullscreen-loading">
        <Brand />
        <ErrorNotice error={error} retry={() => void mutate()} />
        {error.code === 'ACCOUNT_BLOCKED' && (
          <button
            className="button secondary"
            onClick={() => void logout().catch(() => mutate())}
          >
            Đăng xuất
          </button>
        )}
      </div>
    );
  if (!user)
    return (
      <Login
        onSuccess={async () => {
          await mutateCache(() => true, undefined, { revalidate: false });
          await mutate();
        }}
      />
    );
  return (
    <AuthContext.Provider value={{ user, logout, refresh: mutate }}>
      <SWRConfig key={user.id} value={accountCache}>
        {children}
      </SWRConfig>
    </AuthContext.Provider>
  );
}
function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [email, setEmail] = useState('admin@example.test');
  const isLocal =
    import.meta.env.DEV &&
    ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  async function googleLogin() {
    setBusy(true);
    setError(null);
    // Fetch once to keep configuration failures inside the login interface.
    try {
      const response = await fetch('/api/auth/google', { redirect: 'manual' });
      if (response.type === 'opaqueredirect' || response.status < 400) {
        location.assign('/api/auth/google');
        return;
      }
      const body = await response.json();
      throw new ApiError(
        response.status,
        body.error?.code ?? 'AUTH_ERROR',
        body.error?.message ?? 'Không thể đăng nhập Google.'
      );
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  async function devLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/dev', {
        email: email.trim(),
        display_name: email.startsWith('admin')
          ? 'Quản trị viên'
          : 'Người dùng thử',
      });
      history.replaceState(null, '', '/chat');
      await onSuccess();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-intro">
          <div className="conversation-art" aria-hidden="true">
            <div className="art-bubble">
              <span />
              <span />
              <span />
            </div>
            <div className="art-reply">
              <MessageCircle size={32} />
              <span />
            </div>
            <svg viewBox="0 0 300 90">
              <path d="M70 0v30q0 20 20 20h90q20 0 20 20v20" />
            </svg>
          </div>
          <h1>
            Để ý tưởng
            <br />
            thành lời.
          </h1>
          <p>
            Một không gian yên tĩnh để đặt câu hỏi,
            <br className="desktop-only" /> tìm góc nhìn mới và làm việc cùng
            AI.
          </p>
        </div>
        <p className="login-footnote">
          PIPILABU · Cloudflare Workers AI, Groq & BytePlus
        </p>
      </section>
      <section className="login-panel">
        <div className="login-theme">
          <ThemeToggle />
        </div>
        <div className="login-form">
          <span className="login-icon">
            <MessageCircle size={26} />
          </span>
          <h2>Bắt đầu trò chuyện</h2>
          <p>
            Đăng nhập để lưu lại những ý tưởng của bạn
            <br className="desktop-only" /> và tiếp tục từ bất kỳ đâu.
          </p>
          <button
            className="button google-button"
            disabled={busy}
            onClick={() => void googleLogin()}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h6a5.1 5.1 0 0 1-2.2 3.3v2.8h3.5c2.1-1.9 3.3-4.7 3.3-8.1Z"
              />
              <path
                fill="#34A853"
                d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.9A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.7 14a6.7 6.7 0 0 1 0-4V7H2.1a11 11 0 0 0 0 10l3.6-3Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.4c1.6 0 3 .6 4.1 1.6l3.1-3.1A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.1 7l3.6 3c.9-2.7 3.4-4.6 6.3-4.6Z"
              />
            </svg>
            {busy ? 'Đang đăng nhập…' : 'Tiếp tục với Google'}
            <ArrowUpRight size={18} />
          </button>
          {!!error && <ErrorNotice error={error} />}
          <div className="login-benefits">
            <p>
              <ShieldCheck size={17} />
              Lịch sử riêng cho từng tài khoản
            </p>
            <p>
              <LockKeyhole size={17} />
              Hạn mức token rõ ràng theo phiên
            </p>
          </div>
          {isLocal && (
            <details className="dev-login">
              <summary>Đăng nhập trong môi trường phát triển</summary>
              <form onSubmit={devLogin}>
                <label htmlFor="dev-email">Email tài khoản local</label>
                <input
                  id="dev-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="button secondary" disabled={busy}>
                  Đăng nhập local
                </button>
                <small>
                  admin@example.test có quyền quản trị theo cấu hình backend
                  local.
                </small>
              </form>
            </details>
          )}
          <small className="login-disclosure">
            Nội dung được gửi đến dịch vụ AI để xử lý.
            <br />
            Hãy cân nhắc trước khi chia sẻ thông tin nhạy cảm.
          </small>
        </div>
      </section>
    </main>
  );
}
