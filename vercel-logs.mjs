import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function main() {
  const scope = 'bookmarkforgeapp-5184';
  const project = 'bookmarkforge-core';
  const arg = process.argv[2];
  const since = /^\d{1,4}[smhdw]?$/.test(arg ?? '') ? arg : '30m'; // 30m, 1h, 24h

  console.log(`Fetching logs for ${project} (last ${since})...`);

  try {
    const { stdout } = await execFileAsync(
      'vercel',
      ['logs', '--scope', scope, '--project', project, '--since', since, '--json'],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const logs = JSON.parse(stdout);
    const entries = Array.isArray(logs) ? logs : [];

    console.log(`\nTotal entries: ${entries.length}`);

    // Group by status code
    const byStatus = {};
    const errors = [];
    const slowRequests = [];

    for (const entry of entries) {
      const status = entry.statusCode || 'N/A';
      byStatus[status] = (byStatus[status] || 0) + 1;

      if (status >= 400) {
        errors.push({
          path: entry.path,
          status,
          method: entry.method,
          timestamp: entry.timestamp,
        });
      }

      if (entry.duration && entry.duration > 1000) {
        slowRequests.push({
          path: entry.path,
          duration: entry.duration,
          status,
        });
      }
    }

    console.log('\n--- Status codes ---');
    Object.entries(byStatus)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`${status}: ${count}`);
      });

    if (errors.length > 0) {
      console.log(`\n--- Errors (${errors.length}) ---`);
      errors.slice(0, 20).forEach(e => {
        console.log(`${e.method} ${e.path} → ${e.status} (${e.timestamp})`);
      });
    }

    if (slowRequests.length > 0) {
      console.log(`\n--- Slow requests >1s (${slowRequests.length}) ---`);
      slowRequests.slice(0, 10).forEach(e => {
        console.log(`${e.path} → ${e.duration}ms (status ${e.status})`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.log('\nNote: Make sure you are logged in with: vercel login');
  }
}

main();
