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

  // Function to update stats
  function updateStats() {
    const endTime = Date.now();
    const startTime = endTime - (24 * 60 * 60 * 1000); // Last 24 hours

    chrome.history.search({
      text: '',
      startTime: startTime,
      endTime: endTime,
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
          timestamp: Date.now()
        }
      });
    });
  }

  // Load saved output if it exists
  chrome.storage.local.get(['timesheetOutput'], function(result) {
    if (result.timesheetOutput) {
      output.innerHTML = result.timesheetOutput;
      copyBtn.disabled = false;
      clearBtn.disabled = false;
    } else {
      copyBtn.disabled = true;
      clearBtn.disabled = true;
    }
  });

  // Update stats every minute
  updateStats();
  setInterval(updateStats, 60000);

  function showLoading(message = 'Analyzing your browsing history...') {
    loading.textContent = message;
    loading.style.display = 'block';
    summarizeBtn.disabled = true;
    exportBtn.disabled = true;
  }

  function hideLoading() {
    loading.style.display = 'none';
    summarizeBtn.disabled = false;
    exportBtn.disabled = false;
  }

  function showSuccess(message, duration = 3000) {
    successMessage.textContent = message;
    successMessage.style.display = 'block';
    setTimeout(() => {
      successMessage.style.display = 'none';
    }, duration);
  }

  function showError(message, duration = 5000) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
    setTimeout(() => {
      errorMessage.style.display = 'none';
    }, duration);
  }

  function formatOutput(text) {
    if (!text || typeof text !== 'string') {
      console.error('Invalid input for formatOutput:', text);
      return '';
    }
    
    try {
      // Clean up the text first
      let formatted = text
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      
      // Split into lines and process
      const lines = formatted.split('\n').filter(line => line.trim());
      console.log('Lines to process:', lines);
      
      let output = '<div class="timesheet-container">';
      let currentDate = null;
      let inTable = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Check for date header [YYYY-MM-DD]
        const dateMatch = line.match(/^\[(\d{4}-\d{2}-\d{2})\]$/);
        if (dateMatch) {
          if (inTable) {
            output += '</div>'; // Close previous table
          }
          currentDate = dateMatch[1];
          output += `
            <div class="date-header">${currentDate}</div>
          `;
          inTable = true;
          continue;
        }
        
        // Skip the column headers line
        if (line.includes('Time') && line.includes('Description')) {
          continue;
        }
        
        // Try to match the timesheet entry format
        const rowMatch = line.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.+?)$/);
        if (rowMatch && inTable) {
          output += `
            <div class="timesheet-row">
              <div class="time-cell">${rowMatch[1]}</div>
              <div class="description-cell">${rowMatch[2]}</div>
            </div>
          `;
        }
      }
      
      if (inTable) {
        output += '</div>'; // Close last table
      }
      output += '</div>'; // Close container
      
      // Add styles
      const styles = `
        <style>
          body {
            background: linear-gradient(to right, #1a1a2e, #16213e);
            color: #e6e6e6;
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          }

          #output {
            padding: 12px;
            height: 100vh;
            overflow-y: auto;
            box-sizing: border-box;
            white-space: normal;
          }

          .timesheet-container {
            background: rgba(26, 26, 46, 0.8);
            border-radius: 10px;
            padding: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
            display: flex;
            flex-direction: column;
            gap: 10px;
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

          .sidebar {
            background: linear-gradient(135deg, #2a4b8d, #1a1a2e);
            position: fixed;
            left: 0;
            top: 0;
            bottom: 0;
            width: 60px;
            padding: 20px 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            box-shadow: 2px 0 5px rgba(0, 0, 0, 0.2);
          }
        </style>
      `;
      
      return styles + output;
    } catch (error) {
      console.error('Error formatting output:', error);
      return `<pre>${text}</pre>`;
    }
  }

  summarizeBtn.addEventListener('click', async function() {
    showLoading();
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'summarize' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response);
        });
      });

      if (!response) {
        throw new Error('No response received from the background script');
      }

      console.log('Raw response:', response);

      // Extract the summary text from the response
      let summaryText;
      if (typeof response === 'string') {
        summaryText = response;
      } else if (response.summary) {
        summaryText = response.summary;
      } else if (response.error) {
        throw new Error(response.error);
      } else {
        console.warn('Unexpected response format:', response);
        summaryText = JSON.stringify(response, null, 2);
      }

      console.log('Summary text:', summaryText);
      
      // Format the output
      const formattedOutput = formatOutput(summaryText);
      console.log('Formatted output:', formattedOutput);
      
      output.innerHTML = formattedOutput;
      
      // Save the output
      chrome.storage.local.set({ 'timesheetOutput': formattedOutput });
      
      copyBtn.disabled = false;
      clearBtn.disabled = false;
      showSuccess('Summary generated successfully!');
    } catch (error) {
      showError('Failed to generate summary: ' + error.message);
      console.error('Summarize error:', error);
    } finally {
      hideLoading();
    }
  });

  exportBtn.addEventListener('click', async function() {
    showLoading('Preparing CSV export...');
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'export' }, (response) => {
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
    output.innerHTML = '';
    chrome.storage.local.remove(['timesheetOutput']);
    copyBtn.disabled = true;
    clearBtn.disabled = true;
    showSuccess('Output cleared!');
  });
});