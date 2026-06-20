import { hashSource, type Dispatch } from '../dispatch';

export function run(dispatch: Dispatch): number {
  process.stdout.write(
    `would create a new host — hash source: ${hashSource(dispatch)}\n`,
  );
  return 0;
}
