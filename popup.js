document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ message: 'getActivityData' }, activityData => {
    console.log('Received activity data:', activityData); // Add this line
    const summary = generateSummary(activityData);
    document.getElementById('summary').innerText = summary;
  });
});

function generateSummary(activityData) {
  if (!activityData || Object.keys(activityData).length === 0) {
    return 'No browsing activity recorded for today.';
  }
  let summary = 'Your browsing activities for today:\n\n';
  for (const [domain, time] of Object.entries(activityData)) {
    const timeSpent = getReadableTime(time);
    const category = domainCategories[domain] || 'Other Activities';
    summary += `- Spent ${timeSpent} on ${category} (${domain}).\n`;
  }
  return summary;
}

function preparePrompt(activityData) {
  if (!activityData || Object.keys(activityData).length === 0) {
    return 'No browsing activity recorded for today.';
  }
  let prompt = 'Please summarize my web browsing activities for today with descriptions and time spent on each:\n\n';
  for (const [domain, time] of Object.entries(activityData)) {
    const timeSpent = getReadableTime(time);
    const category = domainCategories[domain] || 'Other Activities';
    prompt += `- ${category} (${domain}): ${timeSpent}\n`;
  }
  return prompt;
}

function pauseActiveTabTimer() {
  if (activeTabId !== null && activeTabStartTime !== null) {
    const timeSpent = Date.now() - activeTabStartTime;
    const currentTabId = activeTabId;
    const currentStartTime = activeTabStartTime;

    chrome.tabs.get(currentTabId, tab => {
      if (tab && tab.url) {
        const url = new URL(tab.url);
        const domain = url.hostname.replace('www.', '');
        if (!activityData[domain]) {
          activityData[domain] = 0;
        }
        activityData[domain] += timeSpent;
      } else {
        console.error('Tab or URL is undefined:', tab);
      }
    });
    activeTabStartTime = null;
  }
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
      console.log('API response:', data); // Add this line
      if (data && data.candidates && data.candidates.length > 0) {
        const summary = data.candidates[0].output;
        callback(summary);
      } else {
        console.error('Invalid response from API:', data);
        callback('Error: Could not generate summary.');
      }
    })
    .catch(error => {
      console.error('Error:', error);
      callback('Error: Could not generate summary.');
    });
}
