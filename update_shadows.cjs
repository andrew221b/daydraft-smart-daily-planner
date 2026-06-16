const fs = require('fs');
let content = fs.readFileSync('src/index.css', 'utf8');

// Dark mode --shadow-card
content = content.replace(
  /--shadow-card: 0 1px 0 rgba\(255,255,255,0\.07\), 0 12px 42px -4px rgba\(0,0,0,0\.52\);/g,
  '--shadow-card: 0 1px 0 rgba(255,255,255,0.1), 0 16px 48px -4px rgba(0,0,0,0.7);'
);

// Light mode --shadow-card
content = content.replace(
  /--shadow-card: 0 1px 1\.5px rgba\(18,28,56,0\.06\), 0 4px 12px -2px rgba\(24,40,72,0\.10\), 0 16px 36px -10px rgba\(18,28,56,0\.16\);/g,
  '--shadow-card: 0 2px 4px rgba(18,28,56,0.08), 0 8px 24px -4px rgba(24,40,72,0.15), 0 24px 48px -12px rgba(18,28,56,0.25);'
);

fs.writeFileSync('src/index.css', content);
console.log('Updated index.css shadows');
