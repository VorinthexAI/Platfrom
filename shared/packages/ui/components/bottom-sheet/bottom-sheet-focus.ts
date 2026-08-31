export const BOTTOM_SHEET_INPUT_FOCUS_DELAY_MS = 300;

export type BottomSheetFocusInput = {
  focus: () => void;
  isEligible: () => boolean;
};

type Timer = ReturnType<typeof setTimeout>;
type Scheduler = {
  clearTimeout: (timer: Timer) => void;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => Timer;
};

type Sheet = {
  active: boolean;
  claimed: boolean;
  cycleKey: string;
  deadline: number;
  inputs: Map<symbol, BottomSheetFocusInput>;
  timer?: Timer;
};

const defaultScheduler: Scheduler = {
  clearTimeout,
  now: Date.now,
  setTimeout,
};

export class BottomSheetFocusCoordinator {
  private readonly sheets = new Map<symbol, Sheet>();
  private readonly stack: symbol[] = [];

  constructor(private readonly scheduler: Scheduler = defaultScheduler) {}

  activate(sheetId: symbol, cycleKey: string) {
    const sheet = this.ensureSheet(sheetId, cycleKey);
    if (!sheet.active) {
      sheet.active = true;
      this.stack.push(sheetId);
    }
    this.resetCycle(sheet, cycleKey);
  }

  setCycle(sheetId: symbol, cycleKey: string) {
    const sheet = this.sheets.get(sheetId);
    if (!sheet || sheet.cycleKey === cycleKey) return;
    this.resetCycle(sheet, cycleKey);
  }

  deactivate(sheetId: symbol) {
    const sheet = this.sheets.get(sheetId);
    if (!sheet) return;
    this.cancelTimer(sheet);
    this.sheets.delete(sheetId);
    const stackIndex = this.stack.indexOf(sheetId);
    if (stackIndex >= 0) this.stack.splice(stackIndex, 1);
    this.focusTopmostIfReady();
  }

  registerInput(sheetId: symbol, cycleKey: string, inputId: symbol, input: BottomSheetFocusInput) {
    const sheet = this.ensureSheet(sheetId, cycleKey);
    if (sheet.cycleKey !== cycleKey) {
      if (sheet.active) this.resetCycle(sheet, cycleKey);
      else {
        this.cancelTimer(sheet);
        sheet.claimed = false;
        sheet.cycleKey = cycleKey;
        sheet.deadline = 0;
      }
    }
    sheet.inputs.set(inputId, input);
    this.focusTopmostIfReady();
    return () => {
      const current = this.sheets.get(sheetId);
      if (current?.inputs.get(inputId) === input) current.inputs.delete(inputId);
    };
  }

  claim(sheetId: symbol, cycleKey: string) {
    const sheet = this.sheets.get(sheetId);
    if (!sheet?.active || sheet.cycleKey !== cycleKey || sheet.claimed) return;
    sheet.claimed = true;
    this.cancelTimer(sheet);
  }

  private ensureSheet(sheetId: symbol, cycleKey: string) {
    let sheet = this.sheets.get(sheetId);
    if (!sheet) {
      sheet = { active: false, claimed: false, cycleKey, deadline: 0, inputs: new Map() };
      this.sheets.set(sheetId, sheet);
    }
    return sheet;
  }

  private resetCycle(sheet: Sheet, cycleKey: string) {
    if (sheet.deadline && sheet.cycleKey === cycleKey) return;
    this.cancelTimer(sheet);
    sheet.claimed = false;
    sheet.cycleKey = cycleKey;
    sheet.deadline = this.scheduler.now() + BOTTOM_SHEET_INPUT_FOCUS_DELAY_MS;
    sheet.timer = this.scheduler.setTimeout(
      () => {
        sheet.timer = undefined;
        this.focusTopmostIfReady();
      },
      BOTTOM_SHEET_INPUT_FOCUS_DELAY_MS,
    );
  }

  private cancelTimer(sheet: Sheet) {
    if (sheet.timer === undefined) return;
    this.scheduler.clearTimeout(sheet.timer);
    sheet.timer = undefined;
  }

  private focusTopmostIfReady() {
    const sheetId = this.stack[this.stack.length - 1];
    if (!sheetId) return;
    const sheet = this.sheets.get(sheetId);
    if (!sheet?.active || sheet.claimed || !sheet.deadline || this.scheduler.now() < sheet.deadline) return;
    const input = [...sheet.inputs.values()].find((candidate) => candidate.isEligible());
    if (!input) return;
    sheet.claimed = true;
    this.cancelTimer(sheet);
    input.focus();
  }
}

export const bottomSheetFocusCoordinator = new BottomSheetFocusCoordinator();
