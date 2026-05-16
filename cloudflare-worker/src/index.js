const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MAX_BODY_BYTES = 60000;
const MAX_ACTIVITIES = 200;

export default {
  async fetch(request, env) {
    const corsHeaders = getCorsHeaders(request, env);
    if (!corsHeaders) {
      return json({ error: 'Origin not allowed' }, 403);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    if (!env.DEEPSEEK_API_KEY) {
      return json({ error: 'DeepSeek API key is not configured' }, 500, corsHeaders);
    }

    const rateLimitResponse = await checkRateLimit(request, env, corsHeaders);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) {
      return json({ error: 'Request too large' }, 413, corsHeaders);
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    const activities = Array.isArray(body.activities) ? body.activities : [];
    if (activities.length === 0) {
      return json({ error: 'No activities provided' }, 400, corsHeaders);
    }

    const safeActivities = activities.slice(0, MAX_ACTIVITIES).map(sanitizeActivity);
    const prompt = buildPrompt(safeActivities);

    const deepseekResponse = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You generate clean professional timesheet summaries. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    let result;
    try {
      result = await deepseekResponse.json();
    } catch {
      return json({ error: 'Invalid response from DeepSeek' }, 502, corsHeaders);
    }

    if (!deepseekResponse.ok) {
      return json({
        error: result?.error?.message || 'DeepSeek request failed'
      }, deepseekResponse.status, corsHeaders);
    }

    const summary = result?.choices?.[0]?.message?.content;
    if (typeof summary !== 'string' || !summary.trim()) {
      return json({ error: 'Empty DeepSeek response' }, 502, corsHeaders);
    }

    return json({ summary }, 200, corsHeaders);
  }
};

async function checkRateLimit(request, env, corsHeaders) {
  if (!env.RATE_LIMITER) {
    return null;
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
  return success ? null : json({ error: 'Rate limit exceeded' }, 429, corsHeaders);
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = getAllowedOrigins(env);

  if (origin) {
    if (!allowedOrigins.some(allowedOrigin => isOriginAllowed(origin, allowedOrigin))) {
      return null;
    }

    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
  }

  if (env.ALLOW_NO_ORIGIN === 'true') {
    return {
      'Access-Control-Allow-Origin': allowedOrigins[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    };
  }

  return null;
}

function getAllowedOrigins(env) {
  if (env.ALLOWED_EXTENSION_ORIGINS) {
    return env.ALLOWED_EXTENSION_ORIGINS
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean);
  }

  return ['chrome-extension://'];
}

function isOriginAllowed(origin, allowedOrigin) {
  if (allowedOrigin.endsWith('://')) {
    return origin.startsWith(allowedOrigin);
  }

  return origin === allowedOrigin;
}

function sanitizeActivity(activity) {
  return {
    domain: truncate(activity?.domain, 120),
    title: truncate(activity?.title, 200),
    timeStamp: truncate(activity?.timeStamp, 80),
    date: truncate(activity?.date, 40),
    duration: truncate(activity?.duration, 40)
  };
}

function truncate(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
}

function buildPrompt(activities) {
  return `
Return only valid JSON in this exact shape:
{
  "dates": [
    {
      "date": "DD-MM-YYYY",
      "entries": [
        {
          "timeStamp": "9:00 AM",
          "description": "Professional timesheet description"
        }
      ]
    }
  ]
}

Rules:
- Group entries by date in the dates array.
- Use 12-hour time format with AM/PM for timeStamp.
- Keep descriptions professional, specific, and complete.
- Do not include markdown or text outside the JSON object.

Browsing activity:
${JSON.stringify(activities, null, 2)}
`;
}

function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
