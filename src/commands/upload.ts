import { hashSource, type Dispatch } from '../dispatch';

export function run(dispatch: Dispatch): number {
  const target = dispatch.params[0] ?? '(no path)';
  process.stdout.write(
    `would upload ${target} — hash source: ${hashSource(dispatch)}\n`,
  );
  return 0;
}
