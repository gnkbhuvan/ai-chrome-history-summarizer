document.addEventListener('DOMContentLoaded', function() {
  const summarizeBtn = document.getElementById('summarizeBtn');
  const exportBtn = document.getElementById('exportBtn');
  const copyBtn = document.getElementById('copyBtn');
  const clearBtn = document.getElementById('clearBtn');
  const loading = document.getElementById('loading');
  const output = document.getElementById('output');
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');

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
    if (!text) return '';
    
    // Replace newlines with <br> tags
    let formatted = text.replace(/\n/g, '<br>');
    
    // Style the table header
    formatted = formatted.replace(
      /(Date\s+Time\s+Description\s+Duration)/,
      '<div class="timesheet-header">$1</div>'
    );
    
    // Style each table row
    formatted = formatted.replace(
      /(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2} [AP]M - \d{1,2}:\d{2} [AP]M)\s+(.+?)\s+(\d+:\d+)/g,
      '<div class="timesheet-entry"><span>$1</span><span>$2</span><span>$3</span><span>$4</span></div>'
    );
    
    return formatted;
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
      
      const formattedOutput = formatOutput(response);
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