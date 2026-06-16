const fs = require('fs');
let content = fs.readFileSync('src/index.css', 'utf8');

content = content.replace(/hsl\(var\(--border\) \/ 0\.5\)/g, 'hsl(var(--border) / 0.7)');
content = content.replace(/hsl\(var\(--border\) \/ 0\.68\)/g, 'hsl(var(--border) / 0.9)');

fs.writeFileSync('src/index.css', content);
console.log('Updated index.css soft/strong borders');
