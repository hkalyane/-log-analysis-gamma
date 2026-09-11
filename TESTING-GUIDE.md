# Smart Log Highlighter - Testing Guide

## Automated Investigation Tests

Run `npm test` on a machine that can launch the VS Code test host. Compilation and lint run first. The suite includes 63 tests across persistence/productivity and investigation workflows.

Investigation coverage includes:
- Context overlap, exclusion precedence, and original-line mapping.
- Literal selection filters, source ownership, undo, and destination cancellation.
- Numbered focused exports, cancellation, and source-file overwrite protection.
- RTL/DMAC cycle counts, exact large integers, UVM units and tick scales, continuation lines, and resets.
- ISO offsets, custom full-date formats, timezone gaps/ambiguities, invalid inputs, and per-document wizard confirmation.
- Time/context settings round-trips through internal and external files, preserving settings on filter-only saves.
- Workspace bookmark persistence and stale/ambiguous text anchors.
- Blue bookmark defaults and legacy migration, color persistence/custom validation/cancellation, safe note hovers, source/focus gutter mapping, recoloring, removal, and resource cleanup.
- Worker cancellation, pause/resume, superseded jobs, timeout termination, and stale highlight cache rejection.

In a headless Linux container, the VS Code executable still needs its Electron runtime libraries. The test host can use `--ozone-platform=headless --no-sandbox --disable-gpu` and an isolated `--user-data-dir` via `vscode-test.runTests`; no production settings should be used for test runs.

## Bookmark Marker Manual Check

Bookmark a log line with a note. Confirm the blue glyph appears beside the line number (with **Editor: Glyph Margin** enabled), and hover over the marked line's text to read the note. In **Bookmarks**, choose **Change Bookmark Color...**, select a swatch, then try a custom hex color. Confirm the sidebar and gutter agree, editing the note retains the color, and reloading VS Code restores it. Open Focus Mode and verify that only visible bookmarked source lines have markers; removing the bookmark should remove both markers. VS Code does not expose a separate gutter-glyph hover message to extensions.

## RTL / Cycle Manual Check

Open a file containing:
```text
[DmacRunSeq          ]|(cycle:65688  )| before
[DmacRunSeq          ]|(cycle:65689  )| Writing to SYSDMASRCADDRLO=01080012
continuation detail
[DmacRunSeq          ]|(cycle:65690  )| after
```
Choose **Time / Cycle Range...**, select **Cycle Count (RTL / DMAC)**, keep the preset capture, and set both bounds to `65689`. With inheritance enabled, Focus Mode includes the write and its continuation; with exclusion selected, only the write remains. Verify the timestamp preview says `65689 cycles`, original-line links work, and **Time / Cycle Summary** reports three timestamped lines. Clear the range afterward.

## Step-by-Step Testing Instructions

### 1. Open the test log file
- Open `test-log.txt` in VS Code

### 2. Set up the extension views
- Look for "Smart Log Highlighter" in the Activity Bar (left sidebar) - click it
- In the Explorer, you should see "Filters+" and "Filters-" sections

### 3. Create a filter group
- In the "Filters+" section, click the "Add Group" button (folder with plus icon)
- Name it "Errors" when prompted

### 4. Add a filter to the group
- Click the "+" button next to your "Errors" group
- Enter this regex pattern: `ERROR`
- The filter should appear under the group

### 5. Enable the filter for visibility (IMPORTANT!)
- Look for an eye icon next to your filter
- If it's closed (eye-closed), click it to enable visibility
- The eye should be open, indicating the filter is visible in focus mode

### 6. Test Focus Mode
- With `test-log.txt` open, press `Ctrl+H` (or `Cmd+H` on Mac)
- OR click the Focus Mode button (symbol-keyword icon) in the Filters+ section
- A new tab should open showing only lines matching "ERROR"

### 7. Test the no-underline feature
- In the focus mode tab, hover over the lines
- Lines should be clickable (pointer cursor) but WITHOUT underlines
- Click on any line to jump back to the original file

### Expected Results:
- Focus mode should show only error lines from the log
- Lines should be clickable without underlines
- Clicking should navigate to the original file location

### Troubleshooting:
- If focus mode shows empty: Make sure filters have visibility enabled (open eye icon)
- If no groups appear: Try clicking the refresh button in the extension panel
- If extension doesn't load: Check VS Code's Output panel for errors

### Test Log Content Reference:
The test log contains these ERROR lines that should appear in focus mode:
- Line 5: "2025-11-05 10:00:05 ERROR Failed to connect to database"
- Line 11: "2025-11-05 10:00:11 ERROR Disk space low: 2% remaining"