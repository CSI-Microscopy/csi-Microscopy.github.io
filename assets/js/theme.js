const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
  const html = document.documentElement;
  const currentTheme = html.getAttribute('data-theme') || 'light';
  const newTheme = (currentTheme === 'light') ? 'dark' : 'light';
  html.setAttribute('data-theme', newTheme);
});