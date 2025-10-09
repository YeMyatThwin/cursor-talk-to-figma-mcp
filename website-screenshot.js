import puppeteer from 'puppeteer';

async function takeWebsiteScreenshot(url, filename) {
  console.log(`📸 Taking screenshot of: ${url}`);
  
  try {
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('🌐 Loading page...');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    
    console.log('📸 Capturing screenshot...');
    await page.screenshot({ 
      path: filename, 
      fullPage: true,
      type: 'png'
    });
    
    await browser.close();
    console.log(`✅ Screenshot saved as: ${filename}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Take screenshot of the URL provided as argument
const url = process.argv[2] || 'https://www.figma.com';
const filename = `screenshots/${process.argv[3] || 'figma-screenshot.png'}`;

takeWebsiteScreenshot(url, filename);