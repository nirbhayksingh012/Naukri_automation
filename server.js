const express = require('express');
const fs = require('fs');
const path = require('path');
const { updateProfile, launchLoginHelper, exportSessionState } = require('./automation');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const STATE_FILE = path.join(__dirname, 'state.json');

// Pre-load session from environment variable if available (for cloud hosting)
if (process.env.NAUKRI_SESSION_JSON) {
  try {
    fs.writeFileSync(STATE_FILE, process.env.NAUKRI_SESSION_JSON, 'utf8');
    console.log('[SUCCESS] Successfully loaded session state from environment variable NAUKRI_SESSION_JSON.');
  } catch (err) {
    console.error('[ERROR] Failed to write session state from NAUKRI_SESSION_JSON:', err);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// State variables
let config = {
  enabled: false,
  minInterval: 15,
  maxInterval: 30,
  lastRunStatus: 'idle',
  lastRunTime: null,
  nextRunTime: null,
  currentHeadline: ''
};

let logs = [];
let sseClients = [];
let schedulerTimeout = null;
let isUpdating = false;

// Initialize config from file
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    config = { ...config, ...JSON.parse(data) };
  } catch (err) {
    console.error('Error reading config file, using defaults.', err);
  }
} else {
  saveConfig();
}

// Environmental variables take precedence (vital for cloud hosting)
if (process.env.AUTOPILOT_ENABLED !== undefined) {
  config.enabled = process.env.AUTOPILOT_ENABLED === 'true';
} else {
  // On local start, ensure autopilot is initially disabled unless env specifies it
  config.enabled = false;
}

if (process.env.MIN_INTERVAL) {
  config.minInterval = parseInt(process.env.MIN_INTERVAL) || config.minInterval;
}
if (process.env.MAX_INTERVAL) {
  config.maxInterval = parseInt(process.env.MAX_INTERVAL) || config.maxInterval;
}

config.nextRunTime = null;
config.lastRunStatus = 'idle';
saveConfig();

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config.json', err);
  }
}

// Log utility
function logMessage(text, type = 'info') {
  const logLine = {
    time: new Date().toLocaleTimeString(),
    text,
    type
  };
  logs.push(logLine);
  if (logs.length > 150) {
    logs.shift();
  }

  // Print to node console
  const colors = {
    info: '\x1b[36m', // Cyan
    success: '\x1b[32m', // Green
    warning: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
    reset: '\x1b[0m'
  };
  console.log(`${colors[type] || ''}[${type.toUpperCase()}] [${logLine.time}] ${text}${colors.reset}`);

  // Broadcast to all SSE clients
  sseClients.forEach(client => {
    client.write(`data: ${JSON.stringify(logLine)}\n\n`);
  });
}

// Scheduler Logic
function scheduleNextRun() {
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
  }

  if (!config.enabled) {
    config.nextRunTime = null;
    saveConfig();
    return;
  }

  // Calculate random time between min and max minutes
  const min = Math.min(config.minInterval, config.maxInterval);
  const max = Math.max(config.minInterval, config.maxInterval);
  const intervalMinutes = Math.random() * (max - min) + min;
  const intervalMs = Math.round(intervalMinutes * 60 * 1000);

  const targetTime = new Date(Date.now() + intervalMs);
  config.nextRunTime = targetTime.toISOString();
  saveConfig();

  logMessage(`Next auto-refresh scheduled in ${intervalMinutes.toFixed(1)} minutes (at ${targetTime.toLocaleTimeString()})`, 'info');

  schedulerTimeout = setTimeout(async () => {
    logMessage('Scheduler triggered auto-refresh sequence...', 'info');
    await performUpdate();
  }, intervalMs);
}

async function performUpdate() {
  if (isUpdating) {
    logMessage('Update skipped: automation already running.', 'warning');
    return;
  }

  isUpdating = true;
  config.lastRunStatus = 'running';
  saveConfig();
  
  // Stream status update to SSE clients
  broadcastStatus();

  try {
    const result = await updateProfile(logMessage, true); // Headless mode
    
    config.lastRunTime = new Date().toISOString();
    
    if (result.success) {
      config.lastRunStatus = 'success';
      config.currentHeadline = result.headline;
      logMessage(`Autopilot profile update completed successfully!`, 'success');
    } else {
      config.lastRunStatus = result.error;
      logMessage(`Autopilot profile update failed with error: ${result.error}`, 'error');
      
      // If auth is required, we turn off autopilot to prevent loop spamming on login screen
      if (result.error === 'auth_required') {
        config.enabled = false;
        logMessage('Autopilot turned OFF due to expired credentials/session. Please use Login Helper.', 'warning');
      }
    }
  } catch (err) {
    config.lastRunStatus = 'error';
    logMessage(`Exception in background scheduler: ${err.message}`, 'error');
  } finally {
    isUpdating = false;
    saveConfig();
    
    // Broadcast updated status to everyone
    broadcastStatus();

    // Re-schedule next run if still enabled
    if (config.enabled) {
      scheduleNextRun();
    }
  }
}

function broadcastStatus() {
  sseClients.forEach(client => {
    client.write(`event: status\ndata: ${JSON.stringify({ config, isUpdating })}\n\n`);
  });
}

// API Routes

