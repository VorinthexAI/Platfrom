import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';

export interface MenuOption<T> {
  label: string;
  value: T;
  hint?: string;
}

export interface SelectMenuOptions {
  cancelValue?: string;
}

function formatLine<T>(option: MenuOption<T>, selected: boolean) {
  const marker = selected ? '>' : ' ';
  const hint = option.hint ? `  ${option.hint}` : '';
  return `${marker} ${option.label}${hint}`;
}

async function fallbackSelect<T>(title: string, options: Array<MenuOption<T>>, menuOptions: SelectMenuOptions) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      console.log(`\n${title}`);
      options.forEach((option, index) => {
        const hint = option.hint ? `  ${option.hint}` : '';
        console.log(`${String(index + 1).padStart(2, ' ')}. ${option.label}${hint}`);
      });
      const cancelText = menuOptions.cancelValue ? ` or "${menuOptions.cancelValue}" to cancel` : '';
      const answer = (await rl.question(`select number${cancelText}> `)).trim();
      if (menuOptions.cancelValue && answer.toLowerCase() === menuOptions.cancelValue.toLowerCase()) return null;
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1]!.value;
      console.log('Choose one of the listed numbers.');
    }
  } finally {
    rl.close();
  }
}

export async function selectMenu<T>(
  title: string,
  options: Array<MenuOption<T>>,
  menuOptions: SelectMenuOptions = {},
): Promise<T | null> {
  if (options.length === 0) return null;
  if (!stdin.isTTY || !stdout.isTTY) return fallbackSelect(title, options, menuOptions);

  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  let selectedIndex = 0;
  let renderedLines = 0;

  const render = () => {
    const instructions = menuOptions.cancelValue
      ? `Use arrows, Enter to select, ${menuOptions.cancelValue} to cancel.`
      : 'Use arrows and Enter to select.';
    const lines = [
      '',
      title,
      instructions,
      ...options.map((option, index) => formatLine(option, index === selectedIndex)),
    ];

    if (renderedLines > 0) stdout.write(`\x1b[${renderedLines}F`);
    for (const line of lines) stdout.write(`\x1b[2K${line}\n`);
    renderedLines = lines.length;
  };

  return new Promise<T | null>((resolve) => {
    const cleanup = () => {
      stdin.off('keypress', onKeypress);
      stdin.setRawMode(wasRaw);
      stdout.write('\x1b[?25h');
    };

    const finish = (value: T | null) => {
      cleanup();
      stdout.write('\n');
      resolve(value);
    };

    const onKeypress = (_text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(130);
      }
      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(options[selectedIndex]!.value);
        return;
      }
      if (menuOptions.cancelValue && key.name === menuOptions.cancelValue.toLowerCase()) {
        finish(null);
        return;
      }
      if (menuOptions.cancelValue && key.name === 'escape') {
        finish(null);
      }
    };

    stdout.write('\x1b[?25l');
    stdin.on('keypress', onKeypress);
    render();
  });
}
