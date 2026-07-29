const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('style-lib.min.js', 'utf8');

// Strategy: Extract the self-contained decoder infrastructure and run it in a sandbox
// The obfuscated code typically has this structure:
// 1. _0x1048() returns the string array
// 2. _0x5b27(a, b) is the decoder that looks up and decodes strings
// 3. There's often a shuffle/IIFE that reorders the array on startup

// Extract everything up to the first real logic (the decoder setup)
// We need to find where the decoder functions end and the actual code begins

console.log('=== Attempting to extract and run decoder ===\n');

// Try to find the string array function and decoder
// Pattern: function _0x1048(){var ...=[...]; ... return ...}
// Then: function _0x5b27(a,b){...}
// Then possibly an IIFE that shuffles the array

// Let's try a different approach: create a mock environment and eval just enough
// to get the decoder working, then call it with various indices

const sandbox = {
  console: { log: () => {}, error: () => {}, warn: () => {} },
  setTimeout: () => {},
  setInterval: () => {},
  clearTimeout: () => {},
  clearInterval: () => {},
  atob: (typeof atob !== 'undefined') ? atob : function(s) { return Buffer.from(s, 'base64').toString('binary'); },
  decodeURIComponent: decodeURIComponent,
  String: String,
  Array: Array,
  Object: Object,
  parseInt: parseInt,
  Number: Number,
  Math: Math,
  RegExp: RegExp,
  undefined: undefined,
};

// Extract the first ~50KB which should contain the decoder infrastructure
const head = code.substring(0, 80000);

// Find where the main IIFE or module code starts (after decoder setup)
// Look for patterns like }(document,window) or similar entry points
let decoderCode = '';

// Try to extract just the decoder functions
// Method: find _0x1048 function, _0x5b27 function, and any shuffle IIFE
const funcStart = code.indexOf('function _0x1048');
if (funcStart === -1) {
  console.log('Could not find _0x1048 function');
  process.exit(1);
}

// Find the end of the decoder section by looking for the first major code block
// Usually after the decoder, there's either an IIFE or variable declarations
// Let's grab a generous chunk and try to run it
const chunkSize = 100000;
const decoderChunk = code.substring(funcStart, funcStart + chunkSize);

// Try to find a natural break point - look for semicolons followed by new patterns
// The decoder usually ends before the main logic starts
let breakPoint = -1;

