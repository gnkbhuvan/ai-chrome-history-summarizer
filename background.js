// Register service worker
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(clients.claim());
});

const { GoogleGenerativeAI } = require("@google/generative-ai");

class TimesheetTracker {
  constructor() {
    console.log('TimesheetTracker initialized');
    this.currentTab = null;
    this.activityLog = [];
    
    // Initialize Gemini
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
    });
    
    // Initialize services
    this.initializeServices();
  }

  async initializeServices() {
    try {
      await this.setupListeners();
      await this.loadHistoryData();
      console.log('All services initialized successfully');
    } catch (error) {
      console.error('Error during service initialization:', error);
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

      // Group activities by domain and title
      const domainGroups = {};

      dayActivities.forEach(activity => {
        // Ensure activity has a domain
        if (!activity.domain) return;

        // Initialize domain group if it doesn't exist
        if (!domainGroups[activity.domain]) {
          domainGroups[activity.domain] = {
            domain: activity.domain,
            title: activity.title,
            url: activity.url,
            totalTime: 0,
            visits: 0,
            activities: [],
            startTime: activity.startTime,
            endTime: activity.endTime || activity.startTime // Fallback to startTime if endTime is missing
          };
        }

        const domain = domainGroups[activity.domain];
        domain.activities.push(activity);
        domain.visits++;
        domain.totalTime += activity.duration || 0;

        // Update time range - keep track of earliest start and latest end
        const activityStart = new Date(activity.startTime);
        const activityEnd = new Date(activity.endTime || activity.startTime);
        const currentStart = new Date(domain.startTime);
        const currentEnd = new Date(domain.endTime);

        // Update earliest start time
        if (activityStart < currentStart) {
          domain.startTime = activity.startTime;
          domain.title = activity.title;
          domain.url = activity.url;
        }

        // Update latest end time
        if (activityEnd > currentEnd) {
          domain.endTime = activity.endTime || activity.startTime;
        }
      });

      // Convert to array and sort
      const sortedDomains = Object.values(domainGroups)
        .map(domain => ({
          ...domain,
          totalTime: Math.round(domain.totalTime * 100) / 100,
          formattedDuration: this.formatDuration(domain.totalTime),
          // Add timestamp for sorting
          timestamp: new Date(domain.startTime).getTime()
        }))
        .sort((a, b) => {
          // Primary sort by start time (ascending)
          const timeComparison = a.timestamp - b.timestamp;
          if (timeComparison !== 0) return timeComparison;
          
          // Secondary sort by total time (descending) if start times are equal
          return b.totalTime - a.totalTime;
        });

      // Format dates in the output
      return sortedDomains.map(domain => ({
        ...domain,
        startTime: new Date(domain.startTime).toLocaleString(),
        endTime: new Date(domain.endTime).toLocaleString(),
        // Remove the temporary timestamp field
        timestamp: undefined
      }));
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
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('Gemini API key not configured. Please check configuration.');
      }

      if (!activities || activities.length === 0) {
        throw new Error('No activities provided for analysis');
      }

      console.log('Sending request to Gemini...');

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
            timeStamp: `${startTime.toLocaleTimeString('en-US', {
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
      </key_responsibilities>

      <output_format>
      Return a JSON object with the following structure:
      {
        "dates": [
          {
            "date": "DD-MM-YYYY",
            "entries": [
              {
                "timeStamp": "9:00 AM",
                "description": "Activity description with details"
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
                "timeStamp": "9:00 AM",
                "description": "Development Work on Project X - Extended description with details about specific tasks and achievements"
              },
              {
                "timeStamp": "10:45 AM",
                "description": "Code Review Session - Reviewing pull requests and providing feedback"
              },
              {
                "timeStamp": "2:00 PM",
                "description": "Feature Implementation - Working on new functionality with detailed progress notes"
              }
            ]
          }
        ]
      }

      Rules:
      - Group entries by date in the dates array
      - Use 12-hour time format with AM/PM for timeStamp
      - Include detailed descriptions without truncation
      - Keep descriptions informative and complete
      - Always return valid JSON that matches the structure above
      - Ensure all dates are in DD-MM-YYYY format
      </output_format>

          <description_enhancement_criteria>
          Descriptions should:
          1. Start with the primary work context or project name
          2. Describe specific tasks and activities
          3. Include measurable outcomes or progress
          4. Use action verbs
          5. Be clear and professional
          6. Avoid vague or generic statements

          Examples of Strong Descriptions:
          - "Developed backend API endpoints for customer registration module, completing 3 critical integration points and resolving authentication security gaps"
          - "Conducted comprehensive code review for marketing dashboard project, identified and addressed 7 potential performance bottlenecks"
          - "Collaborated with design team to refine user interface wireframes, implementing 12 UX improvements based on recent user feedback"
          </description_enhancement_criteria>

      <instructions>
      1. Process the provided browsing activities
      2. Group activities by date
      3. Format the output as JSON exactly matching the structure above
      4. Use DD-MM-YYYY format for dates (e.g., "20-03-2024")
      5. Use 12-hour time format with AM/PM
      6. Include complete, detailed descriptions
      7. Ensure the JSON is properly formatted and valid
      8. Do not include any text outside the JSON object
      </instructions>
      </prompt>
`;

      try {
        // Use Gemini's generateContent method
        const result = await this.model.generateContent(prompt);
        let text = '';
        if (result && result.response && typeof result.response.text === 'function') {
          text = await result.response.text();
        } else if (result && typeof result.text === 'function') {
          text = await result.text();
        } else if (result && typeof result.text === 'string') {
          text = result.text;
        } else {
          throw new Error('Unexpected Gemini response format');
        }

        // Clean and format the text
        const cleanedText = text.trim()
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\"/g, '"')
          .replace(/\\/g, '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n');

        console.log('Final formatted text:', cleanedText);
        return cleanedText;
      } catch (error) {
        console.error('Gemini API Error:', error);
        throw new Error(`Gemini API Error: ${error.message}`);
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

  async exportToCSV(date = new Date()) {
    try {
      // Get filtered activities for the specified date
      const activities = await this.getFilteredActivities(date);
      
      if (!activities || activities.length === 0) {
        throw new Error('No activities found for the selected date');
      }

      // Create CSV content
      let csvContent = 'Domain,Title,Duration (minutes),Start Time,End Time,URL\n';
      
      activities.forEach(activity => {
        // Ensure all required fields have default values
        const duration = typeof activity.duration === 'number' ? activity.duration : 0;
        const startTime = activity.startTime ? new Date(activity.startTime).toLocaleString() : '';
        const endTime = activity.endTime ? new Date(activity.endTime).toLocaleString() : '';
        const domain = activity.domain || '';
        const title = (activity.title || '').replace(/,/g, ' ');
        const url = activity.url || '';

        const row = [
          domain,
          title,
          duration.toFixed(2),
          startTime,
          endTime,
          url
        ].map(field => `"${field}"`).join(',');
        
        csvContent += row + '\n';
      });

      // Format date for filename
      const dateStr = date.toISOString().split('T')[0];
      const filename = `timesheet-${dateStr}.csv`;

      // Create data URL directly
      const csvBlob = new Blob([csvContent], { type: 'text/csv' });
      const reader = new FileReader();
      
      return new Promise((resolve, reject) => {
        reader.onload = () => {
          chrome.downloads.download({
            url: reader.result,
            filename: filename,
            saveAs: true
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(downloadId);
            }
          });
        };
        reader.onerror = () => reject(new Error('Failed to read CSV data'));
        reader.readAsDataURL(csvBlob);
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
        // Use the date from the request, or default to today
        const date = request.date ? new Date(request.date) : new Date();
        const downloadId = await timesheetTracker.exportToCSV(date);
        sendResponse({ status: 'success', downloadId });
      } catch (error) {
        console.error('Export error:', error);
        sendResponse({ 
          status: 'error', 
          message: error.toString(),
          details: error.stack 
        });
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