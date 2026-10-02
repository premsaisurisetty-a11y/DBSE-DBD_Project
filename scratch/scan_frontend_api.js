const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../frontend/src');

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
      results.push(fullPath);
    }
  });
  return results;
}

const files = getFiles(srcDir);
const calls = [];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const relPath = path.relative(srcDir, file).replace(/\\/g, '/');
  
  lines.forEach((line, idx) => {
    // regex for api.get('/path'...) or api.post(`/path/...`...)
    const regex = /(api|axios)\.(get|post|put|delete|patch)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      calls.push({
        file: relPath,
        line: idx + 1,
        method: match[2].toUpperCase(),
        url: match[3],
        raw: line.trim()
      });
    }

    const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
    let fMatch;
    while ((fMatch = fetchRegex.exec(line)) !== null) {
      calls.push({
        file: relPath,
        line: idx + 1,
        method: 'FETCH',
        url: fMatch[1],
        raw: line.trim()
      });
    }
  });
});

console.log(JSON.stringify(calls, null, 2));
