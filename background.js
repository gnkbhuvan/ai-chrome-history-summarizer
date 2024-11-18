let activityData = {};
let activeTabId = null;
let activeTabStartTime = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getActivityData') {
    pauseActiveTabTimer();
    console.log('Sending activity data:', activityData); // Add this line
    sendResponse(activityData);
  }
});


chrome.tabs.onActivated.addListener(activeInfo => {
  updateActiveTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === 'complete') {
    updateActiveTab(tabId);
  }
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // The browser has lost focus
    pauseActiveTabTimer();
  } else {
    // The browser has gained focus
    chrome.windows.get(windowId, window => {
      if (window.focused) {
        resumeActiveTabTimer();
      }
    });
  }
});

function updateActiveTab(tabId) {
  if (activeTabId !== null) {
    // Pause the timer for the previous tab
    pauseActiveTabTimer();
  }
  activeTabId = tabId;
  activeTabStartTime = Date.now();
}

function pauseActiveTabTimer() {
  if (activeTabId !== null && activeTabStartTime !== null) {
    const timeSpent = Date.now() - activeTabStartTime;
    chrome.tabs.get(activeTabId, tab => {
      const url = new URL(tab.url);
      const domain = url.hostname.replace('www.', '');
      if (!activityData[domain]) {
        activityData[domain] = 0;
      }
      activityData[domain] += timeSpent;
    });
    activeTabStartTime = null;
  }
}

function resumeActiveTabTimer() {
  if (activeTabId !== null) {
    activeTabStartTime = Date.now();
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getActivityData') {
    pauseActiveTabTimer();
    sendResponse(activityData);
  }
});

function preparePrompt(activityData) {
  let prompt = 'Please summarize my web browsing activities for today with descriptions and time spent on each:\n\n';
  for (const [domain, time] of Object.entries(activityData)) {
    const timeSpent = getReadableTime(time);
    const category = domainCategories[domain] || 'Other Activities';
    prompt += `- ${category} (${domain}): ${timeSpent}\n`;
  }
  return prompt;
}

function callGeminiAPI(prompt, callback) {
  const API_KEY = 'YOUR_API_KEY'; // Replace with your actual API key
  fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-exp-0827:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 1,
        topK: 64,
        topP: 0.95,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain"
      }
    })
  })
    .then(response => response.json())
    .then(data => {
      const summary = data.candidates[0].output;
      callback(summary);
    })
    .catch(error => console.error('Error:', error));
}
