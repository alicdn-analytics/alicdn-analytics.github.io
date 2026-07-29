const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('style-lib.min.js', 'utf8');
console.log('File size:', code.length);

// Find function boundaries using brace matching
function findFunctionEnd(code, startPos) {
  // Find the opening brace
  let bracePos = code.indexOf('{', startPos);
  if (bracePos === -1) return -1;
  
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;
  
  for (let i = bracePos; i < code.length; i++) {
    const ch = code[i];
    
    if (escaped) {
      escaped = false;
      continue;
    }
    
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    
    if (inString) {
      if (ch === stringChar) {
        inString = false;
      }
      continue;
    }
    
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }
    
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Extract _0x5b27 (decoder function) - starts at position 0
console.log('\n=== Extracting _0x5b27 (decoder) ===');
const decoderStart = code.indexOf('function _0x5b27');
if (decoderStart === -1) {
  console.log('ERROR: Could not find _0x5b27');
  process.exit(1);
}
const decoderEnd = findFunctionEnd(code, decoderStart);
console.log(`_0x5b27: ${decoderStart} to ${decoderEnd} (${decoderEnd - decoderStart} chars)`);
const decoderCode = code.substring(decoderStart, decoderEnd);

// Extract _0x1048 (string array) 
console.log('\n=== Extracting _0x1048 (string array) ===');
const arrayStart = code.indexOf('function _0x1048');
if (arrayStart === -1) {
  console.log('ERROR: Could not find _0x1048');
  process.exit(1);
}
const arrayEnd = findFunctionEnd(code, arrayStart);
console.log(`_0x1048: ${arrayStart} to ${arrayEnd} (${arrayEnd - arrayStart} chars)`);
const arrayCode = code.substring(arrayStart, arrayEnd);

// Check if there's a shuffle/IIFE between or after these functions
// Look for an IIFE that calls _0x5b27 or manipulates the array
console.log('\n=== Looking for shuffle/IIFE ===');
// The shuffle is typically right after the string array function
// It often looks like: (function(_0x..., _0x...){...}(_0x1048, 0x...));
const afterArray = code.substring(arrayEnd, arrayEnd + 5000);
const iifeMatch = afterArray.match(/^\s*\(function\s*\([^)]*\)\s*\{/);
let shuffleCode = '';
if (iifeMatch) {
  const iifeStart = arrayEnd + afterArray.indexOf(iifeMatch[0]);
  const iifeEnd = findFunctionEnd(code, iifeStart);
  // The IIFE includes the trailing invocation part like }(_0x1048, 0x123));
  // Find the closing );
  let invokeEnd = code.indexOf(';', iifeEnd);
  if (invokeEnd !== -1 && invokeEnd - iifeEnd < 200) {
    shuffleCode = code.substring(iifeStart, invokeEnd + 1);
    console.log(`Shuffle IIFE: ${iifeStart} to ${invokeEnd + 1} (${shuffleCode.length} chars)`);
  } else {
    console.log('Found IIFE but could not find invocation end');
  }
} else {
  console.log('No shuffle IIFE found immediately after array function');
  // Try looking before the decoder function or elsewhere
  // Sometimes the IIFE wraps everything
}

// Build the sandbox execution environment
console.log('\n=== Running decoder in sandbox ===');
const combinedCode = `
${arrayCode}
${decoderCode}
${shuffleCode}

// Export for access
this.__decoder = _0x5b27;
this.__arrayFn = _0x1048;
`;

const sandbox = {
  console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {} },
  setTimeout: () => {},
  setInterval: () => {},
  clearTimeout: () => {},
  clearInterval: () => {},
  atob: function(s) { return Buffer.from(s, 'base64').toString('binary'); },
  btoa: function(s) { return Buffer.from(s, 'binary').toString('base64'); },
  decodeURIComponent: decodeURIComponent,
  encodeURIComponent: encodeURIComponent,
  String: String,
  Array: Array,
  Object: Object,
  parseInt: parseInt,
  parseFloat: parseFloat,
  Number: Number,
  Math: Math,
  RegExp: RegExp,
  Date: Date,
  JSON: JSON,
  undefined: undefined,
  NaN: NaN,
  Infinity: Infinity,
  this: null,
};

try {
  const context = vm.createContext(sandbox);
  vm.runInContext(combinedCode, context, { timeout: 30000 });
  
  const decoder = sandbox.__decoder;
  const arrayFn = sandbox.__arrayFn;
  
  if (!decoder) {
    console.log('ERROR: Decoder not exported');
    process.exit(1);
  }
  
  console.log('Decoder extracted successfully!');
  
  // Get array length
  let arrLen = 0;
  try {
    const arr = arrayFn();
    arrLen = arr.length;
    console.log(`String array length: ${arrLen}`);
  } catch(e) {
    console.log('Could not get array length directly:', e.message);
  }
  
  // Decode all strings
  const decoded = [];
  const errors = [];
  
  // Try a wide range - the decoder applies an internal offset
  // so valid indices might not start at 0
  const maxIdx = Math.max(arrLen + 500, 20000);
  
  console.log(`\nDecoding strings (scanning 0 to ${maxIdx})...`);
  
  for (let i = 0; i < maxIdx; i++) {
    try {
      const result = decoder(i);
      if (typeof result === 'string' && result.length > 0 && result.length < 1000) {
        decoded.push({ idx: i, val: result });
      }
    } catch(e) {
      // Some indices may be invalid, skip
    }
  }
  
  console.log(`Successfully decoded ${decoded.length} strings\n`);
  
  // Write all decoded strings to file
  fs.writeFileSync('_decoded_all.txt', decoded.map(d => `[${d.idx}] ${d.val}`).join('\n'));
  console.log('All decoded strings written to _decoded_all.txt');
  
  // Analyze for security-relevant content
  console.log('\n========================================');
  console.log('=== SECURITY ANALYSIS OF DECODED STRINGS ===');
  console.log('========================================');
  
  // URLs
  console.log('\n--- URLs ---');
  const urls = decoded.filter(d => /https?:\/\//i.test(d.val) || /wss?:\/\//i.test(d.val));
  if (urls.length) urls.forEach(d => console.log(`  [${d.idx}] ${d.val}`));
  else console.log('  (none)');
  
  // Domains
  console.log('\n--- Domains ---');
  const domains = decoded.filter(d => /[a-z0-9][-a-z0-9]*\.(com|cn|net|org|io|xyz|top|cc|tk|ml|ga|cf|pw|info|biz|ru|de|fr|jp|kr|me|co|app|dev|site|online|tech|store|shop|click|link|track)/i.test(d.val) && !/https?:/.test(d.val));
  if (domains.length) domains.forEach(d => console.log(`  [${d.idx}] ${d.val}`));
  else console.log('  (none)');
  
  // Network APIs
  console.log('\n--- Network/API Patterns ---');
  const netApis = decoded.filter(d => /XMLHttpRequest|fetch\b|WebSocket|\.send\b|navigator\.sendBeacon|\/api\/|\/collect|\/track|\/beacon|\/pixel|\/report|\/log\b|\/event/i.test(d.val));
  if (netApis.length) netApis.forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  else console.log('  (none)');
  
  // Browser fingerprinting
  console.log('\n--- Fingerprinting/Privacy ---');
  const fp = decoded.filter(d => /userAgent|platform|language|screen|resolution|colorDepth|hardwareConcurrency|deviceMemory|webdriver|plugins|fonts|canvas|webgl|audioContext|timezone|referrer|cookie|localStorage|sessionStorage|indexedDB/i.test(d.val));
  if (fp.length) fp.forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  else console.log('  (none)');
  
  // DOM manipulation
  console.log('\n--- DOM Manipulation ---');
  const dom = decoded.filter(d => /createElement|innerHTML|outerHTML|document\.write|appendChild|insertBefore|removeChild|setAttribute|querySelector|getElementById|getElementsBy/i.test(d.val));
  if (dom.length) dom.forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  else console.log('  (none)');
  
  // Code execution
  console.log('\n--- Code Execution ---');
  const exec = decoded.filter(d => /\beval\b|\bFunction\b|setTimeout\s*\(|setInterval\s*\(|import\s*\(|require\s*\(|\.exec\b|\.call\b|\.apply\b/i.test(d.val));
  if (exec.length) exec.forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  else console.log('  (none)');
  
  // Crypto/encoding
  console.log('\n--- Crypto/Encoding ---');
  const crypto = decoded.filter(d => /crypto|subtle|digest|encrypt|decrypt|sign|verify|AES|RSA|SHA|MD5|HMAC|base64|atob|btoa|TextEncoder|TextDecoder/i.test(d.val));
  if (crypto.length) crypto.forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  else console.log('  (none)');
  
  // Suspicious keywords
  console.log('\n--- Suspicious Keywords ---');
  const suspicious = decoded.filter(d => /password|token|secret|key\b|auth|login|credential|phish|inject|exploit|payload|shell|cmd|exec|download|upload|exfil|steal|hack|malware|trojan|backdoor|keylog|clipboard/i.test(d.val));
  if (suspicious.length) suspicious.forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  else console.log('  (none)');
  
  // Performance/timing
  console.log('\n--- Performance/Timing ---');
  const perf = decoded.filter(d => /performance|timing|navigation|resource|paint|observer|MutationObserver|IntersectionObserver|ResizeObserver/i.test(d.val));
  if (perf.length) perf.forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  else console.log('  (none)');
  
  // Sample of readable strings
  console.log('\n--- Sample Readable Strings (non-gibberish, len>5) ---');
  const readable = decoded.filter(d => {
    if (d.val.length <= 5) return false;
    // Filter out base64-like and hex-like strings
    if (/^[A-Za-z0-9+/=]{10,}$/.test(d.val)) return false;
    if (/^[0-9a-f]{10,}$/i.test(d.val)) return false;
    // Must contain some readable characters
    const alphaRatio = d.val.replace(/[^a-zA-Z\s]/g, '').length / d.val.length;
    return alphaRatio > 0.3;
  });
  readable.slice(0, 80).forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
  if (readable.length > 80) console.log(`  ... and ${readable.length - 80} more`);
  
} catch(e) {
  console.log('ERROR:', e.message);
  console.log(e.stack);
}