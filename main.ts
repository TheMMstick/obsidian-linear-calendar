import {
  App,
  ItemView,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  moment,
} from "obsidian";

const VIEW_TYPE_LINEAR_CALENDAR = "linear-calendar-view";

interface CalendarEvent {
  title: string;
  file: TFile;
  startDate: Date;
  endDate?: Date;
  color?: string;
}

interface LinearCalendarSettings {
  dailyNotesFolder: string;
  dailyNoteFormat: string;
  dateFields: string[];
  showFileCreationDates: boolean;
  year: number;
  weekdayLabels: string[];
  monthLabels: string[];
  scaleX: number;
  scaleY: number;
  fontScale: number;
  defaultScaleX: number;
  defaultScaleY: number;
  defaultFontScale: number;
}

const DEFAULT_SETTINGS: LinearCalendarSettings = {
  dailyNotesFolder: "",
  dailyNoteFormat: "YYYY-MM-DD",
  dateFields: ["date", "created", "due"],
  showFileCreationDates: true,
  year: new Date().getFullYear(),
  weekdayLabels: ["M", "T", "W", "T", "F", "S", "S"],
  monthLabels: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
  scaleX: 1,
  scaleY: 1,
  fontScale: 1,
  defaultScaleX: 1,
  defaultScaleY: 1,
  defaultFontScale: 1,
};

