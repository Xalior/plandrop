import { isCommand } from '../dispatch';
import { commandText, overviewText } from '../usage';
import type { Dispatch } from '../dispatch';

export function run(dispatch: Dispatch): number {
  const topic = dispatch.params.find((param) => !param.startsWith('-'));
  if (topic === undefined) {
    process.stdout.write(overviewText());
    return 0;
  }
  if (!isCommand(topic)) {
    process.stderr.write(`unknown command: ${topic}\n\n${overviewText()}`);
    return 2;
  }
  process.stdout.write(commandText(topic));
  return 0;
}
