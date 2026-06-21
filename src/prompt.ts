/**
 * Read a single line from stdin — works for an interactive TTY and for piped
 * input. Resolves undefined if stdin closes with no input (so callers can treat
 * "nothing provided" distinctly from an empty answer).
 */
export function promptLine(message: string): Promise<string | undefined> {
  const stdin = process.stdin;
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;

    const finish = (value: string | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.off('error', onError);
      if (!stdin.isTTY) {
        stdin.pause();
      }
      resolve(value);
    };

    const onData = (chunk: string): void => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline !== -1) {
        finish(buffer.slice(0, newline));
      }
    };
    const onEnd = (): void => finish(buffer.length > 0 ? buffer : undefined);
    const onError = (): void => finish(undefined);

    if (stdin.isTTY) {
      process.stderr.write(message);
    }
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
    stdin.resume();
  });
}
