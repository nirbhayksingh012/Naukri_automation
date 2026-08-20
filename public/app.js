// App state variables
let appConfig = {};
let isAutomationRunning = false;
let countdownInterval = null;
let eventSource = null;
let isAutoScrollEnabled = true;

// DOM Elements
const badgeSystemStatus = document.getElementById('badge-system-status');
const metricAutopilot = document.getElementById('metric-autopilot');
const metricLastStatus = document.getElementById('metric-last-status');
const metricLastTime = document.getElementById('metric-last-time');
const metricHeadline = document.getElementById('metric-headline');
const countdownTimer = document.getElementById('countdown-timer');
const countdownProgress = document.getElementById('countdown-progress');

const btnToggle = document.getElementById('btn-toggle');
const btnRunNow = document.getElementById('btn-run-now');
const btnLoginHelper = document.getElementById('btn-login-helper');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnToggleScroll = document.getElementById('btn-toggle-scroll');

const settingsForm = document.getElementById('settings-form');
const minIntervalInput = document.getElementById('min-interval');
const maxIntervalInput = document.getElementById('max-interval');
const consoleOutput = document.getElementById('console-output');

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  setupSSE();
  setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
  btnToggle.addEventListener('click', toggleAutopilot);
  btnRunNow.addEventListener('click', runNow);
  btnLoginHelper.addEventListener('click', runLoginHelper);
  
  btnClearLogs.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
  });
  
  btnToggleScroll.addEventListener('click', () => {
    isAutoScrollEnabled = !isAutoScrollEnabled;
    btnToggleScroll.classList.toggle('active', isAutoScrollEnabled);
  });
  
  settingsForm.addEventListener('submit', saveSettings);
}

// Connect to Server-Sent Events for logs and status
function setupSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/logs/stream');

  // Handle standard log messages
  eventSource.onmessage = (event) => {
    const log = JSON.parse(event.data);
    appendLog(log);
  };

  // Handle system state status event
  eventSource.addEventListener('status', (event) => {
    const data = JSON.parse(event.data);
    appConfig = data.config;
    isAutomationRunning = data.isUpdating;
    updateUI();
  });

  eventSource.onerror = (err) => {
    console.error('SSE connection lost. Reconnecting...', err);
    appendLog({
      time: new Date().toLocaleTimeString(),
      text: 'SYSTEM: Connection to server lost. Attempting to reconnect...',
      type: 'error'
    });
    
    setTimeout(setupSSE, 3000);
  };
}