export default class LinearCalendarPlugin extends Plugin {
  settings: LinearCalendarSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_LINEAR_CALENDAR,
      (leaf) => new LinearCalendarView(leaf, this)
    );

    this.addCommand({
      id: "open-view",
      name: "Open calendar view",
      callback: () => void this.activateView(),
    });

    this.addSettingTab(new LinearCalendarSettingTab(this.app, this));

    this.addRibbonIcon("calendar-days", "Open calendar view", () => {
      void this.activateView();
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_LINEAR_CALENDAR);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_LINEAR_CALENDAR,
          active: true,
        });
      }
    }

    if (leaf) {
      void workspace.revealLeaf(leaf);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class LinearCalendarView extends ItemView {
  plugin: LinearCalendarPlugin;
  private events: Map<string, CalendarEvent[]> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: LinearCalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LINEAR_CALENDAR;
  }

  getDisplayText(): string {
    return "Linear calendar";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    this.loadEvents();
    this.render();

    this.registerEvent(
      this.app.vault.on("create", () => void this.refresh())
    );
    this.registerEvent(
      this.app.vault.on("delete", () => void this.refresh())
    );
    this.registerEvent(
      this.app.vault.on("rename", () => void this.refresh())
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => void this.refresh())
    );
  }

  private refresh(): void {
    this.loadEvents();
    this.render();
  }

  private loadEvents(): void {
    this.events.clear();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const dates = this.extractDatesFromFile(file);
      for (const date of dates) {
        const key = this.dateKey(date);
        if (!this.events.has(key)) {
          this.events.set(key, []);
        }
        this.events.get(key)?.push({
          title: file.basename,
          file,
          startDate: date,
        });
      }
    }
  }

  private extractDatesFromFile(file: TFile): Date[] {
    const dates: Date[] = [];
    const settings = this.plugin.settings;

    // Check if it's a daily note
    const dailyDate = this.parseDailyNoteDate(file);
    if (dailyDate) {
      dates.push(dailyDate);
    }

    // Check frontmatter date fields
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.frontmatter) {
      for (const field of settings.dateFields) {
        const value = cache.frontmatter[field];
        if (value) {
          const parsed = this.parseDate(value);
          if (parsed) {
            dates.push(parsed);
          }
        }
      }
    }

    // Check file creation date
    if (settings.showFileCreationDates && dates.length === 0) {
      dates.push(new Date(file.stat.ctime));
    }

    return dates;
  }

  private parseDailyNoteDate(file: TFile): Date | null {
    const settings = this.plugin.settings;
    const folder = settings.dailyNotesFolder;

    // Check if file is in daily notes folder (if specified)
    if (folder && !file.path.startsWith(folder)) {
      return null;
    }

    const parsed = moment(file.basename, settings.dailyNoteFormat, true);
    if (parsed.isValid()) {
      return parsed.toDate();
    }
    return null;
  }

  private parseDate(value: unknown): Date | null {
    if (typeof value === "string") {
      const parsed = moment(value);
      if (parsed.isValid()) {
        return parsed.toDate();
      }
    }
    if (value instanceof Date) {
      return value;
    }
    return null;
  }

  private dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("linear-calendar-container");

    const year = this.plugin.settings.year;
    const settings = this.plugin.settings;

    // Calculate max columns needed (max offset + 31 days)
    const maxColumns = this.calculateMaxColumns(year);

    // Create header with year selector and scale controls
    const header = container.createDiv({ cls: "linear-calendar-header" });
    this.renderYearSelector(header, year);
    this.renderScaleControls(header);

    // Create scroll wrapper for independent X/Y scrolling
    const scrollWrapper = container.createDiv({ cls: "linear-calendar-scroll-wrapper" });

    // Create calendar grid with scale applied
    const grid = scrollWrapper.createDiv({ cls: "linear-calendar-grid" });
    grid.style.setProperty("--scale-x", String(settings.scaleX));
    grid.style.setProperty("--scale-y", String(settings.scaleY));
    grid.style.setProperty("--font-scale", String(settings.fontScale));

    // Render weekday header row
    this.renderWeekdayHeader(grid, maxColumns, settings.weekdayLabels);

    // Render each month
    for (let month = 0; month < 12; month++) {
      this.renderMonth(grid, year, month, maxColumns);
    }

    // Add wheel scale handler
    this.registerDomEvent(scrollWrapper, "wheel", (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        if (e.shiftKey) {
          this.adjustScale("y", delta);
        } else {
          this.adjustScale("x", delta);
        }
      }
    });
  }

  private renderScaleControls(container: HTMLElement): void {
    const scaleContainer = container.createDiv({ cls: "linear-calendar-scale-controls" });

    // X scale controls
    const xGroup = scaleContainer.createDiv({ cls: "linear-calendar-scale-group" });
    xGroup.createEl("span", { cls: "linear-calendar-scale-label", text: "Width" });

    const xOutBtn = xGroup.createEl("button", {
      cls: "linear-calendar-scale-btn",
      attr: { "aria-label": "Decrease width" },
    });
    xOutBtn.setText("-");
    xOutBtn.addEventListener("click", () => this.adjustScale("x", -0.2));

    xGroup.createEl("span", {
      cls: "linear-calendar-scale-value",
      text: `${Math.round(this.plugin.settings.scaleX * 100)}%`,
    });

    const xInBtn = xGroup.createEl("button", {
      cls: "linear-calendar-scale-btn",
      attr: { "aria-label": "Increase width" },
    });
    xInBtn.setText("+");
    xInBtn.addEventListener("click", () => this.adjustScale("x", 0.2));

    // Y scale controls
    const yGroup = scaleContainer.createDiv({ cls: "linear-calendar-scale-group" });
    yGroup.createEl("span", { cls: "linear-calendar-scale-label", text: "Height" });

    const yOutBtn = yGroup.createEl("button", {
      cls: "linear-calendar-scale-btn",
      attr: { "aria-label": "Decrease height" },
    });
    yOutBtn.setText("-");
    yOutBtn.addEventListener("click", () => this.adjustScale("y", -0.2));

    yGroup.createEl("span", {
      cls: "linear-calendar-scale-value",
      text: `${Math.round(this.plugin.settings.scaleY * 100)}%`,
    });

    const yInBtn = yGroup.createEl("button", {
      cls: "linear-calendar-scale-btn",
      attr: { "aria-label": "Increase height" },
    });
    yInBtn.setText("+");
    yInBtn.addEventListener("click", () => this.adjustScale("y", 0.2));

    // Font scale controls
    const fontGroup = scaleContainer.createDiv({ cls: "linear-calendar-scale-group" });
    fontGroup.createEl("span", { cls: "linear-calendar-scale-label", text: "Font" });

    const fontOutBtn = fontGroup.createEl("button", {
      cls: "linear-calendar-scale-btn",
      attr: { "aria-label": "Decrease font size" },
    });
    fontOutBtn.setText("-");
    fontOutBtn.addEventListener("click", () => this.adjustScale("font", -0.1));

    fontGroup.createEl("span", {
      cls: "linear-calendar-scale-value",
      text: `${Math.round(this.plugin.settings.fontScale * 100)}%`,
    });

    const fontInBtn = fontGroup.createEl("button", {
      cls: "linear-calendar-scale-btn",
      attr: { "aria-label": "Increase font size" },
    });
    fontInBtn.setText("+");
    fontInBtn.addEventListener("click", () => this.adjustScale("font", 0.1));

    // Reset button
    const resetBtn = scaleContainer.createEl("button", {
      cls: "linear-calendar-scale-btn linear-calendar-scale-reset",
      attr: { "aria-label": "Reset to defaults" },
    });
    resetBtn.setText("Reset");
    resetBtn.addEventListener("click", () => {
      this.plugin.settings.scaleX = this.plugin.settings.defaultScaleX;
      this.plugin.settings.scaleY = this.plugin.settings.defaultScaleY;
      this.plugin.settings.fontScale = this.plugin.settings.defaultFontScale;
      void this.plugin.saveSettings();
      this.render();
    });
  }

  private adjustScale(axis: "x" | "y" | "font", delta: number): void {
    const key = axis === "x" ? "scaleX" : axis === "y" ? "scaleY" : "fontScale";
    const min = axis === "font" ? 0.5 : 0.5;
    const max = axis === "font" ? 3 : 5;
    const newScale = Math.max(min, Math.min(max, this.plugin.settings[key] + delta));
    this.plugin.settings[key] = Math.round(newScale * 10) / 10;
    void this.plugin.saveSettings();
    this.render();
  }

  private calculateMaxColumns(year: number): number {
    let maxEndColumn = 0;
    for (let month = 0; month < 12; month++) {
      const firstDay = new Date(year, month, 1);
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      // getDay() returns 0 for Sunday, we want Monday = 0
      const offset = (firstDay.getDay() + 6) % 7;
      const endColumn = offset + daysInMonth;
      if (endColumn > maxEndColumn) {
        maxEndColumn = endColumn;
      }
    }
    return maxEndColumn;
  }

  private renderYearSelector(container: HTMLElement, currentYear: number): void {
    const selector = container.createDiv({ cls: "linear-calendar-year-selector" });

    const prevBtn = selector.createEl("button", {
      cls: "linear-calendar-year-btn",
      attr: {
        "aria-label": "Previous year",
      },
    });
    prevBtn.setText("<");
    prevBtn.addEventListener("click", () => {
      this.plugin.settings.year = currentYear - 1;
      void this.plugin.saveSettings();
      this.render();
    });

    selector.createEl("span", {
      cls: "linear-calendar-year-label",
      text: String(currentYear),
    });

    const nextBtn = selector.createEl("button", {
      cls: "linear-calendar-year-btn",
      attr: {
        "aria-label": "Next year",
      },
    });
    nextBtn.setText(">");
    nextBtn.addEventListener("click", () => {
      this.plugin.settings.year = currentYear + 1;
      void this.plugin.saveSettings();
      this.render();
    });

    // Today button
    const todayBtn = selector.createEl("button", {
      cls: "linear-calendar-today-btn",
      attr: {
        "aria-label": "Go to current year",
      },
    });
    todayBtn.setText("Today");
    todayBtn.addEventListener("click", () => {
      this.plugin.settings.year = new Date().getFullYear();
      void this.plugin.saveSettings();
      this.render();
    });
  }

  private renderWeekdayHeader(
    grid: HTMLElement,
    maxColumns: number,
    labels: string[]
  ): void {
    const row = grid.createDiv({ cls: "linear-calendar-row linear-calendar-header-row" });

    // Empty cell for month label column
    row.createDiv({ cls: "linear-calendar-month-label" });

    // Weekday labels repeating
    for (let col = 0; col < maxColumns; col++) {
      const dayIndex = col % 7;
      const isWeekend = dayIndex === 5 || dayIndex === 6;
      const cell = row.createDiv({
        cls: `linear-calendar-header-cell ${isWeekend ? "linear-calendar-weekend" : ""}`,
      });
      cell.setText(labels[dayIndex]);
    }
  }

  private renderMonth(
    grid: HTMLElement,
    year: number,
    month: number,
    maxColumns: number
  ): void {
    const settings = this.plugin.settings;
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = (firstDay.getDay() + 6) % 7; // Monday = 0

    const row = grid.createDiv({ cls: "linear-calendar-row" });

    // Month label
    const monthLabel = row.createDiv({ cls: "linear-calendar-month-label" });
    monthLabel.setText(settings.monthLabels[month]);

    // Create all cells
    const today = new Date();
    const isCurrentYear = year === today.getFullYear();
    const isCurrentMonth = isCurrentYear && month === today.getMonth();
    const todayDate = today.getDate();

    // Days container for positioning
    const daysContainer = row.createDiv({ cls: "linear-calendar-days-container" });

    // Empty cells before month starts
    for (let col = 0; col < offset; col++) {
      const dayIndex = col % 7;
      const isWeekend = dayIndex === 5 || dayIndex === 6;
      daysContainer.createDiv({
        cls: `linear-calendar-cell linear-calendar-empty ${isWeekend ? "linear-calendar-weekend" : ""}`,
      });
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const col = offset + day - 1;
      const dayIndex = col % 7;
      const isWeekend = dayIndex === 5 || dayIndex === 6;
      const isToday = isCurrentMonth && day === todayDate;

      const date = new Date(year, month, day);
      const dateKey = this.dateKey(date);
      const dayEvents = this.events.get(dateKey) || [];

      const cell = daysContainer.createDiv({
        cls: `linear-calendar-cell ${isWeekend ? "linear-calendar-weekend" : ""} ${isToday ? "linear-calendar-today" : ""} ${dayEvents.length > 0 ? "linear-calendar-has-events" : ""}`,
        attr: {
          "data-date": dateKey,
          "aria-label": `${settings.monthLabels[month]} ${day}, ${year}`,
          tabindex: "0",
          role: "button",
        },
      });

      // Day number
      const dayNumber = cell.createDiv({ cls: "linear-calendar-day-number" });
      dayNumber.setText(String(day));

      // Events
      if (dayEvents.length > 0) {
        const eventsContainer = cell.createDiv({ cls: "linear-calendar-events" });
        for (const event of dayEvents.slice(0, 3)) {
          const eventEl = eventsContainer.createDiv({
            cls: "linear-calendar-event",
            attr: {
              "aria-label": `Open ${event.title}`,
              tabindex: "0",
              role: "button",
            },
          });
          eventEl.setText(event.title.substring(0, 10));
          eventEl.addEventListener("click", (ev) => {
            ev.stopPropagation();
            void this.openFile(event.file);
          });
          eventEl.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              ev.stopPropagation();
              void this.openFile(event.file);
            }
          });
        }
        if (dayEvents.length > 3) {
          const moreEl = eventsContainer.createDiv({ cls: "linear-calendar-more" });
          moreEl.setText(`+${dayEvents.length - 3}`);
        }
      }

      // Click handler for day
      cell.addEventListener("click", () => {
        void this.openOrCreateDailyNote(date);
      });
      cell.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          void this.openOrCreateDailyNote(date);
        }
      });
    }

    // Empty cells after month ends
    const totalCells = offset + daysInMonth;
    for (let col = totalCells; col < maxColumns; col++) {
      const dayIndex = col % 7;
      const isWeekend = dayIndex === 5 || dayIndex === 6;
      daysContainer.createDiv({
        cls: `linear-calendar-cell linear-calendar-empty ${isWeekend ? "linear-calendar-weekend" : ""}`,
      });
    }
  }

  private async openFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  private async openOrCreateDailyNote(date: Date): Promise<void> {
    const settings = this.plugin.settings;
    const filename = moment(date).format(settings.dailyNoteFormat);
    const folder = settings.dailyNotesFolder;
    const path = folder ? `${folder}/${filename}.md` : `${filename}.md`;

    let file = this.app.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      await this.openFile(file);
    } else {
      // Create the file
      try {
        if (folder) {
          const folderExists = this.app.vault.getAbstractFileByPath(folder);
          if (!folderExists) {
            await this.app.vault.createFolder(folder);
          }
        }
        const newFile = await this.app.vault.create(path, "");
        await this.openFile(newFile);
      } catch {
        // File might already exist, try to open it
        file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.openFile(file);
        }
      }
    }
  }

  async onClose(): Promise<void> {
    // Cleanup handled by registerEvent
  }
}

