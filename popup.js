document.addEventListener('DOMContentLoaded', function() {
  const summarizeBtn = document.getElementById('summarizeBtn');
  const exportBtn = document.getElementById('exportBtn');
  const copyBtn = document.getElementById('copyBtn');
  const clearBtn = document.getElementById('clearBtn');
  const loading = document.getElementById('loading');
  const output = document.getElementById('output');
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');
  const totalSitesElement = document.getElementById('totalSites');
  const historyDateInput = document.getElementById('historyDate');

  // Function to format date to yyyy-MM-dd (for input element)
  function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
  }

  // Function to format date to DD-MM-YYYY (for display)
  function formatDateForDisplay(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // Function to parse DD-MM-YYYY to Date object
  function parseDateString(dateStr) {
    const [day, month, year] = dateStr.split('-');
    return new Date(year, month - 1, day);
  }

  // Set default date to today
  const today = new Date();
  historyDateInput.max = formatDateForInput(today);
  historyDateInput.value = formatDateForInput(today);

  // Function to update stats for selected date
  function updateStats(selectedDate) {
    const date = new Date(selectedDate); // Now works with yyyy-MM-dd format
    const startTime = new Date(date);
    startTime.setHours(0, 0, 0, 0);
    const endTime = new Date(date);
    endTime.setHours(23, 59, 59, 999);

    chrome.history.search({
      text: '',
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      maxResults: 10000
    }, async function(historyItems) {
      const domains = new Set();

      // Get detailed visit information for each history item
      for (const item of historyItems) {
        try {
          if (!item.url || item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) {
            continue;
          }

          const url = new URL(item.url);
          domains.add(url.hostname);
        } catch (error) {
          console.error('Error processing history item:', error);
        }
      }

      // Update UI
      totalSitesElement.textContent = domains.size.toString();

      // Store the latest stats
      chrome.storage.local.set({
        'lastStats': {
          totalSites: domains.size,
          timestamp: Date.now(),
          date: selectedDate
        }
      });
    });
  }

  // Update stats when date changes
  historyDateInput.addEventListener('change', function() {
    updateStats(this.value);
  });

  // Initial stats update
  updateStats(historyDateInput.value);

  // Load saved output if it exists
  chrome.storage.local.get(['timesheetSummary', 'timesheetOutput'], function(result) {
    if (result.timesheetSummary) {
      renderSummary(result.timesheetSummary);
      copyBtn.disabled = false;
      clearBtn.disabled = false;
    } else {
      if (result.timesheetOutput) {
        chrome.storage.local.remove(['timesheetOutput']);
      }
      copyBtn.disabled = true;
      clearBtn.disabled = true;
    }
  });

  // Function to show loading message
  function showLoading(message = 'Analyzing your browsing history...') {
    loading.textContent = message;
    loading.style.display = 'block';
    summarizeBtn.disabled = true;
    exportBtn.disabled = true;
  }

  // Function to hide loading message
  function hideLoading() {
    loading.style.display = 'none';
    summarizeBtn.disabled = false;
    exportBtn.disabled = false;
  }

  // Function to show success message
  function showSuccess(message, duration = 3000) {
    successMessage.textContent = message;
    successMessage.style.display = 'block';
    setTimeout(() => {
      successMessage.style.display = 'none';
    }, duration);
  }

  // Function to show error message with user-friendly text
  function showError(message, duration = 5000) {
    const userFriendlyMessages = {
      'No valid browsing activities found to summarize': 'No browsing history found for the selected date. Try selecting a different date.',
      'Network error': 'Unable to connect to the internet. Please check your connection and try again.',
      'Error during summarization': 'Unable to analyze your history right now. Please try again in a few moments.',
      'API error': 'Our service is temporarily unavailable. Please try again later.',
      'Rate limit exceeded': 'You\'ve made too many requests. Please wait a few minutes and try again.',
      'Invalid date': 'Please select a valid date to analyze your history.',
      'Permission denied': 'ChronoLens needs permission to access your history. Please check your extension permissions.',
      'default': 'Something unexpected happened. Please try refreshing the page.'
    };

    // Check for network connectivity
    if (!navigator.onLine) {
      message = 'Network error';
    }

    // If the message is a JSON string containing an error, parse it
    try {
      const parsedMessage = JSON.parse(message);
      if (parsedMessage.error) {
        message = parsedMessage.error;
      }
    } catch (e) {
      // Not a JSON string, use the message as is
    }

    // Get user-friendly message or use default
    const userFriendlyMessage = userFriendlyMessages[message] || userFriendlyMessages.default;
    
    // Show error message with icon
    errorMessage.replaceChildren();
    const icon = document.createElement('i');
    icon.className = 'fas fa-exclamation-circle';
    const messageText = document.createTextNode(` ${userFriendlyMessage}`);
    errorMessage.append(icon, messageText);
    errorMessage.style.display = 'block';
    
    // Hide loading indicator if it's showing
    hideLoading();
    
    // Clear any existing success messages
    successMessage.style.display = 'none';
    
    if (duration) {
      setTimeout(() => {
        errorMessage.style.display = 'none';
      }, duration);
    }
  }

  function ensureOutputStyles() {
    if (document.getElementById('timesheet-output-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'timesheet-output-styles';
    style.textContent = `
      .timesheet-container {
        background: rgba(26, 26, 46, 0.8);
        border-radius: 10px;
        padding: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
      }
      .date-header {
        color: #4a9eff;
        font-size: 1.2em;
        font-weight: 600;
        padding: 4px 0;
        border-bottom: 2px solid #4a9eff;
        margin: 0;
      }
      .timesheet-row {
        display: flex;
        flex-direction: column;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        padding: 8px 12px;
        transition: background 0.3s ease;
        margin: 0;
      }
      .timesheet-row:hover {
        background: rgba(74, 158, 255, 0.1);
      }
      .time-cell {
        color: #4a9eff;
        font-weight: 500;
        margin: 0;
        padding-bottom: 2px;
      }
      .description-cell {
        color: #e6e6e6;
        line-height: 1.4;
        padding-left: 16px;
        border-left: 2px solid rgba(74, 158, 255, 0.3);
        margin: 0;
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeSummaryText(text) {
    if (!text || typeof text !== 'string') {
      console.error('Invalid input for summary rendering:', text);
      return '';
    }

    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    }
    return cleaned;
  }

  function renderSummary(text) {
    ensureOutputStyles();
    output.replaceChildren();

    const cleaned = normalizeSummaryText(text);
    if (!cleaned) {
      return;
    }

    try {
      const data = JSON.parse(cleaned);
      if (!data.dates || !Array.isArray(data.dates)) {
        throw new Error('Invalid response format: missing dates array');
      }

      data.dates.forEach(dateGroup => {
        const container = document.createElement('div');
        container.className = 'timesheet-container';

        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        dateHeader.textContent = `[${dateGroup.date || 'Unknown date'}]`;
        container.appendChild(dateHeader);

        const entries = Array.isArray(dateGroup.entries) ? dateGroup.entries : [];
        entries.forEach(entry => {
          const row = document.createElement('div');
          row.className = 'timesheet-row';

          const timeCell = document.createElement('div');
          timeCell.className = 'time-cell';
          timeCell.textContent = entry?.timeStamp || '';

          const descriptionCell = document.createElement('div');
          descriptionCell.className = 'description-cell';
          descriptionCell.textContent = entry?.description || '';

          row.append(timeCell, descriptionCell);
          container.appendChild(row);
        });

        output.appendChild(container);
      });
    } catch (error) {
      console.error('Error formatting output:', error);
      const container = document.createElement('div');
      container.className = 'timesheet-container';

      const errorSection = document.createElement('div');
      errorSection.className = 'error-section';

      const pre = document.createElement('pre');
      pre.textContent = text;

      errorSection.appendChild(pre);
      container.appendChild(errorSection);
      output.appendChild(container);
    }
  }

  // Handle summarize button click
  summarizeBtn.addEventListener('click', function() {
    const selectedDate = historyDateInput.value;
    if (!selectedDate) {
      errorMessage.textContent = 'Please select a date';
      errorMessage.style.display = 'block';
      return;
    }

    loading.style.display = 'block';
    successMessage.style.display = 'none';
    errorMessage.style.display = 'none';
    output.replaceChildren();

    chrome.runtime.sendMessage({ 
      action: 'summarize',
      date: selectedDate // Send selected date
    }, function(response) {
      loading.style.display = 'none';

      if (response.status === 'success' && response.summary) {
        renderSummary(response.summary);
        copyBtn.disabled = false;
        clearBtn.disabled = false;
        
        chrome.storage.local.set({
          'timesheetSummary': response.summary
        });

        // Convert yyyy-MM-dd to Date for display
        const displayDate = new Date(selectedDate);
        successMessage.textContent = `Summary generated for ${displayDate.toLocaleDateString()}`;
        successMessage.style.display = 'block';
      } else {
        errorMessage.textContent = response.message || 'Failed to generate summary';
        errorMessage.style.display = 'block';
      }
    });
  });

  exportBtn.addEventListener('click', async function() {
    showLoading('Preparing CSV export...');
    const selectedDate = historyDateInput.value;
    if (!selectedDate) {
      showError('Please select a date');
      hideLoading();
      return;
    }

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ 
          action: 'export',
          date: selectedDate  // Send selected date to background script
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response.status === 'error') {
            reject(new Error(response.error));
            return;
          }
          resolve(response);
        });
      });

      showSuccess('Timesheet exported successfully!');
    } catch (error) {
      showError('Failed to export: ' + error.message);
      console.error('Export error:', error);
    } finally {
      hideLoading();
    }
  });

  copyBtn.addEventListener('click', function() {
    const tempTextArea = document.createElement('textarea');
    tempTextArea.value = output.innerText;
    document.body.appendChild(tempTextArea);
    tempTextArea.select();
    
    try {
      document.execCommand('copy');
      showSuccess('Copied to clipboard!');
    } catch (err) {
      showError('Failed to copy: ' + err.message);
    } finally {
      document.body.removeChild(tempTextArea);
    }
  });

  clearBtn.addEventListener('click', function() {
    output.replaceChildren();
    chrome.storage.local.remove(['timesheetSummary', 'timesheetOutput']);
    copyBtn.disabled = true;
    clearBtn.disabled = true;
    showSuccess('Output cleared!');
  });
});
