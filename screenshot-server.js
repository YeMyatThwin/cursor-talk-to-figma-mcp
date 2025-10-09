import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3077;
const SCREENSHOTS_DIR = join(__dirname, 'screenshots');

// MIME types for common image formats
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

const server = createServer(async (req, res) => {
  // Add CORS headers to allow cross-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // Remove leading slash and decode URL
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = decodeURIComponent(filePath);

    // Security: prevent directory traversal
    if (filePath.includes('..') || filePath.includes('\\')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Build full path
    const fullPath = join(SCREENSHOTS_DIR, filePath);

    // Check if file exists
    const fileStat = await stat(fullPath);

    if (fileStat.isDirectory()) {
      // If it's a directory, serve a simple HTML listing
      const files = await readFile(join(SCREENSHOTS_DIR, 'index.html'), 'utf8').catch(() => null);
      if (files) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(files);
      } else {
        // Generate simple directory listing
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Screenshots</title></head>
          <body>
            <h1>Screenshots</h1>
            <ul>
              <li><a href="/apple-screenshot.png">Apple Screenshot</a></li>
              <li><a href="/figma-screenshot.png">Figma Screenshot</a></li>
              <li><a href="/test-screenshot.png">Test Screenshot</a></li>
            </ul>
          </body>
          </html>
        `);
      }
    } else {
      // Serve the file
      const ext = extname(fullPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      const fileContent = await readFile(fullPath);
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache'
      });
      res.end(fileContent);
    }
  } catch (error) {
    console.error('Error serving file:', error);
    res.writeHead(404);
    res.end('File not found');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Screenshots server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${SCREENSHOTS_DIR}`);
  console.log(`📸 Available screenshots:`);
  console.log(`   - http://localhost:${PORT}/apple-screenshot.png`);
  console.log(`   - http://localhost:${PORT}/figma-screenshot.png`);
  console.log(`   - http://localhost:${PORT}/test-screenshot.png`);
});