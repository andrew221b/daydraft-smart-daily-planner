const fs = require('fs');
let content = fs.readFileSync('src/index.css', 'utf8');
content = content.replace('--border: 227 20% 31%;', '--border: 227 20% 42%;');
content = content.replace('--border: 220 20% 80%;', '--border: 220 20% 65%;');
fs.writeFileSync('src/index.css', content);
console.log('Bumped index.css borders');
