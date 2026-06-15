const { JSDOM } = require('jsdom');

// Extract meaningful text from HTML
function extractText(html, url) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Remove script, style, nav, footer, ads
    const remove = ['script', 'style', 'nav', 'footer', 'header', 'iframe', 'noscript', 'svg', 'img'];
    remove.forEach(tag => {
      doc.querySelectorAll(tag).forEach(el => el.remove());
    });

    // Get title
    const title = doc.querySelector('title')?.textContent?.trim() || '';

    // Get meta description
    const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';

    // Get headings
    const headings = [...doc.querySelectorAll('h1, h2, h3')]
      .map(h => h.textContent.trim())
      .filter(Boolean)
      .slice(0, 10)
      .join('\n');

    // Get main body text
    const body = doc.body?.textContent || '';
    const cleanBody = body
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    return `URL: ${url}
Title: ${title}
Meta description: ${metaDesc}
Headings: ${headings}
Content: ${cleanBody}`;
  } catch (err) {
    return null;
  }
}

// Detect if input is a URL
function isUrl(input) {
  const trimmed = input.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('www.');
}

// Fetch website content
async function fetchWebsite(url) {
  try {
    let fetchUrl = url.trim();
    if (fetchUrl.startsWith('www.')) fetchUrl = 'https://' + fetchUrl;

    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NoCap-AI/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    return extractText(html, fetchUrl);
  } catch (err) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { prompt, tool, input } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    let finalPrompt = prompt;

    // If it's the roast tool and the input looks like a URL, fetch the website
    if (tool === 'roast' && input && isUrl(input)) {
      const siteContent = await fetchWebsite(input);
      if (siteContent) {
        finalPrompt = `You are a brutally honest, witty business critic. Your job is to help entrepreneurs by telling them the hard truth about their business. 

I have fetched the actual content of their website. Roast it thoroughly based on what you ACTUALLY see on the page — the real copy, the real positioning, the real product, the real pricing. Be specific about what you find. Don't be generic. If the headline is weak, quote it and explain why. If the product is unclear, name what's unclear. Use bold section headers. End with a "Fix List" of exactly 5 specific things to change immediately.

Here is the actual website content:

${siteContent}`;
      } else {
        // URL fetch failed — tell the AI to roast based on the URL alone
        finalPrompt = prompt + `\n\nNote: I was unable to fetch the website content directly. Roast what you can infer from the URL and ask the user to paste their homepage text directly for a more specific roast.`;
      }
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'HTTP-Referer': 'https://nocap-dun.vercel.app',
        'X-Title': 'NoCap AI',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku',
        messages: [{ role: 'user', content: finalPrompt }],
        max_tokens: 1500,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Generation failed' });
    }

    return res.status(200).json({ text: data.choices[0].message.content });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
