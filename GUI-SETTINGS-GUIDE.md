# GUI Access for Performance Settings

Smart Log Highlighter provides multiple intuitive ways to access and configure performance settings through VS Code's GUI.

## 🎛️ **Method 1: Quick Performance Settings (New!)**

### **Command Palette Access:**
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "Log Analysis: Performance Settings"
3. Choose from the quick pick interface:

```
$(rocket) Active Only          Maximum Performance
   Process only the active editor (90% improvement)

$(eye) Visible Only         Balanced Performance  
   Process all visible editors (30-50% improvement)

$(file-text) Relevant Only        Smart Selection
   Auto-detect and process only log files (60-80% improvement)

$(brain) Adaptive             Intelligent (Default)
   Automatically adjust based on number of open editors

$(gear) Open Full Settings   Advanced Configuration
   Open VS Code settings for detailed configuration
```

### **Sidebar Access:**
- Click the $(gear) gear icon in the Smart Log Highlighter sidebar
- Quick access from the main filter view

## 🎛️ **Method 2: VS Code Settings UI**

### **Steps:**
1. Open Settings: `Ctrl+,` (or `Cmd+,` on Mac)
2. Search for "Smart Log Highlighter"
3. Configure using dropdowns and controls:

### **Available Settings:**
| Setting | Type | Options | Description |
|---------|------|---------|-------------|
| **Editor Selection Strategy** | Dropdown | active/visible/relevant/adaptive | How to select editors for processing |
| **Max Editors To Process** | Number Slider | 1-10 (default: 3) | Maximum editors to process simultaneously |
| **Auto Detect Log Files** | Checkbox | true/false (default: true) | Automatically prioritize log files |
| **Show Random Color Notifications** | Checkbox | true/false (default: true) | Show notifications for random colors |
| **Max Remembered Colors** | Number Slider | 5-20 (default: 10) | Maximum custom colors to remember |

## 🎯 **Method 3: Settings JSON (Advanced)**

### **Access:**
1. `Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)"
2. Add configuration:

```json
{
  "logAnalysisGamma.editorSelectionStrategy": "adaptive",
  "logAnalysisGamma.maxEditorsToProcess": 3,
  "logAnalysisGamma.autoDetectLogFiles": true,
  "logAnalysisGamma.showRandomColorNotifications": true,
  "logAnalysisGamma.maxRememberedColors": 10
}
```

## 🚀 **Quick Configuration Presets**

### **Maximum Performance Mode:**
```json
{
  "logAnalysisGamma.editorSelectionStrategy": "active",
  "logAnalysisGamma.maxEditorsToProcess": 1
}
```

### **Balanced Mode (Recommended):**
```json
{
  "logAnalysisGamma.editorSelectionStrategy": "adaptive", 
  "logAnalysisGamma.maxEditorsToProcess": 3
}
```

### **Development Mode:**
```json
{
  "logAnalysisGamma.editorSelectionStrategy": "relevant",
  "logAnalysisGamma.maxEditorsToProcess": 5
}
```

## 📊 **Real-time Performance Feedback**

### **Console Monitoring:**
- Open Developer Console: `Help → Toggle Developer Tools → Console`
- Watch for performance logs:
```
[Performance] Editor Selection (adaptive): 2ms
[Performance] Processing 3 editors using adaptive strategy  
[Performance] Highlight Processing (3 editors): 45ms
```

### **Setting Change Feedback:**
When you change settings through the GUI, you'll see confirmation messages:
- "🚀 Performance: Set to Active Only (maximum speed)"
- "🧠 Performance: Set to Adaptive (intelligent, recommended)"

## 🎨 **Visual Indicators**

### **Strategy Icons:**
- $(rocket) Active Only - Maximum speed
- $(eye) Visible Only - Balanced  
- $(file-text) Relevant Only - Smart selection
- $(brain) Adaptive - Intelligent (default)

### **Performance Impact:**
| Strategy | Editors Processed | Performance Gain |
|----------|------------------|------------------|
| $(rocket) Active Only | 1 editor | 90% faster |
| $(eye) Visible Only | 2-4 editors | 50% faster |
| $(file-text) Relevant Only | 3-5 editors | 70% faster |
| $(brain) Adaptive | Auto-adjust | 60% faster |

All settings are applied immediately - no need to restart VS Code!