class LinearCalendarSettingTab extends PluginSettingTab {
  plugin: LinearCalendarPlugin;

  constructor(app: App, plugin: LinearCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Daily notes").setHeading();

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder where daily notes are stored (leave empty for vault root)")
      .addText((text) =>
        text
          .setPlaceholder("Daily")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Daily note format")
      .setDesc("Date format for daily note filenames (moment.js format)")
      .addText((text) =>
        text
          .setPlaceholder("E.g., YYYY-MM-DD")
          .setValue(this.plugin.settings.dailyNoteFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFormat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Event sources").setHeading();

    new Setting(containerEl)
      .setName("Date fields")
      .setDesc("Frontmatter fields to check for dates (comma-separated)")
      .addText((text) =>
        text
          .setPlaceholder("Date, created, due")
          .setValue(this.plugin.settings.dateFields.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.dateFields = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show file creation dates")
      .setDesc("Show notes on their creation date if no other date is found")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showFileCreationDates)
          .onChange(async (value) => {
            this.plugin.settings.showFileCreationDates = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Display").setHeading();

    new Setting(containerEl)
      .setName("Weekday labels")
      .setDesc("Labels for weekdays starting Monday (comma-separated)")
      .addText((text) =>
        text
          .setPlaceholder("E.g., M, T, W, T, F, S, S")
          .setValue(this.plugin.settings.weekdayLabels.join(", "))
          .onChange(async (value) => {
            const labels = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            if (labels.length === 7) {
              this.plugin.settings.weekdayLabels = labels;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Month labels")
      .setDesc("Labels for months (comma-separated)")
      .addText((text) =>
        text
          .setPlaceholder("E.g., Jan, Feb, Mar, ...")
          .setValue(this.plugin.settings.monthLabels.join(", "))
          .onChange(async (value) => {
            const labels = value
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            if (labels.length === 12) {
              this.plugin.settings.monthLabels = labels;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl).setName("Default sizes").setHeading();

    new Setting(containerEl)
      .setName("Default width scale")
      .setDesc("Default cell width scale (50-500%)")
      .addText((text) =>
        text
          .setPlaceholder("100")
          .setValue(String(Math.round(this.plugin.settings.defaultScaleX * 100)))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 50 && num <= 500) {
              this.plugin.settings.defaultScaleX = num / 100;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default height scale")
      .setDesc("Default cell height scale (50-500%)")
      .addText((text) =>
        text
          .setPlaceholder("100")
          .setValue(String(Math.round(this.plugin.settings.defaultScaleY * 100)))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 50 && num <= 500) {
              this.plugin.settings.defaultScaleY = num / 100;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Default font scale")
      .setDesc("Default font size scale (50-300%)")
      .addText((text) =>
        text
          .setPlaceholder("100")
          .setValue(String(Math.round(this.plugin.settings.defaultFontScale * 100)))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 50 && num <= 300) {
              this.plugin.settings.defaultFontScale = num / 100;
              await this.plugin.saveSettings();
            }
          })
      );
  }
}
