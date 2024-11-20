class TimesheetTracker {
  constructor() {
    console.log('TimesheetTracker initialized');
    this.currentTab = null;
    this.activityLog = [];
    this.setupListeners();
    this.loadPreviousActivities();
    this.loadHistoryData();
    this.loadApiKey();
  }

  setupListeners() {
    chrome.tabs.onActivated.addListener(this.handleTabChange.bind(this));
    chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
  }

  loadPreviousActivities() {
    chrome.storage.local.get(['timesheetActivities'], (result) => {
      if (result.timesheetActivities) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        this.activityLog = result.timesheetActivities.filter(entry => 
          new Date(entry.startTime) > twentyFourHoursAgo
        );
        console.log('Loaded activities:', result.timesheetActivities);
      }
    });
  }

  async handleTabChange(activeInfo) {
    try {
      const tab = await this.getTab(activeInfo.tabId);
      this.processTabChange(tab);
    } catch (error) {
      console.error('Error handling tab change:', error);
    }
  }

  async handleTabUpdate(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete') {
      this.processTabChange(tab);
    }
  }

  getTab(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(tab);
        }
      });
    });
  }

  processTabChange(tab) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return;
    }

    const now = new Date();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const urlObj = new URL(tab.url);
    const domain = urlObj.hostname;

    // Close previous tab's activity
    if (this.currentTab) {
      const lastEntry = this.activityLog[this.activityLog.length - 1];
      if (lastEntry) {
        lastEntry.endTime = now;
        lastEntry.duration = (now - new Date(lastEntry.startTime)) / 1000 / 60;
      }
    }

    // Remove old entries
    this.activityLog = this.activityLog.filter(entry => 
      new Date(entry.startTime) > twentyFourHoursAgo
    );

    // Start new activity entry
    this.activityLog.push({
      date: now.toISOString().split('T')[0],
      domain: domain,
      title: tab.title || domain,
      startTime: now.toISOString(),
      endTime: null,
      duration: 0,
      url: tab.url
    });

    console.log('Adding new activity:', {
      date: now.toISOString().split('T')[0],
      domain: domain,
      title: tab.title || domain,
      startTime: now.toISOString(),
      url: tab.url
    });

    this.currentTab = tab;
    this.saveActivityLog();
  }

  saveActivityLog() {
    chrome.storage.local.set({ 
      timesheetActivities: this.activityLog 
    });
  }

  exportToCSV() {
    console.log('Current activity log:', this.activityLog);
    
    // Ensure final entry is closed
    if (this.currentTab) {
      const lastEntry = this.activityLog[this.activityLog.length - 1];
      if (lastEntry && !lastEntry.endTime) {
        lastEntry.endTime = new Date();
        lastEntry.duration = (lastEntry.endTime - new Date(lastEntry.startTime)) / 1000 / 60;
      }
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActivities = this.activityLog.filter(entry => 
      new Date(entry.startTime) > twentyFourHoursAgo
    );

    console.log('Recent activities for export:', recentActivities);

    const csvHeader = "Date,Time,Duration,Title,Domain";
    const csvRows = recentActivities.map(entry => {
      const date = new Date(entry.startTime);
      const formattedDate = date.toLocaleDateString();
      const formattedTime = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      return `"${formattedDate}","${formattedTime}","${entry.duration.toFixed(2)}","${entry.title.replace(/"/g, '""')}","${entry.domain}"`;
    });

    const csvContent = [csvHeader, ...csvRows].join("\n");
    const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    
    chrome.downloads.download({
      url: dataUri,
      filename: `timesheet_${new Date().toISOString().split('T')[0]}.csv`,
      saveAs: true
    });
  }

  async summarizeTimesheet() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActivities = this.activityLog.filter(entry => 
      new Date(entry.startTime) > twentyFourHoursAgo
    );

    const totalTime = recentActivities.reduce((sum, entry) => sum + entry.duration, 0);

    // Create a Map to store unique activities by title
    const uniqueActivitiesMap = new Map();

    recentActivities.forEach(entry => {
      const key = `${entry.domain}-${entry.title}`;
      if (!uniqueActivitiesMap.has(key)) {
        uniqueActivitiesMap.set(key, {
          domain: entry.domain,
          title: entry.title,
          url: entry.url,
          duration: entry.duration
        });
      } else {
        // Add duration to existing entry
        const existing = uniqueActivitiesMap.get(key);
        existing.duration += entry.duration;
      }
    });

    // Convert Map to array for LLM analysis
    const uniqueActivities = Array.from(uniqueActivitiesMap.values());

    // Get LLM-powered detailed breakdown
    const llmSummary = await this.getLLMDetailedBreakdown(uniqueActivities, totalTime);

    return llmSummary;
  }

  async getLLMDetailedBreakdown(activities, totalTime) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': "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",
          'anthropic-version': '2023-06-01',
          'dangerouslyAllowBrowser': 'true',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 8192,
          messages: [{
            role: 'user',
            content: `Based on the following browsing activities, create a detailed daily timesheet in the exact format shown below. Group similar activities and categorize them appropriately.

            Total Tracked Time: ${totalTime.toFixed(2)} minutes

            Browsing Activities:
            ${JSON.stringify(activities, null, 2)}

                Required Format:
                Date  Time   Description    Duration

                Rules:
                1. Group activities by domain and purpose
                2. Convert minutes to HH:MM format
                3. Include detailed descriptions based on webpage titles
                4. If ticket numbers/links are found in URLs, include them
                5. Format output as a tab-separated table


                Example:
                Today's chrome session:
                Date    Time    Description    Duration
                2024-11-20  10:00 AM - 10:15 AM   Google Search   0:15
                2024-11-20  11:25 AM - 11:40 AM   Github Research   0:15

                Please provide the timesheet entries in the exact format shown above, with each field separated by tabs.`
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return data.content[0].text;
    } catch (error) {
      console.error('LLM Analysis Error:', error);
      return `Unable to generate timesheet. Error: ${error.message}`;
    }
  }

  async loadApiKey() {
    try {
      const response = await fetch('/.env');
      const text = await response.text();
      const envVars = Object.fromEntries(
        text.split('\n')
          .filter(line => line && !line.startsWith('#'))
          .map(line => line.split('='))
      );
      this.ANTHROPIC_API_KEY = envVars.ANTHROPIC_API_KEY;
      
      if (!this.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not found in .env file');
      }
    } catch (error) {
      console.error('Error loading API key:', error);
    }
  }

  async loadHistoryData() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    return new Promise((resolve) => {
      chrome.history.search({
        text: '',
        startTime: twentyFourHoursAgo.getTime(),
        maxResults: 10000
      }, async (historyItems) => {
        for (const item of historyItems) {
          if (!item.url || item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) {
            continue;
          }

          const urlObj = new URL(item.url);
          const domain = urlObj.hostname;
          const visitTime = new Date(item.lastVisitTime);
          
          const duration = item.visitTime ? 
            ((item.endTime || Date.now()) - item.visitTime) / 1000 / 60 : 
            0;

          this.activityLog.push({
            date: visitTime.toLocaleDateString(),
            time: visitTime.toLocaleTimeString(),
            domain: domain,
            title: item.title || domain,
            startTime: visitTime.toISOString(),
            endTime: item.endTime ? new Date(item.endTime).toISOString() : null,
            duration: duration,
            url: item.url
          });
        }

        this.activityLog.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
        this.saveActivityLog();
        resolve();
      });
    });
  }
}

// Initialize tracker
const timesheetTracker = new TimesheetTracker();

// Listen for export and summarize requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportCSV') {
    timesheetTracker.exportToCSV();
  }
  if (request.action === 'summarizeTimesheet') {
    timesheetTracker.summarizeTimesheet()
      .then(summary => sendResponse({summary}));
    return true; // Allow async response
  }
});