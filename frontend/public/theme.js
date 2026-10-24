(() => {
  let preference = 'dark';
  try {
    const saved = localStorage.getItem('pipilabu:theme:v1');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    /* Use the reference dark theme when storage is unavailable. */
  }
  const theme =
    preference === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#262521' : '#FFFFFF');
})();
