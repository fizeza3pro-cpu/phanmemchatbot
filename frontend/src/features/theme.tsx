import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';
type Preference = Theme | 'system';
const storageKey = 'pipilabu:theme:v1';
const ThemeContext = createContext<{
  theme: Theme;
  reducedMotion: boolean;
  toggleTheme: () => void;
} | null>(null);

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query]
  );
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(() => {
    const initial = document.documentElement.dataset.themePreference;
    return initial === 'light' || initial === 'dark' ? initial : 'dark';
  });
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const theme: Theme =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#262521' : '#FFFFFF');
  }, [theme, preference]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      setPreference(
        event.newValue === 'light' || event.newValue === 'dark'
          ? event.newValue
          : 'dark'
      );
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light';
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Keep the in-memory choice. */
    }
  }, [theme]);
  const value = useMemo(
    () => ({ theme, reducedMotion, toggleTheme }),
    [theme, reducedMotion, toggleTheme]
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('Thiếu cấu hình giao diện.');
  return theme;
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label =
    theme === 'dark'
      ? 'Chuyển sang giao diện sáng'
      : 'Chuyển sang giao diện tối';
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
    </button>
  );
}
