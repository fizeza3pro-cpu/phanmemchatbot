import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import './styles.css';
import './chat-reference.css';
import { api, ApiError } from './lib/api';
import { AuthProvider } from './features/auth';
import { ThemeProvider } from './features/theme';
import { Spinner, ToastProvider } from './components/ui';
import ChatPage from './features/chat/ChatPage';

const AdminPage = React.lazy(() => import('./features/admin/AdminPage'));
class AppBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fullscreen-loading">
        <h1>Không thể mở giao diện</h1>
        <p>Thử tải lại trang để tiếp tục.</p>
        <button className="button" onClick={() => location.reload()}>
          Tải lại trang
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppBoundary>
        <SWRConfig
          value={{
            fetcher: api,
            dedupingInterval: 1500,
            errorRetryCount: 2,
            shouldRetryOnError: (error) =>
              !(error instanceof ApiError) ||
              error.status === 0 ||
              error.status >= 500,
          }}
        >
          <ToastProvider>
            <AuthProvider>
              <BrowserRouter>
                <Suspense
                  fallback={
                    <div className="fullscreen-loading">
                      <Spinner />
                    </div>
                  }
                >
                  <Routes>
                    <Route path="/chat" element={<ChatPage />} />
                    <Route path="/chat/:id" element={<ChatPage />} />
                    <Route path="/admin/*" element={<AdminPage />} />
                    <Route path="*" element={<Navigate to="/chat" replace />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </SWRConfig>
      </AppBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
