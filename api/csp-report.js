// CSP report endpoint - silences 404 errors in Vercel logs
// This endpoint accepts CSP violation reports and returns 200 OK
// without storing any data, as requested for static hosting on Vercel

export default function handler(req, res) {
  // Only accept POST requests for CSP reports
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return 200 OK with empty JSON to silence 404 errors
  // We do not store the report as requested
  res.status(200).json({});
}