// Append log item to custom terminal
function appendLog(log) {
  const line = document.createElement('div');
  line.className = `log-line ${log.type || 'info'}`;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${log.time}]`;
  
  const contentSpan = document.createElement('span');
  contentSpan.className = 'log-content';
  contentSpan.textContent = log.text;
  
  line.appendChild(timeSpan);
  line.appendChild(contentSpan);
  consoleOutput.appendChild(line);
  
  if (isAutoScrollEnabled) {
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }
}

// Update UI dashboard values
function updateUI() {
  // Update status badge
  badgeSystemStatus.className = 'status-badge';
  const statusBadgeText = badgeSystemStatus.querySelector('.status-text');
  
  if (isAutomationRunning) {
    badgeSystemStatus.classList.add('status-running');
    statusBadgeText.textContent = 'Updating Profile';
    
    // Disable actions during execution
    btnRunNow.disabled = true;
    btnLoginHelper.disabled = true;
  } else if (appConfig.enabled) {
    badgeSystemStatus.classList.add('status-active');
    statusBadgeText.textContent = 'Autopilot Active';
    
    btnRunNow.disabled = false;
    btnLoginHelper.disabled = false;
  } else if (appConfig.lastRunStatus === 'auth_required') {
    badgeSystemStatus.classList.add('status-warning');
    statusBadgeText.textContent = 'Auth Required';
    
    btnRunNow.disabled = false;
    btnLoginHelper.disabled = false;
  } else {
    badgeSystemStatus.classList.add('status-idle');
    statusBadgeText.textContent = 'Autopilot Idle';
    
    btnRunNow.disabled = false;
    btnLoginHelper.disabled = false;
  }

  // Update labels
  metricAutopilot.textContent = appConfig.enabled ? 'ACTIVE' : 'SUSPENDED';
  metricAutopilot.className = `metric-value ${appConfig.enabled ? 'text-green' : 'text-yellow'}`;

  // Last run status text and color coding
  let statusText = appConfig.lastRunStatus || 'None';
  let statusClass = 'metric-value text-gray';
  
  if (statusText === 'success') {
    statusText = 'SUCCESS';
    statusClass = 'metric-value text-green';
  } else if (statusText === 'running') {
    statusText = 'REFRESHING...';
    statusClass = 'metric-value text-green';
  } else if (statusText === 'auth_required') {
    statusText = 'AUTH REQUIRED';
    statusClass = 'metric-value text-red';
  } else if (statusText === 'profile_load_failed') {
    statusText = 'LOAD FAILED';
    statusClass = 'metric-value text-red';
  } else if (statusText !== 'idle' && statusText !== 'None') {
    statusText = 'FAILED';
    statusClass = 'metric-value text-red';
  }
  
  metricLastStatus.textContent = statusText;
  metricLastStatus.className = statusClass;

  // Last update timestamp
  if (appConfig.lastRunTime) {
    const lastDate = new Date(appConfig.lastRunTime);
    metricLastTime.textContent = lastDate.toLocaleTimeString();
  } else {
    metricLastTime.textContent = 'Never';
  }

  // Headline
  metricHeadline.textContent = appConfig.currentHeadline || 'N/A';
  metricHeadline.title = appConfig.currentHeadline || 'Not fetched yet';

  // Toggle button styling & text
  if (appConfig.enabled) {
    btnToggle.className = 'btn btn-secondary btn-full';
    btnToggle.querySelector('span').textContent = 'Suspend Autopilot';
    // Change SVG inside toggle button to a pause sign
    btnToggle.querySelector('.btn-svg').innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
  } else {
    btnToggle.className = 'btn btn-primary btn-full';
    btnToggle.querySelector('span').textContent = 'Enable Autopilot';
    // Change SVG inside to a play symbol
    btnToggle.querySelector('.btn-svg').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
  }

  // Sync inputs if not focused
  if (document.activeElement !== minIntervalInput) {
    minIntervalInput.value = appConfig.minInterval || 10;
  }
  if (document.activeElement !== maxIntervalInput) {
    maxIntervalInput.value = appConfig.maxInterval || 30;
  }

  // Start/Stop countdown visual loop
  startCountdownLoop();
}

// Countdown Progress bar logic
function startCountdownLoop() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  if (!appConfig.enabled || !appConfig.nextRunTime || isAutomationRunning) {
    countdownTimer.textContent = '--:--';
    countdownProgress.style.width = '0%';
    return;
  }

  const nextTime = new Date(appConfig.nextRunTime).getTime();
  const lastTime = appConfig.lastRunTime ? new Date(appConfig.lastRunTime).getTime() : (nextTime - (appConfig.minInterval * 60 * 1000));
  const totalDuration = nextTime - lastTime;

  function updateCountdown() {
    const now = Date.now();
    const timeLeft = nextTime - now;

    if (timeLeft <= 0) {
      countdownTimer.textContent = '00:00';
      countdownProgress.style.width = '100%';
      clearInterval(countdownInterval);
      return;
    }

    // Format minutes and seconds
    const minutes = Math.floor(timeLeft / (60 * 1000));
    const seconds = Math.floor((timeLeft % (60 * 1000)) / 1000);
    countdownTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Fill progress bar (grows from 0% to 100% as time progresses)
    const elapsed = now - lastTime;
    const progressPercent = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
    countdownProgress.style.width = `${progressPercent}%`;
  }

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

// Autopilot enablement toggle handler
async function toggleAutopilot() {
  try {
    const res = await fetch('/api/toggle', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      appConfig = data.config;
      updateUI();
    }
  } catch (err) {
    console.error('Failed to toggle autopilot', err);
  }
}

// Direct Manual Update trigger
async function runNow() {
  try {
    const res = await fetch('/api/run-now', { method: 'POST' });
    if (res.ok) {
      appendLog({
        time: new Date().toLocaleTimeString(),
        text: 'SYSTEM: Requested immediate update. Triggering automation...',
        type: 'info'
      });
    } else {
      const data = await res.json();
      alert(data.error || 'Server is currently busy.');
    }
  } catch (err) {
    console.error('Failed to trigger manual update', err);
  }
}

// Launch Playwright visible login helper
async function runLoginHelper() {
  try {
    const res = await fetch('/api/login-helper', { method: 'POST' });
    if (res.ok) {
      appendLog({
        time: new Date().toLocaleTimeString(),
        text: 'SYSTEM: Visual browser launch command received.',
        type: 'info'
      });
    }
  } catch (err) {
    console.error('Failed to launch login helper', err);
  }
}

// Modify configurations settings
async function saveSettings(e) {
  e.preventDefault();
  
  const minInterval = parseInt(minIntervalInput.value);
  const maxInterval = parseInt(maxIntervalInput.value);

  if (minInterval > maxInterval) {
    alert('Min delay cannot be larger than Max delay!');
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ minInterval, maxInterval })
    });
    
    const data = await res.json();
    if (res.ok) {
      appConfig = data.config;
      updateUI();
      appendLog({
        time: new Date().toLocaleTimeString(),
        text: `SYSTEM: Updated random range limits to [${minInterval} min - ${maxInterval} min]`,
        type: 'info'
      });
    } else {
      alert(data.error || 'Failed to update settings');
    }
  } catch (err) {
    console.error('Failed to save settings', err);
  }
}
