import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { browserLauncher, openUrl, parseUploadFlags } from '../src/commands/upload';

describe('parseUploadFlags', () => {
  it('splits --open out from anywhere in the argument list', () => {
    expect(parseUploadFlags(['file.html', '--open'])).toEqual({
      open: true,
      positionals: ['file.html'],
    });
    expect(parseUploadFlags(['--open', 'file.html', 'dest.html'])).toEqual({
      open: true,
      positionals: ['file.html', 'dest.html'],
    });
  });

  it('leaves the positionals alone when --open is absent', () => {
    expect(parseUploadFlags(['file.html', 'dest.html'])).toEqual({
      open: false,
      positionals: ['file.html', 'dest.html'],
    });
  });
});

describe('browserLauncher', () => {
  it('picks the platform launcher', () => {
    expect(browserLauncher('darwin', 'https://x.example/')).toEqual({
      command: 'open',
      args: ['https://x.example/'],
    });
    expect(browserLauncher('linux', 'https://x.example/')).toEqual({
      command: 'xdg-open',
      args: ['https://x.example/'],
    });
    // `start` reads its first quoted argument as a window title, so an empty
    // one has to come ahead of the URL or the URL is mistaken for the title.
    expect(browserLauncher('win32', 'https://x.example/')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '""', 'https://x.example/'],
    });
  });

  it('has no launcher for a platform it does not know', () => {
    expect(browserLauncher('aix', 'https://x.example/')).toBeUndefined();
  });
});

/** A fake ChildProcess exposing just enough of the EventEmitter surface. */
function fakeChild(): { child: ChildProcess; emit: (event: string, ...args: unknown[]) => void } {
  const emitter = new EventEmitter();
  return {
    child: emitter as unknown as ChildProcess,
    emit: (event, ...args) => emitter.emit(event, ...args),
  };
}

describe('openUrl', () => {
  it('spawns the platform launcher with the URL', async () => {
    const { child, emit } = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => emit('spawn'));
      return child;
    }) as unknown as typeof spawn;

    await openUrl('https://x.example/', 'darwin', spawnFn);

    expect(spawnFn).toHaveBeenCalledWith('open', ['https://x.example/'], { stdio: 'ignore' });
  });

  it('warns on stderr and resolves, rather than failing, when the launcher errors', async () => {
    const { child, emit } = fakeChild();
    const spawnFn = vi.fn(() => {
      queueMicrotask(() => emit('error', new Error('ENOENT')));
      return child;
    }) as unknown as typeof spawn;
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await openUrl('https://x.example/', 'linux', spawnFn);

    const written = err.mock.calls.map((call) => String(call[0])).join('');
    err.mockRestore();
    expect(written).toMatch(/could not open a browser/);
  });

  it('warns, without spawning anything, on a platform with no known launcher', async () => {
    const spawnFn = vi.fn() as unknown as typeof spawn;
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await openUrl('https://x.example/', 'aix', spawnFn);

    const written = err.mock.calls.map((call) => String(call[0])).join('');
    err.mockRestore();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(written).toMatch(/no launcher known/);
  });
});
