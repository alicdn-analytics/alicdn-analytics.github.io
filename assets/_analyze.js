const fs = require('fs');
const code = fs.readFileSync('style-lib.min.js', 'utf8');

console.log('=== File Stats ===');
console.log('Size:', code.length, 'chars');
console.log('Lines:', code.split('\n').length);

// 1. Extract all hex-encoded strings and decode them
console.log('\n=== Hex-Encoded Strings (decoded) ===');
const hexStrings = new Set();
const hexPattern = /'(\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2})*)'/g;
let match;
while ((match = hexPattern.exec(code)) !== null) {
  try {
    const decoded = match[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (decoded.length > 1 && decoded.length < 200) {
      hexStrings.add(decoded);
    }
  } catch(e) {}
}
const sortedHex = [...hexStrings].sort();
console.log('Found', sortedHex.length, 'unique hex strings');
sortedHex.forEach(s => console.log('  ', JSON.stringify(s)));

// 2. Search for URLs and domains
console.log('\n=== URL/Domain Patterns ===');
const urlPatterns = [
  /https?:\/\/[^\s'")\]]+/gi,
  /wss?:\/\/[^\s'")\]]+/gi,
  /[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|cn|net|org|io|xyz|top|cc|tk|ml|ga|cf|pw|info|biz|ru|de|fr|jp|kr|in|br)/gi,
];
const urls = new Set();
for (const pat of urlPatterns) {
  let m;
  while ((m = pat.exec(code)) !== null) {
    urls.add(m[0]);
  }
}
[...urls].sort().forEach(u => console.log('  ', u));

// 3. Search for sensitive API usage
console.log('\n=== Sensitive API Calls ===');
const sensitiveApis = [
  'eval(', 'Function(', 'document.write', 'document.cookie',
  'localStorage', 'sessionStorage', 'navigator.', 'window.location',
  'XMLHttpRequest', 'fetch(', 'WebSocket', 'createElement("script',
  "createElement('script", '.src=', 'innerHTML', 'outerHTML',
  'atob(', 'btoa(', 'crypto.', 'indexedDB', 'postMessage',
  'addEventListener', 'onload', 'onerror', 'MutationObserver',
  'Proxy(', 'Reflect.', 'import(', 'require(',
  'process.env', '__dirname', 'globalThis',
  'clipboard', 'geolocation', 'mediaDevices', 'getUserMedia',
  'Notification', 'serviceWorker', 'BroadcastChannel',
];
for (const api of sensitiveApis) {
  const count = code.split(api).length - 1;
  if (count > 0) {
    console.log(`  ${api}: ${count} occurrences`);
  }
}

// 4. Try to extract the string array
console.log('\n=== String Array Extraction ===');
// Find function _0x1048 or similar array-returning function
const arrayFuncMatch = code.match(/function\s+(_0x[a-f0-9]+)\s*\(\)\s*\{[^{}]*?var\s+(_0x[a-f0-9]+)\s*=\s*(\[.*?\]);/s);
if (arrayFuncMatch) {
  console.log('Found array function:', arrayFuncMatch[1]);
  try {
    const arr = eval(arrayFuncMatch[3]);
    console.log('Array length:', arr.length);
    // Decode each entry
    const decoded = arr.map(s => {
      if (typeof s === 'string') {
        return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      return s;
    });
    // Show first 100 entries
    decoded.slice(0, 100).forEach((s, i) => {
      console.log(`  [${i}]: ${JSON.stringify(s)}`);
    });
    if (decoded.length > 100) {
      console.log(`  ... and ${decoded.length - 100} more entries`);
    }
    
    // Search for interesting strings in the full array
    console.log('\n=== Interesting Strings in Array ===');
    const interesting = decoded.filter(s => 
      typeof s === 'string' && (
        /https?:/.test(s) ||
        /\.com|\.cn|\.net|\.org|\.io/.test(s) ||
        /cookie|storage|navigator|location|fetch|xhr|websocket/i.test(s) ||
        /eval|function|script|document|window/i.test(s) ||
        /password|token|key|secret|auth|login|user/i.test(s) ||
        /send|post|get|request|response|header/i.test(s)
      )
    );
    interesting.forEach(s => console.log('  !', JSON.stringify(s)));
  } catch(e) {
    console.log('Eval error:', e.message);
  }
} else {
  console.log('Could not find string array function with simple pattern');
  // Try alternative: look for large array literals
  const bigArrayMatch = code.match(/\['(?:[^'\\]|\\.){1,}'(?:\s*,\s*'(?:[^'\\]|\\.){1,}')*\]/);
  if (bigArrayMatch) {
    console.log('Found large array literal, length:', bigArrayMatch[0].length);
  }
}

// 5. Check for known obfuscator signatures
console.log('\n=== Obfuscator Signature ===');
if (code.includes('_0x')) console.log('  - Uses _0x variable naming (javascript-obfuscator style)');
if (code.includes('SHDWCD') || code.includes('\\x53\\x48\\x44\\x57\\x43\\x44')) console.log('  - Has SHDWCD marker (Obfuscator.io signature)');
if (code.includes('rc4') || code.includes('RC4')) console.log('  - RC4 encryption detected');
if (code.includes('self-defending') || code.includes('selfDefending')) console.log('  - Self-defending mechanism detected');
if (code.includes('debug-protection') || code.includes('debugProtection')) console.log('  - Debug protection detected');
if (code.includes('console-output') || code.includes('consoleOutput')) console.log('  - Console output control detected');