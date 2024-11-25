document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('exportBtn');
  const summarizeBtn = document.getElementById('summarizeBtn');
  const summaryDiv = document.getElementById('summary');
  const loadingDiv = document.getElementById('loading');

  exportBtn.addEventListener('click', () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    chrome.runtime.sendMessage({ action: 'exportTimesheet' }, (response) => {
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export Timesheet';

      if (response && response.status === 'success') {
        console.log('Export successful:', response.downloadId);
      } else {
        console.error('Export failed:', response?.error);
        alert('Failed to export timesheet: ' + (response?.error || 'Unknown error'));
      }
    });
  });

  summarizeBtn.addEventListener('click', () => {
    // Show loading state
    summaryDiv.textContent = 'Generating insights... Please wait.';
    loadingDiv.style.display = 'block';
    summarizeBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'summarizeTimesheet' }, (response) => {
      // Hide loading state
      loadingDiv.style.display = 'none';
      summarizeBtn.disabled = false;

      if (response && response.status === 'success' && response.summary) {
        summaryDiv.textContent = response.summary;
      } else {
        summaryDiv.textContent = `Failed to generate insights: ${response?.error || 'Please try again.'}`;
        console.error('Summarize failed:', response?.error);
      }
    });
  });
});