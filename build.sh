#!/bin/bash

# Style Me Chrome Extension Build Script

echo "Building Style Me Chrome Extension..."

# Create dist directory if it doesn't exist
mkdir -p dist

# Copy source files to dist
echo "Copying source files..."

# Copy background script
cp -r src/background dist/

# Copy content scripts
cp -r src/content dist/

# Copy lib files
cp -r src/lib dist/

# Copy popup files
cp -r src/popup dist/

# Copy manifest
cp public/manifest.json dist/

# Copy icons
cp -r public/icons dist/

echo "Build complete! Files copied to dist/ folder."
echo "You can now load the extension from the dist/ folder in Chrome."