// SSE endpoint for live logs and status events
app.get('/api/logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send initial historical logs
  logs.forEach(log => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  // Send initial status event
  res.write(`event: status\ndata: ${JSON.stringify({ config, isUpdating })}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Get current system status
app.get('/api/status', (req, res) => {
  res.json({
    config,
    isUpdating
  });
});

// Update schedule interval settings
app.post('/api/settings', (req, res) => {
  const { minInterval, maxInterval } = req.body;
  
  const min = parseInt(minInterval);
  const max = parseInt(maxInterval);

  if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0 || min > max) {
    return res.status(400).json({ error: 'Invalid interval settings. Intervals must be positive and min <= max.' });
  }

  config.minInterval = min;
  config.maxInterval = max;
  saveConfig();
  
  logMessage(`Settings updated: Refresh interval set to range ${min}-${max} minutes.`, 'info');
  
  // If scheduler is active, re-schedule with new parameters
  if (config.enabled) {
    logMessage('Autopilot schedule re-calculating under new intervals...', 'info');
    scheduleNextRun();
  }

  broadcastStatus();
  res.json({ success: true, config });
});

// Toggle autopilot scheduler on/off
app.post('/api/toggle', (req, res) => {
  config.enabled = !config.enabled;
  saveConfig();

  logMessage(`Autopilot autopilot set to: ${config.enabled ? 'ENABLED' : 'DISABLED'}`, 'info');

  if (config.enabled) {
    scheduleNextRun();
  } else {
    if (schedulerTimeout) {
      clearTimeout(schedulerTimeout);
      schedulerTimeout = null;
    }
    config.nextRunTime = null;
    saveConfig();
    logMessage('Autopilot background scheduler suspended.', 'info');
  }

  broadcastStatus();
  res.json({ success: true, config });
});

// Trigger an immediate manual update run
app.post('/api/run-now', async (req, res) => {
  if (isUpdating) {
    return res.status(503).json({ error: 'Automation is already in progress.' });
  }

  logMessage('Manual refresh triggered by user.', 'info');
  
  // Perform asynchronously
  performManualUpdate();
  
  res.json({ success: true, message: 'Refresh process started.' });
});

async function performManualUpdate() {
  isUpdating = true;
  config.lastRunStatus = 'running';
  saveConfig();
  broadcastStatus();

  try {
    const result = await updateProfile(logMessage, true); // Headless mode
    config.lastRunTime = new Date().toISOString();
    
    if (result.success) {
      config.lastRunStatus = 'success';
      config.currentHeadline = result.headline;
      logMessage(`Manual profile update completed successfully!`, 'success');
    } else {
      config.lastRunStatus = result.error;
      logMessage(`Manual profile update failed: ${result.error}`, 'error');
    }
  } catch (err) {
    config.lastRunStatus = 'error';
    logMessage(`Exception during manual update: ${err.message}`, 'error');
  } finally {
    isUpdating = false;
    saveConfig();
    broadcastStatus();
  }
}

// Start visual login helper
app.post('/api/login-helper', (req, res) => {
  if (isUpdating) {
    return res.status(503).json({ error: 'Automation or browser session is already active.' });
  }

  isUpdating = true;
  config.lastRunStatus = 'logging_in';
  saveConfig();
  broadcastStatus();

  logMessage('Launching visual login window...', 'info');
  
  launchLoginHelper(
    logMessage,
    () => {
      config.lastRunStatus = 'logged_in';
      saveConfig();
      broadcastStatus();
    },
    () => {
      isUpdating = false;
      if (config.lastRunStatus === 'logging_in') {
        config.lastRunStatus = 'idle';
      }
      saveConfig();
      broadcastStatus();
    }
  );

  res.json({ success: true, message: 'Visual browser launched.' });
});

// Export browser session state
app.post('/api/session/export', async (req, res) => {
  if (isUpdating) {
    return res.status(503).json({ error: 'Automation is currently in progress. Please wait.' });
  }

  isUpdating = true;
  config.lastRunStatus = 'exporting_session';
  broadcastStatus();

  try {
    const sessionState = await exportSessionState(logMessage);
    
    // Save to state.json locally too
    fs.writeFileSync(STATE_FILE, JSON.stringify(sessionState, null, 2), 'utf8');
    
    logMessage('Session state exported successfully.', 'success');
    res.json({ success: true, sessionState });
  } catch (err) {
    logMessage(`Session export failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  } finally {
    isUpdating = false;
    config.lastRunStatus = 'idle';
    saveConfig();
    broadcastStatus();
  }
});

// Import browser session state
app.post('/api/session/import', async (req, res) => {
  if (isUpdating) {
    return res.status(503).json({ error: 'Automation is currently in progress. Please wait.' });
  }

  const { sessionState } = req.body;
  if (!sessionState || typeof sessionState !== 'object') {
    return res.status(400).json({ error: 'Invalid session state format. Must be JSON.' });
  }

  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(sessionState, null, 2), 'utf8');
    logMessage('New session state imported successfully! Pre-loaded state.json.', 'success');
    res.json({ success: true, message: 'Session imported successfully.' });
  } catch (err) {
    logMessage(`Session import failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

// Start express server
app.listen(PORT, () => {
  logMessage(`Naukri Auto-Updater Service running at http://localhost:${PORT}`, 'success');
  logMessage('Open the link above in your web browser to access the control panel dashboard.', 'info');

  // Auto-start scheduler if enabled on startup
  if (config.enabled) {
    logMessage('Autopilot is enabled on startup. Initializing background scheduler...', 'info');
    scheduleNextRun();
  }
});
