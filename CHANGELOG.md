# Change Log

All notable changes to the "log-analysis-gamma" extension will be documented in this file.

## 1.4.3

### 🎲 Random Colors & Memory System
- **🎲 Smart Random Color**: Get random colors from curated palette of beautiful, high-contrast colors
- **🌈 Truly Random Color**: Generate completely random colors with optimal saturation and lightness
- **🧠 Color Memory System**: Automatically remember up to 10 recently used custom colors
- **🕒 Recently Used Section**: Quick access to previously selected colors in the color picker
- **⚙️ Configurable Settings**: Control max remembered colors (5-20) and notification preferences
- **🧹 Clear Memory Command**: "Clear Recently Used Colors" command to reset color history
- **📦 Enhanced Color Picker**: Organized sections for predefined, random, recently used, and custom colors

## 1.4.2

### 🔧 Final Polish & Marketplace Release
- **🎯 Reverted Icon Changes**: Restored original command icons based on user feedback for consistency
- **📦 Marketplace Ready**: Final polished version with all VS Code 1.85.1 compatibility fixes
- **✅ Quality Assurance**: Comprehensive testing and validation of all features
- **📚 Updated Documentation**: Complete changelog and feature documentation for marketplace

## 1.4.1

### � VS Code 1.85.1 Compatibility & Performance Optimization
- **🎨 Enhanced Color Picker**: Added descriptive color names with emojis (🔴 Red, 🟠 Orange, etc.) for better VS Code 1.85.1 compatibility
- **💡 Improved Color Selection**: Added hex codes in description field and helpful detail text for each color option
- **🎯 Custom Color Support**: Added custom color option with hex validation for unlimited color choices
- **⚡ Major Performance Optimization**: Reduced algorithm complexity from O(n³) to O(n²) for large file handling
- **🧠 Document Caching System**: Implemented WeakMap-based caching with automatic cleanup for faster processing
- **🔄 Debounced Refresh**: Added intelligent debouncing to prevent excessive re-rendering
- **📦 Batched Decorations**: Optimized DOM updates with color-based batching for smoother performance

### �📝 Documentation & Marketplace Updates
- **Updated package.json description** with comprehensive feature highlights including color picker and no-underline improvements
- **Enhanced README.md** with complete gamma rebranding and detailed new features documentation
- **Added keywords and categories** for better marketplace discoverability
- **Updated all references** from Beta to Gamma throughout documentation
- **Added "What's New in Gamma v1.4.0" section** highlighting interactive color picker, enhanced focus mode, real-time updates, and improved navigation

## 1.4.0

### ✨ New Features
- **🎨 Interactive Color Picker**: Added 15 emoji-themed color options for better visual organization and quick filter identification
- **🔗 Enhanced Focus Mode**: Removed underlines from clickable links while maintaining full functionality for improved readability
- **🔄 Real-time Updates**: Focus mode now refreshes automatically when filters are added, edited, or deleted
- **🎯 Enhanced Project Navigation**: Moved all views to dedicated Log Analysis Gamma activity bar for better organization

### 🛠️ Technical Improvements
- Added `noUnderlineDecorationType` to State object for centralized decoration management
- Exported `applyNoUnderlineDecoration` function for reusable no-underline decoration logic
- Modified `refreshEditors` function to apply no-underline decorations during focus mode refresh
- Enhanced command structure with gamma naming convention throughout

### 🎨 UI/UX Enhancements
- Interactive color picker with 15 curated emoji color combinations (🔴❤️, 🟠🧡, 🟡💛, etc.)
- Cleaner focus mode interface without visual distractions
- Improved project switching with seamless navigation
- Better synchronization between filter changes and focus mode updates

## 1.3.0

- Filtered results in the focus mode are now clickable, allowing you to jump directly to the corresponding location in the original file.

## 1.2.14

- Fixed issue [#3](https://github.com/JeanTracker/log-analysis-beta/issues/3) with deleting the last project in the "Log Analysis Beta" menu.
- Added confirmation prompt and prevented errors when no project is selected.

## 1.2.13

- Modified the behavior to display the previous label when renaming Filters, Groups, or Projects.

## 1.2.12

- Fixed a bug where the exclusive filter was not being deleted.

## 1.2.11

- Improved UX for the project feature and updated the README
- Changed: The project configuration file location has been moved from the home directory to the extension's global storage directory for better file management and organization.

> **Warning**
> If you have manually accessed or modified the configuration file in the home directory, please be aware that it has now been relocated to the extension's global storage directory.

## 1.2.10

- Resolve conflicts between the official version and Beta version of Log Analysis's focus mode.

## 1.2.9

- Sync PR for Add feature: support for managing groups by project

## 1.2.7

- Performance and UX Improvements

## 1.2.6

- Update Reamde

## 1.2.4

- Add feature: support for exclude filters

## 1.2.2

- Add feature: support for managing groups by project

## 1.2.0

- deploy Log Analysis Beta to marketplace

## 1.0.0

- Initial release
