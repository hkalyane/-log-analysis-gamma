# Log Analysis Gamma

[![Version](https://img.shields.io/vscode-marketplace/v/hkalyane.log-analysis-gamma.svg?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=hkalyane.log-analysis-gamma)
[![Download](https://img.shields.io/visual-studio-marketplace/d/hkalyane.log-analysis-gamma)](https://marketplace.visualstudio.com/items?itemName=hkalyane.log-analysis-gamma)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/hkalyane.log-analysis-gamma)](https://marketplace.visualstudio.com/items?itemName=hkalyane.log-analysis-gamma)
[![Average Rating](https://img.shields.io/vscode-marketplace/r/hkalyane.log-analysis-gamma.svg?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=hkalyane.log-analysis-gamma)

Highlight your logs with colorful filters, and manipulate what to display for better log file reading. This helps you focus on log analysis and use your time efficiently.

This extension is a fork of the [Log Analysis](https://github.com/SoySauceFor3/log-analysis) project, created to introduce and test new features in advance or to implement upcoming requirements. The goal of this project is to eventually contribute these enhancements back to the original Log Analysis project for long-term integration.
We encourage you to freely share any issues or suggestions for improvement you encounter while using this extension. Your feedback is valuable and helps us enhance the project.

## 🚀 What's New in Gamma v1.5.1 - **LATEST RELEASE**

### 🔧 **Configurable File Types for Performance Optimization**
- **Customizable file extensions** for "Relevant Only" strategy - now you control which files get processed!
- **Visual configuration interface** with 18+ predefined log file types organized in categories
- **Real-time updates** - changes apply immediately without restart
- **Enhanced user guidance** - detailed descriptions help you choose the optimal performance strategy

### 📖 **Enhanced User Experience with Professional Interface**
- **Comprehensive strategy guidance** - know exactly when to use each performance option
- **VS Code native icons** throughout (no more emojis) for consistent, professional appearance
- **Detailed tooltips and descriptions** for informed decision-making
- **Organized file type categories** - Primary, Log Levels, Specialized, and System logs

### 📸 **[Visual Features Guide](FEATURES-SHOWCASE.md)** 
See comprehensive screenshots and examples of all features including performance settings, file type configuration, and team collaboration workflows.

## 🚀 What's New in Gamma v1.5.0 - **MAJOR RELEASE**

### 🎯 **Unified Project Settings System** 
- **Revolutionary single JSON format** combining internal projects + external shareable settings
- **Team collaboration ready** - share complete configurations in one file with teammates
- **Import functionality** to migrate existing internal projects to external format
- **Merge capabilities** for collaborative development environments
- **Backward compatible** - existing projects work seamlessly

### ⚡ **Performance Revolution** (Up to 90% Improvement)
- **Selective editor processing** - no more processing ALL open editors
- **Smart editor selection strategies**:
  - **Active**: Maximum performance (process only active editor) - 90% improvement
  - **Visible**: Balanced performance (process visible split-view editors) - 50% improvement  
  - **Relevant**: Smart detection (auto-detect and prioritize log files) - 70% improvement
  - **Adaptive**: Intelligent adjustment (adapts based on number of open editors) - 60% improvement
- **Configurable max editors** to process simultaneously (1-10 editors)
- **Auto log file detection** (.log, .txt, .out, .err, .trace files prioritized)

### 🎨 **Enhanced UI/UX Organization**
- **Projects view moved to top** for better workflow (Projects → Filters+ → EXCLUDE_FILTER)
- **Performance Settings** moved to Projects view with ⚡ lightning icon (was confusing gear)
- **Renamed "Filters-" to "EXCLUDE_FILTER"** for better clarity
- **Simplified unified commands** - no more confusion between project systems
- **Clean interface** with logical grouping and improved navigation

### 🔧 **New Unified Commands**
- `Load Unified Settings` - Load complete configuration from external JSON file
- `Save Unified Settings` - Save everything to unified format (with internal fallback option)
- `Refresh Unified Settings` - Reload from external file
- `Performance Settings` - Quick access to performance configuration with visual options
- `Import Internal Projects` - Migrate existing projects to shareable external format

## Previous Updates - Gamma v1.4.0 to v1.4.4

### 🎲 Complete Color Management System
- **Random Color Generator** - Smart random colors from curated palette or truly random mathematical generation
- **Color Memory System** - Automatically remembers up to 10 recently used custom colors
- **Individual Color Removal** - Remove specific colors with ❌ buttons without clearing entire history
- **Smart UI Refresh** - Color picker automatically updates after changes
- **Custom Hex Input** - Enter any hex color with real-time validation

### 🗑️ Advanced Color Management
- **CRUD Operations** - Full Create, Read, Update, Delete for color memory
- **Visual Feedback** - Clear confirmation messages for all actions
- **Auto-Persistence** - Colors saved globally across all workspaces
- **Configurable Settings** - Control max remembered colors (5-20) and notifications

### 🎨 Interactive Color Picker
- **15 emoji-themed color options** for better visual organization
- **Quick color selection** with intuitive emoji color combinations
- **Instant color preview** when changing filter colors

### 🔗 Enhanced Focus Mode
- **Clean interface** - removed underlines from clickable links while maintaining full functionality
- **Seamless navigation** - click any filtered line to jump to the original location
- **Improved readability** - focus on content without visual distractions

### 🔄 Real-time Updates
- **Automatic refresh** - focus mode updates instantly when filters change
- **Better synchronization** - no more manual refresh needed when adding/editing filters
- **Improved performance** - optimized decoration handling

### 🎯 Enhanced Project Navigation
- **Activity bar integration** - all views moved to dedicated Log Analysis Gamma activity bar
- **Improved project switching** - seamless navigation between different log analysis setups
- **Better organization** - cleaner interface with logical grouping

## Features

- Create filters using regular expressions provided by the user
- Highlight lines that match the filters with **customizable colors using interactive color picker**
- **15 emoji-themed color options** for better visual organization and quick identification
- Focus mode: display only lines that match your filters, hiding everything else for better readability
- **Clean focus mode interface** - clickable links without underlines for improved readability
- Exclude meaningless filters from the filtered content in Focus mode for more accurate log analysis
- Organize filters into groups based on their purpose and apply changes to the entire group collectively
- **Real-time updates** - focus mode refreshes automatically when filters change
- Manage filters on a per-project basis to accommodate different log formats across various devices and frameworks
- Click a filtered line in focus mode to jump directly to its corresponding location in the original document
- **Enhanced project navigation** with dedicated activity bar integration
- **🎯 Unified Project Settings** - Single JSON format combining internal projects with external shareable configurations
- **⚡ Revolutionary Performance** - Up to 90% improvement with selective editor processing and smart strategies
- **🤝 Team Collaboration** - Import/export functionality for sharing complete filter configurations
- **🎛️ Performance Control** - Visual interface for selecting optimal editor processing strategy
- **📁 Enhanced UI Organization** - Improved view structure with Projects at top, logical grouping

## 🎯 Unified Project Settings System

### **What's New in v1.5.0**

The unified project settings system revolutionizes how you manage and share log analysis configurations. No more confusion between internal and external project systems - everything is now unified into a single, powerful JSON format.

### **Key Benefits:**

#### **🤝 Team Collaboration Made Easy**
- **Single file sharing** - Send one JSON file containing complete team configuration
- **Import existing projects** - Migrate your internal projects to shareable external format
- **Merge capabilities** - Combine configurations from multiple team members
- **Version control ready** - JSON files work perfectly with Git and other VCS

#### **⚡ Performance Revolution**
- **Up to 90% performance improvement** with selective editor processing
- **Smart strategies** automatically choose optimal processing approach:
  - **Active**: Process only active editor (maximum performance)
  - **Visible**: Process split-view editors (balanced performance)
  - **Relevant**: Auto-detect log files (smart performance)
  - **Adaptive**: Intelligent adjustment based on open editors (recommended)

#### **📁 Unified File Format**
Your project settings now contain everything in one place:
```json
{
  "editorSelectionStrategy": "adaptive",
  "maxEditorsToProcess": 3,
  "projects": [
    {
      "name": "Production Monitoring",
      "groups": [
        {
          "name": "Error Analysis",
          "filters": [...]
        }
      ]
    }
  ],
  "filters": [...],
  "exclusionFilters": [...]
}
```

#### **🔄 Easy Migration**
1. Click **"Import Internal Projects"** in Projects view
2. Choose **"Create New Unified Settings File"**
3. Save to shared location
4. Team members load the same file
5. Everyone has identical configuration!

#### **🎛️ Performance Settings Interface**
- **Visual selection** of processing strategy with performance impact preview
- **Real-time configuration** without editing JSON manually
- **Automatic optimization** recommendations based on your workflow

## Usage

We distinguish between [Basic Users](#basic-users) and [Advanced Users](#advanced-users) to cater to different user needs and expertise levels. Basic Users focus on simple filter management for log analysis without needing to understand or interact with project features. In contrast, Advanced Users manage multiple projects and filter configurations to handle more complex log analysis scenarios.

### Basic Users

Basic users simply set up and manage filter groups to use for log analysis. The Primary SideBar (`FILTERS+`/`FILTERS-`) is designed for their use, where they can configure filters within these groups without worrying about project management. They can save the filter configurations for reuse, ensuring that settings persist even after restarting VSCode. If users don't need the advanced project management features, they can disable the ActivityBar (`Log Analysis Gamma`) menu for a simpler interface.

#### Basic Operation

The basic operation for log analysis is as follows.

![default_usage](./image/default_usage.gif)

For basic users, log analysis can be performed directly in the `FILTERS+` tab without needing to access the `Log Analysis Gamma` menu. The `FILTERS+` tab, a **NONAME** project is automatically created and used. When saving filters, the project will be saved, and a message confirming the save will appear in the status bar. The tab will display all the necessary filter groups, where users can activate filters or control highlights to focus on log analysis using Focus Mode.

The left editor holds the original document, and all the lines that matches any of the filters have been highlighted. The right editor holds the focus mode of the left document, and notice that the lines which don't match any of the filters' regex are gone. The focus mode is implemented as a virtual document (read-only), and the original document is not modified.

If there are lines in the filtered results that you want to exclude, you can add filters for this purpose in the `FILTERS-` tab.

#### Customization for filters

This extension creates a tab `FILTERS+` in the explorer sidebar. This tab holds all the filters created and allows for filter management.

![filter](./image/filters.png)

##### Group

A group can contain multiple filters, and filters within a group can be controlled collectively. This allows you to group filters suitable for log analysis.
For each group, there are two controls and three attributes:

- add
- regex (name) : change group name
- isHighlighted
- isShown
- remove

##### Filter

The filled/unfilled circle represents the color of the filter and whether the highlight is applied to documents. The text represents the regex of the filter, and the number in a smaller font, if there is one, represents the number of lines that match the regex in the active editor.
For each filter, there is one control and four attributes:

- regex
- isHighlighted
- isShown
- remove

##### Exclusion Filter

This extension also creates a `FILTERS-` tab in the explorer sidebar.

![ex-filter](./image/ex_filters.png)

In this tab, you can add exclusion filters to remove unnecessary information from the focused filter results during log analysis. For exclusion filters, there are two controls and one attribute:

- regex
- isShown
- remove

##### Filter Control

- add
  - add filter in group item
  - add group in `FILTERS+` tab
- remove
  - remove selected filter
  - remove group including filters

##### Filter Properties

- Color: The color is generated randomly, but if you don't like it, you can generate a new filter.
- Regex: You can change the regex by clicking the pencil icon.
- isHighlighted: If true, the lines that match the regex will be highlighted with the filter's color. If false, this filter will be ignored for color highlighting. You can toggle this attribute by clicking the paint bucket icon.
- isShown: Used in focus mode. If true, the lines that match the regex will be kept; if false, the lines will be removed, unless other filters keep the line. You can toggle this attribute by clicking the eye icon.
 If one line matches multiple regexes, because the highlight will overwrite themselves, the final color is not deterministic. However, the line is still counted in all the filters.

#### Focus Mode

You can use `log-analysis-gamma.turnOnFocusMode` command to activate focus mode for the active editor. The command has a default shortcut: `ctrl/cmd + h`, or the second icon located on the top of the tab can achieve the same goal. And as the focus mode is just another tab, you can close focus mode as how you close any vscode tab.

#### Clickable Filtered Result Navigation

In Focus Mode, filtered log lines are now displayed in a read-only virtual document with clickable links. When you click a filtered line, the extension automatically retrieves the original file’s URI and the corresponding line number from an internal mapping. If the original file is already open, the extension focuses on that editor and scrolls directly to the target line; if not, it opens the original file in a new editor at the specified location. This feature streamlines your log analysis by allowing quick navigation between the focused view and the complete log context.

![navigation](./image/navigation.png)

### Advanced Users

Advanced users can leverage the project management features available. For these users, projects are used as containers for filter groups, allowing them to manage different log analyses across multiple projects. Unlike a physical folder structure, **project** in this extension represents a logical unit for organizing filter configurations based on platform, framework, or log analysis use cases.

Since logs can be accessed independently of any specific workspace or folder, these projects enable users to centralize and consistently manage their filter settings, ensuring they can switch between different log analysis setups without confusion. This flexibility allows advanced users to efficiently manage various log types, such as development logs, QA issue logs, or platform-specific logs, within distinct projects.

This extension also creates a `Log Analysis Gamma` in the ActivityBar.

![new-project](./image/new_project.gif)

In the `Log Analysis Gamma` menu, advanced users can add, remove, or select projects, and the selected project's filter configuration will be reflected in the `FILTERS+` tab. After selecting a project, users will be directed to the `FILTERS+` tab, where you can see the project name. From there, users can click the add group icon to create a group, then add necessary filters within the group. To save the configured project, click the project save icon in the `FILTERS+` tab.

All filters will initially be set to the disabled state when a project is selected and loaded. Clicking the refresh icon in the `Log Analysis Gamma` menu will reload the saved filter information. Advanced users can also modify the filter setup directly by editing the JSON configuration file via the settings gear icon in the `Log Analysis Gamma` menu. (Note: After modifying the JSON file, users must refresh to apply the changes.)

## Handling Huge Files

In VS Code, when opening files larger than 50MB, the use of extensions is restricted to ensure performance and memory efficiency. This limitation helps maintain a responsive and stable environment when handling large files. More details on this can be found in [#31078](https://github.com/microsoft/vscode/issues/31078). By using the extension below, you can enable extension functionality when opening large files, allowing for log analysis.

It works well with [![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/mbehr1.vsc-lfs?color=green&label=vsc-lfs&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=mbehr1.vsc-lfs) to handle large log files.

## Contributing

We welcome contributions! If you would like to contribute, please refer to our [Contributing Guidelines](./CONTRIBUTING.md) for more information on how to get involved.
