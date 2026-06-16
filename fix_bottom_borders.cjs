const fs = require('fs');
let content = fs.readFileSync('src/index.css', 'utf8');

// For .app-card
content = content.replace(
  'border-top-color: rgba(255, 255, 255, 0.16);\n    border-bottom-color: rgba(0, 0, 0, 0.28);',
  'border-top-color: rgba(255, 255, 255, 0.16);'
);

// For .hero-glass
content = content.replace(
  'border-top-color: rgba(255, 255, 255, 0.22);\n    border-bottom-color: rgba(0, 0, 0, 0.32);',
  'border-top-color: rgba(255, 255, 255, 0.22);'
);

fs.writeFileSync('src/index.css', content);
console.log('Fixed bottom borders');
