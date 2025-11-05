# Project Setup Guide

## Why you see just "FILTERS+" instead of project name

The extension uses a project-based system to manage different filter configurations. When no project is selected, it defaults to showing just "Filters+" and "Filters-".

## Quick Fix Steps:

### 1. Open Project Panel
- Look for "Log Analysis Gamma" in the Activity Bar (left sidebar)
- Click on it to open the Projects management panel

### 2. Create a New Project
- Click the "Add Project" button (folder with plus icon)
- Enter a project name like "My Log Analysis Project"
- Press Enter

### 3. Select the Project
- Click on your newly created project in the list
- It should highlight/select the project

### 4. Verify the Change
- Go back to Explorer panel
- You should now see "Filters+ (My Log Analysis Project)" instead of just "Filters+"

### 5. Save Your Current Filters to Project
- Go to the Filters+ panel
- Click the "Save groups to project" button (save-as icon)
- This will save your current filter configuration to the selected project

## Benefits of Using Projects:
- Different projects can have different filter configurations
- Easily switch between different log analysis setups
- Filters are persistent and organized by project
- Great for working with different applications/services that have different log formats

## Troubleshooting:
- If you don't see the Activity Bar icon, try reloading VS Code
- If projects don't save, check VS Code's output panel for errors
- The project name appears in parentheses next to "Filters+"