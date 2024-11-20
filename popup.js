document.addEventListener('DOMContentLoaded', () => {
  const exportBtn = document.getElementById('exportBtn');
  const summarizeBtn = document.getElementById('summarizeBtn');
  const summaryDiv = document.getElementById('summary');
  const loadingDiv = document.getElementById('loading');

  exportBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'exportCSV' });
    alert('Timesheet exported successfully!');
  });

  summarizeBtn.addEventListener('click', () => {
    // Show loading state
    summaryDiv.textContent = '';
    loadingDiv.style.display = 'block';
    summarizeBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'summarizeTimesheet' }, (response) => {
      // Hide loading state
      loadingDiv.style.display = 'none';
      summarizeBtn.disabled = false;

      if (response && response.summary) {
        summaryDiv.textContent = response.summary;
      } else {
        summaryDiv.textContent = 'Failed to generate insights. Please try again.';
      }
    });
  });
});