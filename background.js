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
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const urlObj = new URL(tab.url);
    const domain = urlObj.hostname;

    // Close previous tab's activity with accurate duration
    if (this.currentTab) {
      const lastEntry = this.activityLog[this.activityLog.length - 1];
      if (lastEntry && !lastEntry.endTime) {
        lastEntry.endTime = now.toISOString();
        const startTime = new Date(lastEntry.startTime);
        lastEntry.duration = Math.max(0, (now.getTime() - startTime.getTime()) / 1000 / 60);
      }
    }

    // Remove old entries
    this.activityLog = this.activityLog.filter(entry => 
      new Date(entry.startTime) > twentyFourHoursAgo
    );

    // Start new activity entry
    const newEntry = {
      date: now.toISOString().split('T')[0],
      domain: domain,
      title: tab.title || domain,
      startTime: now.toISOString(),
      endTime: null,
      duration: 0,
      url: tab.url
    };

    this.activityLog.push(newEntry);
    console.log('Adding new activity:', newEntry);

    this.currentTab = tab;
    this.saveActivityLog();
  }

  saveActivityLog() {
    chrome.storage.local.set({ 
      timesheetActivities: this.activityLog 
    });
  }

  exportToCSV() {
    return new Promise((resolve, reject) => {
      try {
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

        if (recentActivities.length === 0) {
          throw new Error('No activities found in the last 24 hours');
        }

        // Create CSV content
        const csvRows = [];
        csvRows.push(['Date', 'Time', 'Duration (minutes)', 'Title', 'Domain']);

        recentActivities.forEach(entry => {
          const date = new Date(entry.startTime);
          csvRows.push([
            date.toLocaleDateString(),
            date.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }),
            entry.duration.toFixed(2),
            entry.title,
            entry.domain
          ]);
        });

        // Convert to CSV string with proper escaping
        const csvContent = csvRows.map(row => 
          row.map(cell => 
            typeof cell === 'string' ? 
              '"' + cell.replace(/"/g, '""') + '"' : 
              cell
          ).join(',')
        ).join('\n');

        // Create downloadable link
        const filename = `timesheet_${new Date().toISOString().split('T')[0]}.csv`;
        const csvData = new TextEncoder().encode(csvContent);
        const csvArray = Array.from(csvData);
        const csvString = csvArray.map(byte => String.fromCharCode(byte)).join('');
        const base64 = btoa(csvString);
        const dataUrl = `data:text/csv;base64,${base64}`;

        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: true
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(downloadId);
          }
        });
      } catch (error) {
        console.error('Export failed:', error);
        reject(error);
      }
    });
  }

  async summarizeTimesheet() {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure final entry is closed with accurate duration
        if (this.currentTab) {
          const lastEntry = this.activityLog[this.activityLog.length - 1];
          if (lastEntry && !lastEntry.endTime) {
            const now = new Date();
            lastEntry.endTime = now.toISOString();
            const startTime = new Date(lastEntry.startTime);
            lastEntry.duration = Math.max(0, (now.getTime() - startTime.getTime()) / 1000 / 60);
          }
        }

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentActivities = this.activityLog.filter(entry => 
          new Date(entry.startTime) > twentyFourHoursAgo
        );

        // Group activities by domain and title
        const uniqueActivitiesMap = new Map();

        recentActivities.forEach(entry => {
          const key = `${entry.domain}-${entry.title}`;
          if (!uniqueActivitiesMap.has(key)) {
            uniqueActivitiesMap.set(key, {
              domain: entry.domain,
              title: entry.title,
              url: entry.url,
              duration: entry.duration,
              startTime: entry.startTime,
              endTime: entry.endTime
            });
          } else {
            // Add duration to existing entry
            const existing = uniqueActivitiesMap.get(key);
            existing.duration += entry.duration;
            // Update time range
            if (new Date(entry.startTime) < new Date(existing.startTime)) {
              existing.startTime = entry.startTime;
            }
            if (entry.endTime && (!existing.endTime || new Date(entry.endTime) > new Date(existing.endTime))) {
              existing.endTime = entry.endTime;
            }
          }
        });

        // Convert Map to array and sort by duration
        const uniqueActivities = Array.from(uniqueActivitiesMap.values())
          .map(activity => ({
            ...activity,
            duration: Math.round(activity.duration * 100) / 100, // Round to 2 decimal places
            formattedDuration: this.formatDuration(activity.duration)
          }))
          .sort((a, b) => b.duration - a.duration);

        // Get LLM-powered detailed breakdown
        const llmSummary = await this.getLLMDetailedBreakdown(uniqueActivities);
        resolve(llmSummary);
      } catch (error) {
        console.error('Summarize failed:', error);
        reject(error);
      }
    });
  }

  formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${remainingMinutes}m`;
  }

  async getLLMDetailedBreakdown(activities) {
    try {
      if (!this.ANTHROPIC_API_KEY) {
        throw new Error('API key not loaded. Please check extension configuration.');
      }

      console.log('Sending request to Anthropic API');

      const formattedActivities = activities.map(activity => {
        const startTime = new Date(activity.startTime);
        const endTime = activity.endTime ? new Date(activity.endTime) : new Date();
        
        return {
          domain: activity.domain,
          title: activity.title,
          url: activity.url,
          timeRange: `${startTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short'
          })} - ${endTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short'
          })}`,
          date: startTime.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          }),
          duration: activity.formattedDuration
        };
      });

      console.log('Formatted activities for AI:', formattedActivities);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'dangerouslyAllowBrowser': 'true',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 8192,
          messages: [{
            role: 'user',
            content: `Based on the following browsing activities, create a detailed daily timesheet summary. Use the EXACT times provided in the data, do not modify or adjust them.

            Browsing Activities:
            ${JSON.stringify(formattedActivities, null, 2)}

            <prompt> <role> You are a precise time-tracking analyzer and timesheet generator, specifically designed to process and format web browsing activity data into structured, professional timesheet entries. </role>

            <input_parameters>
                <parameter name="browsing_activities">JSON array of web browsing data including timestamps, URLs, and page titles</parameter>
            </input_parameters>

            <key_responsibilities>
                <task>Parse and analyze web browsing data with exact timestamp preservation</task>
                <task>Generate clear, well-formatted timesheet entries</task>
                <task>Group activities by date and domain</task>
                <task>Identify key browsing patterns</task>
            </key_responsibilities>

            <output_format>
                <format>
                    ### [Date]
                    
                    | Time  | Website     | Domain      | Activity Description |
                    |-------|-------------|-------------|---------------------|
                    | HH:MM | example.com | example.com | Detailed activity description that can span multiple lines if needed. Make sure to provide clear and informative descriptions. |
                </format>
                <column_specs>
                    1. Time: Fixed width (HH:MM format)
                    2. Website: Fixed width (base URL only)
                    3. Domain: Fixed width (main domain)
                    4. Description: Flexible width, can wrap to multiple lines
                </column_specs>
                <formatting_rules>
                    1. Keep time format consistent: HH:MM (24-hour)
                    2. Trim website URLs to main path
                    3. Keep domain names clean and consistent
                    4. Write detailed descriptions that explain the activity
                    5. Allow descriptions to wrap naturally
                    6. Maintain proper table alignment
                </formatting_rules>
            </output_format>

            <special_instructions>
                1. Group entries by date with clear date headers
                2. Within each date, maintain chronological order
                3. Keep time column narrow and fixed width
                4. Let description column use remaining space
                5. Format URLs consistently
                6. Write clear, informative descriptions
                7. Use proper markdown table syntax
            </special_instructions>

            Please generate a detailed timesheet summary following these specifications. Make sure each column respects its width constraints and descriptions are properly formatted.</prompt>`
          }]
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('API Response:', errorData);
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('API Response:', data);
      
      if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
        throw new Error('Invalid API response format');
      }

      const content = data.content[0].text || '';
      if (!content) {
        throw new Error('Empty response from API');
      }

      // Format the content for display
      const formattedContent = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .join('\n');

      return formattedContent;
    } catch (error) {
      console.error('LLM Analysis Error:', error);
      throw new Error(`Unable to generate insights: ${error.message}`);
    }
  }

  async loadApiKey() {
    try {
      // Use the environment variable loaded by dotenv-webpack
      this.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      
      if (!this.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not found in environment variables');
      }
    } catch (error) {
      console.error('Error loading API key:', error);
    }
  }

  async loadHistoryData() {
    const endTime = Date.now();
    const startTime = endTime - (24 * 60 * 60 * 1000);
    
    return new Promise((resolve) => {
      chrome.history.search({
        text: '',
        startTime: startTime,
        endTime: endTime,
        maxResults: 10000
      }, async (historyItems) => {
        this.activityLog = [];
        
        for (const item of historyItems) {
          if (!item.url || item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) {
            continue;
          }

          try {
            const urlObj = new URL(item.url);
            const domain = urlObj.hostname;
            
            // Get all visits for this URL
            const visits = await new Promise(resolve => {
              chrome.history.getVisits({ url: item.url }, resolve);
            });

            if (visits.length > 0) {
              visits.sort((a, b) => a.visitTime - b.visitTime);
              
              for (let i = 0; i < visits.length; i++) {
                const visit = visits[i];
                const nextVisit = visits[i + 1];
                const visitTime = new Date(visit.visitTime);
                
                if (visit.visitTime >= startTime && visit.visitTime <= endTime) {
                  let duration = 1; // Default duration in minutes
                  
                  if (nextVisit) {
                    const timeDiff = (nextVisit.visitTime - visit.visitTime) / 1000 / 60;
                    duration = timeDiff < 30 ? timeDiff : 1; // Cap at 30 minutes
                  }

                  this.activityLog.push({
                    date: visitTime.toLocaleDateString(),
                    time: visitTime.toLocaleTimeString(),
                    domain: domain,
                    title: item.title || domain,
                    startTime: visitTime.toISOString(),
                    endTime: nextVisit ? new Date(nextVisit.visitTime).toISOString() : null,
                    duration: duration,
                    url: item.url
                  });
                }
              }
            }
          } catch (error) {
            console.error('Error processing history item:', error);
          }
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
  console.log('Received message:', request);

  if (request.action === 'export') {
    timesheetTracker.exportToCSV()
      .then(downloadId => {
        sendResponse({ status: 'success', downloadId });
      })
      .catch(error => {
        console.error('Export failed:', error);
        sendResponse({ status: 'error', error: error.message });
      });
    return true; // Allow async response
  }
  
  if (request.action === 'summarize') {
    timesheetTracker.summarizeTimesheet()
      .then(summary => {
        console.log('Summary generated:', summary);
        if (summary) {
          sendResponse(summary);
        } else {
          sendResponse({ error: 'Failed to generate summary' });
        }
      })
      .catch(error => {
        console.error('Summarize failed:', error);
        sendResponse({ error: error.message });
      });
    return true; // Allow async response
  }
});