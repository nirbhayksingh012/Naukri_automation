#!/bin/bash

# Start Xvfb (virtual X server) in the background
# Display :99 is conventional; -screen 0 sets resolution
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &

# Wait briefly for Xvfb to initialize
sleep 1

# Set DISPLAY so Playwright/Chromium can find the virtual display
export DISPLAY=:99

# Start the Node.js server (exec replaces the shell so signals are forwarded)
exec node server.js
