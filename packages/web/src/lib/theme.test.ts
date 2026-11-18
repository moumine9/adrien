import { applyTheme, initialTheme, storeTheme, THEME_KEY } from './theme.ts';

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = '';
});

describe('theme', () => {
  it('follows prefers-color-scheme when nothing is stored', () => {
    mockMatchMedia(true);
    expect(initialTheme()).toBe('dark');
    mockMatchMedia(false);
    expect(initialTheme()).toBe('light');
  });

  it('prefers the stored choice', () => {
    mockMatchMedia(true);
    storeTheme('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(initialTheme()).toBe('light');
  });

  it('ignores a corrupt stored value', () => {
    mockMatchMedia(false);
    localStorage.setItem(THEME_KEY, 'neon');
    expect(initialTheme()).toBe('light');
  });

  it('applies the theme as a class on <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
