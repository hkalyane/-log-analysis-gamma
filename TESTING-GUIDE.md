# Log Analysis Gamma - Testing Guide

## Step-by-Step Testing Instructions

### 1. Open the test log file
- Open `test-log.txt` in VS Code

### 2. Set up the extension views
- Look for "Log Analysis Gamma" in the Activity Bar (left sidebar) - click it
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