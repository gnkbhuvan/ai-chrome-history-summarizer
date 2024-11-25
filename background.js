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

        const totalTime = uniqueActivities.reduce((sum, activity) => sum + activity.duration, 0);

        // Get LLM-powered detailed breakdown
        const llmSummary = await this.getLLMDetailedBreakdown(uniqueActivities, totalTime);
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

  async getLLMDetailedBreakdown(activities, totalTime) {
    try {
      if (!this.ANTHROPIC_API_KEY) {
        throw new Error('API key not loaded. Please check extension configuration.');
      }

      console.log('Sending request to Anthropic API with key:', this.ANTHROPIC_API_KEY.substring(0, 5) + '...');

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

            Total Tracked Time: ${this.formatDuration(totalTime)}

            Browsing Activities:
            ${JSON.stringify(formattedActivities, null, 2)}

            <prompt> <role> You are a precise time-tracking analyzer and timesheet generator, specifically designed to process and format web browsing activity data into structured, professional timesheet entries. </role>
            javascript


            <input_parameters>
                <parameter name="total_tracked_time">Total duration of tracked activities</parameter>
                <parameter name="browsing_activities">JSON array of web browsing data including timestamps, URLs, and page titles</parameter>
            </input_parameters>

            <key_responsibilities>
                <task>Parse and analyze web browsing data with exact timestamp preservation</task>
                <task>Group related activities by domain and purpose</task>
                <task>Generate formatted timesheet entries</task>
                <task>Maintain data accuracy and time precision</task>
            </key_responsibilities>

            <processing_rules>
                <time_handling>
                    <rule>Preserve exact timestamps from input data without modifications</rule>
                    <rule>Convert all duration values to HH:MM format</rule>
                    <rule>Use 12-hour time format (AM/PM) for display</rule>
                </time_handling>

                <activity_grouping>
                    <rule>Group consecutive activities on the same domain</rule>
                    <rule>Combine related tasks with similar purposes</rule>
                    <rule>Maintain chronological order of activities</rule>
                </activity_grouping>

                <description_formatting>
                    <rule>Extract meaningful descriptions from webpage titles</rule>
                    <rule>Include ticket numbers/JIRA references when found in URLs</rule>
                    <rule>Use clear, professional activity descriptions</rule>
                </description_formatting>
            </processing_rules>

            <output_format>
                <table>
                    <columns>
                        <column name="Date" format="YYYY-MM-DD"/>
                        <column name="Time" format="HH:MM AM/PM - HH:MM AM/PM"/>
                        <column name="Description" format="Clear activity description"/>
                        <column name="Duration" format="H:MM"/>
                    </columns>
                    <separator>tab character (\t)</separator>
                </table>
            </output_format>

            <validation_checks>
                <check>Ensure all times match input data exactly</check>
                <check>Verify duration calculations are accurate</check>
                <check>Confirm proper tab separation between columns</check>
                <check>Validate date format consistency</check>
            </validation_checks>

            <example_output>
                Date        Time                    Description         Duration
                2024-11-20  10:00 AM - 10:15 AM    Google Search      0:15
                2024-11-20  11:25 AM - 11:40 AM    Github Research    0:15
            </example_output>

            <error_handling>
                <instruction>If any data is missing or invalid, mark it clearly with [DATA MISSING] or [INVALID] rather than making assumptions</instruction>
                <instruction>Report any timestamp inconsistencies without attempting to correct them</instruction>
            </error_handling>

            <additional_notes>
                <note>Maintain exact precision of input timestamps</note>
                <note>Do not round or adjust times</note>
                <note>Preserve all ticket numbers and reference IDs found in URLs</note>
            </additional_notes>
            </prompt>
            
            
            `
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
      
      if (data.content && data.content[0] && data.content[0].text) {
        return data.content[0].text;
      } else {
        throw new Error('Invalid API response format');
      }
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
  if (request.action === 'exportTimesheet') {
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
  
  if (request.action === 'summarizeTimesheet') {
    timesheetTracker.summarizeTimesheet()
      .then(summary => {
        if (summary) {
          sendResponse({ status: 'success', summary });
        } else {
          sendResponse({ status: 'error', error: 'Failed to generate summary' });
        }
      })
      .catch(error => {
        console.error('Summarize failed:', error);
        sendResponse({ status: 'error', error: error.message });
      });
    return true; // Allow async response
  }
});