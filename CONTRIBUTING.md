# Contributing to Log Analysis Gamma

We always welcome your contributions! This project aims to enhance log analysis capabilities with innovative features while maintaining high performance and usability. Please refer to the guidelines below before contributing to this repository.

## 🎯 Project Vision

Log Analysis Gamma is focused on:
- **Performance excellence** - Features that improve speed and efficiency
- **Team collaboration** - Tools that work well in team environments  
- **User experience** - Intuitive interfaces and workflows
- **Innovation** - Testing new features before contributing back to the main project

## 🚀 Recent Major Features (v1.5.0)

We've just released major enhancements in:
- **Unified Project Settings System** - Single JSON format for team collaboration
- **Performance Revolution** - Up to 90% improvement with selective processing
- **Smart Editor Selection** - Intelligent processing strategies
- **Enhanced UI Organization** - Improved view structure and commands

## 🛠️ Development Setup

### Prerequisites
- VS Code 1.85.1 or higher
- Node.js 14.x or higher
- TypeScript 4.0 or higher

### Getting Started
1. Fork and clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the project
4. Press F5 to launch the Extension Development Host
5. Test your changes in the development environment

## 📋 Coding Convention

This project uses **VSCode's built-in formatter** for code styling. Please ensure that you use the default VSCode settings or the project's defined configuration to maintain consistent code formatting.

**Ensure format on save is enabled** in your VSCode settings for consistent code formatting:

```json
"editor.formatOnSave": true
```

### Code Quality Standards
- **TypeScript/JavaScript**: We use ESLint for additional linting
- **Performance focus**: Consider performance impact of new features
- **Memory management**: Proper cleanup of decorations and event listeners
- **Error handling**: Comprehensive error handling with user-friendly messages
- **Documentation**: Clear comments for complex logic, especially performance-critical sections

### Architecture Guidelines
- **State management**: Use the central State object for extension state
- **Performance optimization**: Consider selective processing patterns (see v1.5.0 editor selection strategies)
- **Team collaboration**: Design features with sharing and collaboration in mind
- **Backward compatibility**: Maintain compatibility with existing configurations

## 🎯 Priority Contribution Areas

### High Priority
- **File-specific filters** - Different filter sets for different file types
- **Performance analytics** - Detailed metrics and optimization suggestions
- **Filter templates** - Predefined filter sets for common log formats
- **Multi-file analysis** - Apply filters across multiple files

### Medium Priority  
- **Time-based filtering** - Filter by timestamp ranges
- **Statistical analysis** - Show filter match statistics and trends
- **Export functionality** - Save filtered results to new files
- **Integration APIs** - Connect with external log analysis tools

### Innovation Areas
- **AI-powered suggestions** - Auto-suggest filters based on content
- **Cloud sync** - Sync configurations across devices
- **Filter marketplace** - Community filter sharing
- **Streaming processing** - Handle extremely large files

## 📝 Pull Request (PR) Guidelines

### Before Submitting
- Ensure your branch is up-to-date with the latest `beta` branch
- Run `npm run compile` to verify TypeScript compilation
- Test your changes with various log file types and sizes
- Consider performance impact, especially with large files or many open editors

### PR Requirements
- **Clear description** of changes and purpose
- **One feature per PR** for easy review and testing
- **Performance testing** results if applicable
- **Documentation updates** for user-facing changes
- **Backward compatibility** verification

### PR Template
```
## Description
Brief description of the change and its purpose.

## Type of Change
- [ ] Bug fix
- [ ] New feature  
- [ ] Performance improvement
- [ ] Documentation update
- [ ] Breaking change

## Performance Impact
- [ ] No performance impact
- [ ] Performance improvement (include metrics)
- [ ] Potential performance impact (explain mitigation)

## Testing
- [ ] Tested with small log files
- [ ] Tested with large log files (>10MB)
- [ ] Tested with multiple open editors
- [ ] Tested team collaboration features (if applicable)

## Screenshots/Examples
Include screenshots or examples of the change in action.
```

## 🔄 Merge Strategy

This project uses the **rebase strategy** when merging pull requests to maintain a clean commit history. Your PR must be conflict-free with the latest `beta` branch. Please ensure your branch is rebased onto the latest `beta` before submitting your PR.

## 🧪 Testing Guidelines

### Manual Testing
- Test with various log file formats (.log, .txt, .out, .err, .trace)
- Verify performance with multiple open editors
- Test team collaboration features (load/save unified settings)
- Verify UI changes across different themes

### Performance Testing
- Monitor CPU usage with large files
- Test memory consumption with many filters
- Verify selective editor processing works correctly
- Check that performance settings interface functions properly

## 📚 Documentation

When contributing:
- Update README.md for user-facing features
- Update CHANGELOG.md with your changes
- Add or update code comments for complex logic
- Update roadmap.md if completing roadmap items

## 🤝 Community

- **Issues**: Report bugs or request features via GitHub Issues
- **Discussions**: Use GitHub Discussions for questions and ideas
- **Feedback**: User feedback is valuable for prioritizing development

## 📄 License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing to Log Analysis Gamma! Your contributions help make log analysis better for everyone. 🚀
