const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('style-lib.min.js', 'utf8');

// Find function boundaries using brace matching
function findFunctionEnd(code, startPos) {
  let bracePos = code.indexOf('{', startPos);
  if (bracePos === -1) return -1;
  let depth = 0, inString = false, stringChar = '', escaped = false;
  for (let i = bracePos; i < code.length; i++) {
    const ch = code[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inString) { if (ch === stringChar) inString = false; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inString = true; stringChar = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

// Extract functions
const decoderStart = code.indexOf('function _0x5b27');
const decoderEnd = findFunctionEnd(code, decoderStart);
const decoderCode = code.substring(decoderStart, decoderEnd);

const arrayStart = code.indexOf('function _0x1048');
const arrayEnd = findFunctionEnd(code, arrayStart);
const arrayCode = code.substring(arrayStart, arrayEnd);

console.log(`Decoder: ${decoderEnd - decoderStart} chars`);
console.log(`Array: ${arrayEnd - arrayStart} chars`);

// Calculate the offset from the decoder source
// Pattern: _0x4de231=_0x4de231-(EXPR)
const offsetMatch = decoderCode.match(/_0x4de231=_0x4de231-\(([^)]+)\)/);
let offset = 0;
if (offsetMatch) {
  try {
    offset = eval(offsetMatch[1]);
    console.log(`Calculated offset: ${offset}`);
  } catch(e) {
    console.log('Could not calculate offset:', e.message);
  }
}

// Build sandbox
const combinedCode = `
${arrayCode}
${decoderCode}
this.__decoder = _0x5b27;
this.__arrayFn = _0x1048;
`;

const sandbox = {
  console: { log: ()=>{}, error: ()=>{}, warn: ()=>{}, info: ()=>{} },
  setTimeout: ()=>{}, setInterval: ()=>{}, clearTimeout: ()=>{}, clearInterval: ()=>{},
  atob: function(s) { return Buffer.from(s, 'base64').toString('binary'); },
  btoa: function(s) { return Buffer.from(s, 'binary').toString('base64'); },
  decodeURIComponent, encodeURIComponent,
  String, Array, Object, parseInt, parseFloat, Number, Math, RegExp, Date, JSON,
  undefined, NaN, Infinity,
};

const context = vm.createContext(sandbox);
vm.runInContext(combinedCode, context, { timeout: 30000 });

const decoder = sandbox.__decoder;
const arrayFn = sandbox.__arrayFn;

const arrLen = arrayFn().length;
console.log(`Array length: ${arrLen}`);
console.log(`Offset: ${offset}`);
console.log(`Valid index range: ${offset} to ${offset + arrLen - 1}`);

// Decode with correct offset
const decoded = [];
for (let i = 0; i < arrLen; i++) {
  try {
    const result = decoder(i + offset);
    if (typeof result === 'string' && result.length > 0 && result.length < 2000) {
      decoded.push({ idx: i, raw_idx: i + offset, val: result });
    }
  } catch(e) {}
}

console.log(`\nDecoded ${decoded.length} strings\n`);

// Write all
fs.writeFileSync('_decoded_all.txt', decoded.map(d => `[${d.idx}] ${d.val}`).join('\n'));

// Security analysis
const categories = {
  'URLs': /https?:\/\/|wss?:\/\//i,
  'Domains': /[a-z0-9][-a-z0-9]*\.(com|cn|net|org|io|xyz|top|cc|tk|ml|ga|cf|pw|info|biz|ru|de|fr|jp|kr|me|co|app|dev|site|online|tech|store|shop|click|link|track)/i,
  'Network/API': /XMLHttpRequest|fetch\b|WebSocket|\.send\b|sendBeacon|\/api\/|\/collect|\/track|\/beacon|\/pixel|\/report|\/log\b|\/event|\/upload|\/download/i,
  'Fingerprinting': /userAgent|platform|language|screen|resolution|colorDepth|hardwareConcurrency|deviceMemory|webdriver|plugins|fonts|canvas|webgl|audioContext|timezone|referrer/i,
  'Storage/Cookies': /cookie|localStorage|sessionStorage|indexedDB/i,
  'DOM Manipulation': /createElement|innerHTML|outerHTML|document\.write|appendChild|insertBefore|setAttribute|querySelector|getElementById/i,
  'Code Execution': /\beval\b|\bFunction\b|setTimeout\s*\(|setInterval\s*\(|import\s*\(|require\s*\(/i,
  'Crypto': /crypto|subtle|digest|encrypt|decrypt|AES|RSA|SHA|HMAC|atob|btoa/i,
  'Suspicious': /password|token|secret|auth|login|credential|phish|inject|exploit|payload|shell|cmd|exec|exfil|steal|hack|malware|trojan|backdoor|keylog|clipboard/i,
  'Performance': /performance|timing|navigation|MutationObserver|IntersectionObserver/i,
  'Window/Location': /window\.location|location\.href|location\.assign|location\.replace|window\.open|window\.top|window\.parent|postMessage/i,
  'Script Loading': /\.src\s*=|createElement.*script|document\.write.*script|importScripts/i,
};

for (const [cat, pattern] of Object.entries(categories)) {
  const hits = decoded.filter(d => pattern.test(d.val));
  if (hits.length > 0) {
    console.log(`=== ${cat} (${hits.length} hits) ===`);
    hits.slice(0, 30).forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
    if (hits.length > 30) console.log(`  ... and ${hits.length - 30} more`);
    console.log();
  }
}

// Show readable strings sample
console.log('=== Readable Strings Sample (first 100 non-gibberish) ===');
const readable = decoded.filter(d => {
  if (d.val.length <= 3) return false;
  if (/^[A-Za-z0-9+/=]{8,}$/.test(d.val)) return false;
  const alphaRatio = d.val.replace(/[^a-zA-Z\s._\-]/g, '').length / d.val.length;
  return alphaRatio > 0.4;
});
readable.slice(0, 100).forEach(d => console.log(`  [${d.idx}] ${JSON.stringify(d.val)}`));
if (readable.length > 100) console.log(`  ... and ${readable.length - 100} more readable strings`);
console.log(`\nTotal readable: ${readable.length} / ${decoded.length}`);