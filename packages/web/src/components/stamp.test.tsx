import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateSettings } from '@/lib/settings.ts';
import { VersionStamp } from './stamp.tsx';

const AT = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

beforeEach(() => {
  localStorage.clear();
  updateSettings({ showRevision: true });
});

describe('VersionStamp', () => {
  it('says when it changed, with the exact time in the tooltip and in the accessible name', () => {
    render(<VersionStamp revision={null} modifiedAt={AT} />);
    const time = screen.getByText(/^Changed 3 hours ago, .*\d{4}/).closest('time') as HTMLElement;
    expect(time).toHaveAttribute('dateTime', AT);
    expect(time).toHaveAttribute('title', expect.stringMatching(/\d{4}/));
    expect(screen.getByText('Changed 3 hours ago')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the revision in a button that copies it, and says so', async () => {
    const user = userEvent.setup();
    render(<VersionStamp revision="a1b2c3d4e5f6" modifiedAt={AT} />);
    const button = screen.getByRole('button', { name: 'Copy revision a1b2c3d4e5f6' });
    expect(button).toHaveTextContent('a1b2c3d4e5f6');
    await user.click(button);
    expect(await navigator.clipboard.readText()).toBe('a1b2c3d4e5f6');
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('forgets "Copied" after two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<VersionStamp revision="a1b2c3d4e5f6" modifiedAt={null} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    vi.useRealTimers();
  });

  it('survives a blocked clipboard without saying it copied', async () => {
    const user = userEvent.setup();
    render(<VersionStamp revision="a1b2c3d4e5f6" modifiedAt={null} />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('blocked'));
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('hides the revision when the setting is off, but keeps the time', () => {
    updateSettings({ showRevision: false });
    render(<VersionStamp revision="a1b2c3d4e5f6" modifiedAt={AT} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Changed 3 hours ago')).toBeInTheDocument();
  });

  it('renders nothing when there is nothing to show', () => {
    const { container } = render(<VersionStamp revision={null} modifiedAt={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when only a hidden revision is known', () => {
    updateSettings({ showRevision: false });
    const { container } = render(<VersionStamp revision="a1b2c3d4e5f6" modifiedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
