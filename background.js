// Register service worker
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(clients.claim());
});

const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

class TimesheetTracker {
  constructor() {
    console.log('TimesheetTracker initialized');
    this.currentTab = null;
    this.activityLog = [];
    
    // Use more secure environment variable handling
    this.AWS_ACCESS_KEY = process.env.AWS_ACCESS_KEY || '';
    this.AWS_SECRET_KEY = process.env.AWS_SECRET_KEY || '';
    this.AWS_REGION = process.env.AWS_REGION || 'us-west-2';
    this.bedrockClient = null;
    
    if (!this.AWS_ACCESS_KEY || !this.AWS_SECRET_KEY) {
      console.error('AWS credentials not found in environment variables');
    }
    
    // Initialize services
    this.initializeServices();
  }

  async initializeServices() {
    try {
      await this.initializeAWS();
      await this.setupListeners();
      await this.loadHistoryData();
      console.log('All services initialized successfully');
    } catch (error) {
      console.error('Error during service initialization:', error);
    }
  }

  async initializeAWS() {
    try {
      const awsConfig = {
        region: this.AWS_REGION,
        credentials: {
          accessKeyId: this.AWS_ACCESS_KEY,
          secretAccessKey: this.AWS_SECRET_KEY
        }
      };

      this.bedrockClient = new BedrockRuntimeClient(awsConfig);
      
      // Verify credentials without eval
      const credentials = await this.bedrockClient.config.credentials();
      if (!credentials) {
        throw new Error('Failed to load AWS credentials');
      }
    } catch (error) {
      console.error('AWS Bedrock initialization failed:', error);
      throw error;
    }
  }

  setupListeners() {
    try {
      // Bind event handlers to preserve 'this' context
      this.handleTabChange = this.handleTabChange.bind(this);
      this.handleTabUpdate = this.handleTabUpdate.bind(this);
      
      chrome.tabs.onActivated.addListener(this.handleTabChange);
      chrome.tabs.onUpdated.addListener(this.handleTabUpdate);
      console.log('Chrome event listeners set up successfully');
    } catch (error) {
      console.error('Error setting up Chrome listeners:', error);
      throw error;
    }
  }

