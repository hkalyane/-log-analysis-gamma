# Focus Mode Testing Guide

## Test the Line Number Hover and Click Navigation

### Expected Behavior:
1. **Hover over any line** in focus mode → Shows "L:X" (where X is the original line number)
2. **Click on any line** in focus mode → Navigates to original file at that exact line with cursor positioned

### Test Steps:

1. **Open test-log.txt**
2. **Create a filter** (e.g., "ERROR" filter)
3. **Enable visibility** for the filter (eye icon open)
4. **Enter focus mode** (`Ctrl+H`)
5. **Test hover**: Move mouse over any line → Should show "L:5", "L:11", etc.
6. **Test click**: Click on any line → Should jump to original file at that line number

### What Should Happen:

**Hover Test:**
- ✅ Hover shows "L:5" for the first ERROR line
- ✅ Hover shows "L:11" for the second ERROR line
- ✅ No hover on the first empty line

**Click Test:**
- ✅ Click line showing "L:5" → Opens original file, cursor at line 5
- ✅ Click line showing "L:11" → Opens original file, cursor at line 11
- ✅ Line is centered in the editor view
- ✅ Cursor is positioned at the beginning of the target line

### If Not Working:
1. Check that filters have visibility enabled (eye icon open)
2. Ensure you're in a focus mode document (URI starts with focus-gamma:)
3. Try reloading VS Code window (`Ctrl+Shift+P` → "Developer: Reload Window")

### Log File Reference:
- Line 5: "2025-11-05 10:00:05 ERROR Failed to connect to database"
- Line 11: "2025-11-05 10:00:11 ERROR Disk space low: 2% remaining"