// Look for common entry point patterns after the decoder
const entryPatterns = [
  /\}\s*\(this,\s*function/,
  /\}\s*\(\s*function\s*\(\s*_0x/,
  /;\s*var\s+_0x[a-f0-9]+\s*=\s*_0x5b27/,
  /;\s*\(function\s*\(\)\s*\{/,
];

for (const pat of entryPatterns) {
  const m = decoderChunk.match(pat);
  if (m && m.index > 1000) {
    // Found a potential break point
    const candidate = funcStart + m.index + m[0].indexOf(';');
    if (breakPoint === -1 || candidate < breakPoint) {
      breakPoint = candidate;
    }
  }
}

if (breakPoint === -1) {
  console.log('Could not find decoder boundary, trying fixed extraction...');
  // Fallback: try to extract just the two functions
  breakPoint = funcStart + 50000;
}

console.log(`Decoder section: ${funcStart} to ${breakPoint} (${breakPoint - funcStart} chars)`);

// Build a self-contained decoder module
const extractedCode = code.substring(funcStart, breakPoint);

// Wrap it so we can call the decoder
const wrappedCode = `
${extractedCode}

// Export the decoder
this.__decoder = typeof _0x5b27 !== 'undefined' ? _0x5b27 : null;
this.__arrayFn = typeof _0x1048 !== 'undefined' ? _0x1048 : null;
`;

try {
  const context = vm.createContext(sandbox);
  vm.runInContext(wrappedCode, context, { timeout: 10000 });
  
  const decoder = sandbox.__decoder;
  const arrayFn = sandbox.__arrayFn;
  
  if (!decoder) {
    console.log('ERROR: Could not extract decoder function');
    process.exit(1);
  }
  
  console.log('Decoder extracted successfully!\n');
  
  // Get the string array length
  let arrLen = 0;
  if (arrayFn) {
    try {
      const arr = arrayFn();
      arrLen = arr.length;
      console.log(`String array length: ${arrLen}`);
    } catch(e) {
      console.log('Could not get array length:', e.message);
    }
  }
  
  // Now decode ALL strings by calling the decoder with sequential indices
  // The decoder takes (index, offset) but typically the offset is computed internally
  // Let's try calling it with just sequential numbers
  
  const decodedStrings = [];
  const errors = [];
  
  // The actual indices used in the code are offset from the array start
  // The _0x5b27 function applies an offset: _0x4de231 = _0x4de231 - (some constant)
  // So we need to figure out the valid range
  
  // Try a wide range of indices
  const startIdx = 0;
  const endIdx = Math.min(arrLen || 20000, 20000);
  
  console.log(`Decoding strings from index ${startIdx} to ${endIdx}...\n`);
  
  for (let i = startIdx; i < endIdx; i++) {
    try {
      const result = decoder(i);
      if (typeof result === 'string' && result.length > 0 && result.length < 500) {
        decodedStrings.push({ index: i, value: result });
      }
    } catch(e) {
      // Skip invalid indices
    }
  }
  
  console.log(`Successfully decoded ${decodedStrings.length} strings\n`);
  
  // Now search for interesting patterns in decoded strings
  console.log('=== DECODED URLs and Domains ===');
  const urlPattern = /https?:\/\/[^\s'"<>\)]+|wss?:\/\/[^\s'"<>\)]+/;
  const domainPattern = /[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|cn|net|org|io|xyz|top|cc|tk|ml|ga|cf|pw|info|biz|ru|de|fr|jp|kr|in|br|me|co|app|dev|site|online|tech|store|shop|click|link|track|analytics|api|cdn)/i;
  
  const urls = decodedStrings.filter(s => urlPattern.test(s.value));
  const domains = decodedStrings.filter(s => domainPattern.test(s.value) && !urlPattern.test(s.value));
  
  if (urls.length > 0) {
    urls.forEach(s => console.log(`  [${s.index}] ${s.value}`));
  } else {
    console.log('  (none found)');
  }
  
  if (domains.length > 0) {
    console.log('\n  Domains:');
    domains.forEach(s => console.log(`  [${s.index}] ${s.value}`));
  }
  
  console.log('\n=== DECODED Sensitive APIs ===');
  const sensitivePatterns = [
    /cookie/i, /localStorage/i, /sessionStorage/i, /navigator/i,
    /location\.href/i, /location\.assign/i, /location\.replace/i,
    /eval\b/i, /Function\b/i, /document\.write/i, /innerHTML/i,
    /XMLHttpRequest/i, /fetch\b/i, /WebSocket/i, /\.send\b/i,
    /createElement\s*\(\s*['"]script/i, /\.src\s*=/i,
    /atob\b/i, /btoa\b/i, /crypto\b/i, /indexedDB/i,
    /postMessage/i, /addEventListener/i, /MutationObserver/i,
    /clipboard/i, /geolocation/i, /getUserMedia/i,
    /Notification/i, /serviceWorker/i, /BroadcastChannel/i,
    /password/i, /token/i, /secret/i, /auth/i, /login/i,
    /userAgent/i, /platform/i, /language/i, /screen/i,
    /referrer/i, /title\b/i, /hostname/i, /pathname/i,
    /performance\b/i, /timing\b/i, /beacon/i,
    /tracking/i, /analytics/i, /telemetry/i, /collect/i,
    /pixel/i, /impression/i, /click/i, /event/i,
  ];
  
  const sensitiveHits = [];
  for (const s of decodedStrings) {
    for (const pat of sensitivePatterns) {
      if (pat.test(s.value)) {
        sensitiveHits.push({ index: s.index, value: s.value, pattern: pat.source });
        break;
      }
    }
  }
  
  if (sensitiveHits.length > 0) {
    sensitiveHits.forEach(s => console.log(`  [${s.index}] (${s.pattern}) ${JSON.stringify(s.value)}`));
  } else {
    console.log('  (none found)');
  }
  
  console.log('\n=== DECODED Strings Containing Path/API Patterns ===');
  const pathPattern = /\/api\/|\/v\d+\/|\/collect|\/track|\/log|\/report|\/beacon|\/pixel|\/event|\/send|\/upload|\/submit/i;
  const paths = decodedStrings.filter(s => pathPattern.test(s.value));
  if (paths.length > 0) {
    paths.forEach(s => console.log(`  [${s.index}] ${JSON.stringify(s.value)}`));
  } else {
    console.log('  (none found)');
  }
  
  // Dump ALL decoded strings to a file for manual review
  const outFile = '_decoded_strings.txt';
  fs.writeFileSync(outFile, decodedStrings.map(s => `[${s.index}] ${s.value}`).join('\n'));
  console.log(`\nAll ${decodedStrings.length} decoded strings written to ${outFile}`);
  
  // Show some random samples to understand the nature of the strings
  console.log('\n=== Sample Decoded Strings (first 50 non-trivial) ===');
  const nonTrivial = decodedStrings.filter(s => s.value.length > 3 && !/^[A-Za-z0-9+/=]+$/.test(s.value));
  nonTrivial.slice(0, 50).forEach(s => console.log(`  [${s.index}] ${JSON.stringify(s.value)}`));
  
} catch(e) {
  console.log('ERROR running decoder:', e.message);
  console.log('Stack:', e.stack);
  
  // Fallback: try simpler extraction
  console.log('\n=== Fallback: Direct regex extraction of readable strings ===');
  
  // Extract all string literals that look like they could be meaningful
  const readablePattern = /'([a-zA-Z][a-zA-Z0-9_.\/:?=&@#%+\-]{4,200})'/g;
  const readable = new Set();
  let m;
  while ((m = readablePattern.exec(code)) !== null) {
    readable.add(m[1]);
  }
  
  console.log(`Found ${readable.size} potentially readable strings`);
  
  // Filter for interesting ones
  const interesting = [...readable].filter(s => 
    /http|www\.|\.com|\.cn|\.net|\.org|api|track|collect|cookie|storage|navigator|fetch|xhr|script|eval|function|document|window|location|send|post|get|request|response|header|token|key|secret|auth|login|user|password/i.test(s)
  );
  
  console.log(`Interesting strings: ${interesting.length}`);
  interesting.forEach(s => console.log(`  ${s}`));
}