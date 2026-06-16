const fs = require('fs');
let content = fs.readFileSync('src/pages/app/Reports.tsx', 'utf8');
content = content.replace(/34%, transparent/g, '64%, transparent');
content = content.replace(/35%, transparent/g, '65%, transparent');
fs.writeFileSync('src/pages/app/Reports.tsx', content);
console.log('Bumped Reports.tsx accents');
