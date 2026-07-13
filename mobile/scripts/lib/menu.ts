import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";

/**
 * Arrow-key select menu, mirroring backend/scripts/lib/menu.ts so all
 * repo CLIs feel the same. Falls back to numbered input when not a TTY.
 */
export interface MenuOption<T> {
  label: string;
  value: T;
  hint?: string;
}

function formatLine<T>(option: MenuOption<T>, selected: boolean) {
  const marker = selected ? ">" : " ";
  const hint = option.hint ? `  ${option.hint}` : "";
  return `${marker} ${option.label}${hint}`;
}

async function fallbackSelect<T>(title: string, options: Array<MenuOption<T>>) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      console.log(`\n${title}`);
      options.forEach((option, index) => {
        const hint = option.hint ? `  ${option.hint}` : "";
        console.log(`${String(index + 1).padStart(2, " ")}. ${option.label}${hint}`);
      });
      const answer = (await rl.question('select number or "q" to cancel> ')).trim();
      if (answer.toLowerCase() === "q") return null;
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= options.length) {
        return options[index - 1]!.value;
      }
      console.log("Choose one of the listed numbers.");
    }
  } finally {
    rl.close();
  }
}

export async function selectMenu<T>(
  title: string,
  options: Array<MenuOption<T>>,
): Promise<T | null> {
  if (options.length === 0) return null;
  if (!stdin.isTTY || !stdout.isTTY) return fallbackSelect(title, options);

  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  let selectedIndex = 0;
  let renderedLines = 0;

  const render = () => {
    const lines = [
      "",
      title,
      "Use arrows, Enter to select, q to cancel.",
      ...options.map((option, index) => formatLine(option, index === selectedIndex)),
    ];
    if (renderedLines > 0) stdout.write(`\x1b[${renderedLines}F`);
    for (const line of lines) stdout.write(`\x1b[2K${line}\n`);
    renderedLines = lines.length;
  };

  return new Promise<T | null>((resolve) => {
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\x1b[?25h");
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean } | undefined) => {
      if (!key) return;
      if ((key.ctrl && key.name === "c") || key.name === "q" || key.name === "escape") {
        cleanup();
        resolve(null);
        return;
      }
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      } else if (key.name === "return") {
        cleanup();
        resolve(options[selectedIndex]!.value);
      }
    };

    stdout.write("\x1b[?25l");
    stdin.on("keypress", onKeypress);
    render();
  });
}
