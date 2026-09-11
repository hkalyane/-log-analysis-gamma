# Marketplace Images

This directory contains visual assets for the VS Code Marketplace listing.

## Image Guidelines for VS Code Marketplace

1. **Main Icon**: 128x128px PNG (already in package.json)
2. **Screenshots**: 1200x800px or 16:9 ratio recommended
3. **Feature Highlights**: Clear, high-contrast images
4. **Interface Examples**: Show actual VS Code interface

## Current Assets

- `demo-highlighting.gif` / `demo-highlighting.png`: actual highlight off/on states with regex filter colors and match counts. GIF: 3 frames, 6.4 seconds.
- `demo-bookmarks.gif` / `demo-bookmarks.png`: adding a note, blue gutter marker, color swatches, orange marker, and safe note hover. GIF: 5 frames, 11.4 seconds.
- `demo-time-range.gif` / `demo-time-range.png`: cycle profile, capture regex, inclusive 65689-65691 bounds, continuation policy, parsed confirmation, and ranged Focus Mode result. GIF: 7 frames, 16.1 seconds.
- `demo-focus-mode.gif` / `demo-focus-mode.png`: full source log followed by focused register-write/error/warning matches. GIF: 2 frames, 6 seconds.

These demos appear immediately below the badges at the start of the root README. PNG alternatives provide a non-animated, full-resolution view.

## Capture Details

- Captured on 2026-09-11 from the actual extension development build in VS Code 1.137.0, using a separate user-data directory and a synthetic `dma-simulation.log`. No user logs or credentials are included.
- All images are 1440x820 pixels. GIFs loop real workbench screenshots with deliberate pauses between actions; they are not rendered mockups. Each GIF is under 500 KiB.
- The demo has visible filters for `ERROR`, `WARN`, and `Writing to`, with a `DEBUG` exclusion. The bookmark is on the DMA timeout at cycle 65691.
- The time-range demo applies cycles 65689-65691 while regular filters remain enabled. Consequently its final view contains the three matching timestamped lines, not every continuation line.
- Record via the native Command Palette, filter toolbar, and bookmark color picker. The time confirmation uses VS Code's supported custom dialog style for headless capture; this does not change the extension's behavior.
- Use an isolated capture profile when regenerating assets. Do not record real project data or change production user settings for documentation screenshots.