  handleTabChange = async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await this.processTabChange(tab);
    } catch (error) {
      console.error('Error in handleTabChange:', error);
    }
  }

  handleTabUpdate = async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      try {
        await this.processTabChange(tab);
      } catch (error) {
        console.error('Error in handleTabUpdate:', error);
      }
    }
  }

  async loadHistoryData(date = new Date()) {
    console.log('Loading history data for:', date);
    try {
      // Set the start time to the beginning of the specified day (midnight)
      const startTime = new Date(date);
      startTime.setHours(0, 0, 0, 0);
      
      // Set the end time to the end of the specified day (23:59:59.999)
      const endTime = new Date(date);
      endTime.setHours(23, 59, 59, 999);
      
      return new Promise((resolve) => {
        chrome.history.search({
          text: '',              // Return all history items
          startTime: startTime.getTime(),  // Start of the day
          endTime: endTime.getTime(),      // End of the day
          maxResults: 10000      // Get a large number of results
        }, async (historyItems) => {
          console.log('Raw history items:', historyItems?.length || 0);
          
          if (!historyItems || historyItems.length === 0) {
            console.log('No history items found');
            this.activityLog = [];
            resolve();
            return;
          }

          // Process history items
          const processedActivities = [];
          
          for (const item of historyItems) {
            try {
              if (!item.url || item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) {
                continue;
              }

              // Get all visits for this URL
              const visits = await new Promise(resolve => {
                chrome.history.getVisits({ url: item.url }, resolve);
              });

              if (visits && visits.length > 0) {
                const urlObj = new URL(item.url);
                visits.sort((a, b) => a.visitTime - b.visitTime);

                for (let i = 0; i < visits.length; i++) {
                  const visit = visits[i];
                  const nextVisit = visits[i + 1];
                  const visitTime = new Date(visit.visitTime);
                  
                  if (visit.visitTime >= startTime.getTime() && visit.visitTime <= endTime.getTime()) {
                    const activity = {
                      date: visitTime.toLocaleDateString(),
                      time: visitTime.toLocaleTimeString(),
                      domain: urlObj.hostname,
                      title: item.title || urlObj.hostname,
                      startTime: visitTime.toISOString(),
                      endTime: nextVisit ? new Date(nextVisit.visitTime).toISOString() : new Date().toISOString(),
                      duration: nextVisit ? 
                        Math.min(30, (nextVisit.visitTime - visit.visitTime) / 1000 / 60) : 
                        Math.min(30, (Date.now() - visit.visitTime) / 1000 / 60),
                      url: item.url,
                      visitCount: item.visitCount || 1,
                      typedCount: item.typedCount || 0
                    };
                    
                    processedActivities.push(activity);
                  }
                }
              }
            } catch (error) {
              console.error('Error processing history item:', error, item);
            }
          }

          console.log('Processed activities:', processedActivities.length);

          // Sort by timestamp (newest first)
          processedActivities.sort((a, b) => 
            new Date(b.startTime) - new Date(a.startTime)
          );

          this.activityLog = processedActivities;
          await this.saveActivities();
          
          console.log(`Saved ${processedActivities.length} activities to storage`);
          resolve();
        });
      });
    } catch (error) {
      console.error('Error in loadHistoryData:', error);
      this.activityLog = [];
    }
  }

  async processTabChange(tab) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return;
    }

    const now = new Date();
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

    // Start new activity entry
    const newEntry = {
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString(),
      domain: domain,
      title: tab.title || domain,
      startTime: now.toISOString(),
      endTime: null,
      duration: 0,
      url: tab.url
    };

    this.activityLog.unshift(newEntry);
    this.currentTab = tab;
    await this.saveActivities();
  }

  async saveActivities() {
    return new Promise((resolve) => {
      // Keep only last 10000 activities to prevent storage issues
      if (this.activityLog.length > 10000) {
        this.activityLog = this.activityLog.slice(0, 10000);
      }

      chrome.storage.local.set({
        'timesheetActivities': this.activityLog
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving activities:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  async loadPreviousActivities() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['timesheetActivities'], (result) => {
        if (result.timesheetActivities) {
          this.activityLog = result.timesheetActivities;
          console.log('Loaded', this.activityLog.length, 'activities from storage');
        }
        resolve();
      });
    });
  }

  async getFilteredActivities(date = new Date()) {
    try {
      // Ensure we have activities for the specified date
      await this.loadHistoryData(date);

      // Filter activities for the specified date
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const dayActivities = this.activityLog.filter(entry => {
        const entryTime = new Date(entry.startTime);
        return entryTime >= startOfDay && entryTime <= endOfDay;
      });

      // Group activities by domain
      const domainGroups = {};
      dayActivities.forEach(activity => {
        if (!activity.domain) return;

        if (!domainGroups[activity.domain]) {
          domainGroups[activity.domain] = {
            domain: activity.domain,
            title: activity.title,
            url: activity.url,
            totalTime: 0,
            visits: 0,
            activities: [],
            startTime: activity.startTime,
            endTime: activity.endTime
          };
        }

        const domain = domainGroups[activity.domain];
        domain.activities.push(activity);
        domain.visits++;
        domain.totalTime += activity.duration || 0;

        // Update time range and most recent title
        if (new Date(activity.startTime) > new Date(domain.startTime)) {
          domain.startTime = activity.startTime;
          domain.title = activity.title;
          domain.url = activity.url;
        }
        if (new Date(activity.endTime) > new Date(domain.endTime)) {
          domain.endTime = activity.endTime;
        }
      });

      // Convert to array and sort by total time
      return Object.values(domainGroups)
        .map(domain => ({
          ...domain,
          totalTime: Math.round(domain.totalTime * 100) / 100,
          formattedDuration: this.formatDuration(domain.totalTime)
        }))
        .sort((a, b) => b.totalTime - a.totalTime);
    } catch (error) {
      console.error('Error getting filtered activities:', error);
      throw error;
    }
  }

  async summarizeTimesheet(date = new Date()) {
    try {
      console.log('Starting timesheet summarization for:', date);
      
      const sortedActivities = await this.getFilteredActivities(date);
      console.log('Sorted activities:', sortedActivities.length);

      if (sortedActivities.length === 0) {
        return { error: 'No valid browsing activities found to summarize.' };
      }

      const summary = await this.getLLMDetailedBreakdown(
        sortedActivities, 
        sortedActivities.reduce((total, activity) => total + activity.totalTime, 0)
      );
      return summary;
    } catch (error) {
      console.error('Error in summarizeTimesheet:', error);
      return { error: error.message };
    }
  }

  async getLLMDetailedBreakdown(activities, totalTime) {
    try {
      if (!this.bedrockClient) {
        throw new Error('AWS Bedrock client not initialized. Please check configuration.');
      }

      if (!activities || activities.length === 0) {
        throw new Error('No activities provided for analysis');
      }

      console.log('Sending request to AWS Bedrock...');

      const formattedActivities = activities.map(activity => {
        if (!activity || !activity.startTime) {
          console.warn('Invalid activity entry detected:', activity);
          return null;
        }

        try {
          const startTime = new Date(activity.startTime);
          const endTime = activity.endTime ? new Date(activity.endTime) : new Date();
          
          return {
            domain: activity.domain || 'unknown',
            title: activity.title || 'Untitled',
            url: activity.url || '',
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
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            }),
            duration: activity.formattedDuration || '0:00'
          };
        } catch (error) {
          console.error('Error formatting activity:', error);
          return null;
        }
      }).filter(Boolean);

      if (formattedActivities.length === 0) {
        throw new Error('No valid activities to analyze after formatting');
      }

      console.log('Formatted activities for AI:', formattedActivities);

      const prompt = `
      <input>
      ${JSON.stringify(formattedActivities, null, 2)}
      </input>

      <prompt>
      <role>You are a precise time-tracking analyzer and timesheet generator, specifically designed to process and format web browsing activity data into structured, professional timesheet entries.</role>

      <key_responsibilities>
          <task>Parse and analyze web browsing data with exact timestamp preservation</task>
          <task>Generate a clean, date-grouped timesheet format</task>
          <task>Group and summarize related activities</task>
          <task>Include specific details like Jira ticket numbers or video titles when available</task>
      </key_responsibilities>

      <output_format>
      Return a JSON object with the following structure:
      {
        "dates": [
          {
            "date": "DD-MM-YYYY",
            "entries": [
              {
                "timeRange": "9:00 AM - 10:30 AM",
                "description": "Concise one-line activity description with specific details"
              }
            ]
          }
        ]
      }

      Example response:
      {
        "dates": [
          {
            "date": "20-03-2024",
            "entries": [
              {
                "timeRange": "9:00 AM - 10:30 AM",
                "description": "Developed API endpoints for customer registration module (JIRA-1234)"
              },
              {
                "timeRange": "10:45 AM - 11:15 AM",
                "description": "Conducted code review for marketing dashboard project (PR #42)"
              },
              {
                "timeRange": "2:00 PM - 3:30 PM",
                "description": "Watched tutorial: 'Advanced React Hooks' on YouTube"
              }
            ]
          }
        ]
      }

      Rules:
      - Group entries by date in the dates array
      - Use 12-hour time format with AM/PM for timeRange
      - Provide concise, one-line descriptions with specific details when available
      - Always return valid JSON that matches the structure above
      - Ensure all dates are in DD-MM-YYYY format
      </output_format>

      <description_enhancement_criteria>
      Descriptions should:
      1. Be concise and fit on one line
      2. Start with an action verb
      3. Clearly state the main task or activity
      4. Include specific details like Jira ticket numbers, PR numbers, or video titles when available
      5. Be professional and informative
      6. Avoid unnecessary elaboration

      Examples of Enhanced Descriptions:
      - "Developed backend API endpoints for customer registration (JIRA-1234)"
      - "Reviewed code for marketing dashboard project (PR #42)"
      - "Watched tutorial: 'Advanced React Hooks' on YouTube"
      - "Attended team meeting: Sprint planning for Q2 goals"
      </description_enhancement_criteria>

      <instructions>
      1. Process the provided browsing activities
      2. Group activities by date
      3. Format the output as JSON exactly matching the structure above
      4. Use DD-MM-YYYY format for dates (e.g., "20-03-2024")
      5. Use 12-hour time format with AM/PM
      6. Provide concise, one-line descriptions for each entry, including specific details when available
      7. Ensure the JSON is properly formatted and valid
      8. Do not include any text outside the JSON object
      </instructions>
      </prompt>
`;

      try {
        const response = await this.bedrockClient.send(new InvokeModelCommand({
          modelId: "anthropic.claude-3-5-haiku-20241022-v1:0",
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 8192,
            messages: [{
              role: "user",
              content: prompt
            }],
            temperature: 0.8,
            top_p: 0.95
          })
        }));

        if (!response || !response.body) {
          console.error('Empty response from Bedrock');
          throw new Error('Empty response received from Bedrock');
        }

        // Log raw response for debugging
        const rawResponse = new TextDecoder().decode(response.body);
        console.log('Raw Bedrock response:', rawResponse);

        // Parse the response body
        let responseBody;
        try {
          responseBody = JSON.parse(rawResponse);
          console.log('Parsed response body:', JSON.stringify(responseBody, null, 2));
        } catch (error) {
          console.error('Failed to parse response:', error);
          throw new Error('Failed to parse Bedrock response: ' + error.message);
        }

        // Handle different response formats
        let content;
        if (responseBody.content) {
          content = responseBody.content;
        } else if (responseBody.messages?.[0]?.content) {
          content = responseBody.messages[0].content;
        } else if (responseBody.completion) {
          content = responseBody.completion;
        } else {
          console.error('Unexpected response structure:', responseBody);
          throw new Error('Unexpected response structure from Bedrock');
        }

        // Extract text content
        let text;
        if (Array.isArray(content)) {
          // Handle array of content blocks (Claude 3 format)
          text = content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n');
        } else if (typeof content === 'string') {
          // Handle direct string content
          text = content;
        } else if (content?.text) {
          // Handle object with text property
          text = content.text;
        } else {
          console.error('Unable to extract text from content:', content);
          throw new Error('Unable to extract text from Bedrock response');
        }

        // Validate and clean the text
        if (!text || typeof text !== 'string') {
          console.error('Invalid text content:', text);
          throw new Error('Invalid text content in Bedrock response');
        }

        // Clean and format the text
        const cleanedText = text.trim()
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\/g, '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n');

        console.log('Final formatted text:', cleanedText);
        return cleanedText;

      } catch (error) {
        console.error('Bedrock API Error:', error);
        throw new Error(`Bedrock API Error: ${error.message}`);
      }
    } catch (error) {
      console.error('LLM Analysis Error:', error);
      return `Unable to generate timesheet summary. Error: ${error.message}\n\nPlease try again later or contact support if the issue persists.`;
    }
  }

  // Helper method to safely format text
  _formatText(text) {
    if (typeof text !== 'string') {
      console.warn('Invalid text format:', text);
      return String(text || '');
    }
    return text.trim()
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\/g, '');
  }

  async exportToCSV() {
    try {
      const endTime = Date.now();
      const startTime = endTime - (24 * 60 * 60 * 1000); // Last 24 hours

      const historyItems = await new Promise((resolve) => {
        chrome.history.search({
          text: '',
          startTime: startTime,
          endTime: endTime,
          maxResults: 10000
        }, resolve);
      });

      if (historyItems.length === 0) {
        throw new Error('No history items found to export');
      }

      // Create CSV rows with individual entries
      const csvRows = [
        ['Date', 'Time', 'Title', 'Domain', 'URL']
      ];

      for (const item of historyItems) {
        try {
          if (!item.url || item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) {
            continue;
          }

          const url = new URL(item.url);
          const date = new Date(item.lastVisitTime);
          
          csvRows.push([
            date.toLocaleDateString(),
            date.toLocaleTimeString(),
            item.title || '[No Title]',
            url.hostname,
            item.url
          ]);
        } catch (error) {
          console.error('Error processing history item:', error);
        }
      }

      // Create CSV content
      const csvContent = csvRows.map(row => 
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',')
      ).join('\n');
      
      // Create blob and data URL
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const reader = new FileReader();
      
      return new Promise((resolve, reject) => {
        reader.onload = async () => {
          try {
            if (!chrome.downloads) {
              throw new Error('Downloads API not available');
            }
            const downloadId = await chrome.downloads.download({
              url: reader.result,
              filename: `browsing-history-${new Date().toISOString().split('T')[0]}.csv`,
              saveAs: true
            });
            resolve(downloadId);
          } catch (error) {
            console.error('Download error:', error);
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Failed to read CSV data'));
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error exporting to CSV:', error);
      throw error;
    }
  }

  async generateTimesheetSummary() {
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
    const llmSummary = await this.getLLMDetailedBreakdown(uniqueActivities, uniqueActivities.reduce((total, activity) => total + activity.duration, 0));
    console.log('Summary generated:', llmSummary);
    return llmSummary;
  }

  formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${remainingMinutes}m`;
  }
}

// Initialize tracker
const timesheetTracker = new TimesheetTracker();

// Listen for export and summarize requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);

  if (request.action === 'export') {
    // Use async/await pattern with sendResponse
    (async () => {
      try {
        const downloadId = await timesheetTracker.exportToCSV();
        sendResponse({ status: 'success', downloadId });
      } catch (error) {
        console.error('Export error:', error);
        sendResponse({ status: 'error', message: error.toString() });
      }
    })();
    return true; // Keep the message channel open for async response
  }

  if (request.action === 'summarize') {
    (async () => {
      try {
        // Use the date from the request, or default to today
        const date = request.date ? new Date(request.date) : new Date();
        const summary = await timesheetTracker.summarizeTimesheet(date);
        if (!summary) {
          throw new Error('No summary generated');
        }
        sendResponse({ 
          status: 'success', 
          summary: typeof summary === 'string' ? summary : JSON.stringify(summary) 
        });
      } catch (error) {
        console.error('Summarize error:', error);
        sendResponse({ 
          status: 'error', 
          message: error.toString(),
          details: error.stack 
        });
      }
    })();
    return true; // Keep the message channel open for async response
  }
});