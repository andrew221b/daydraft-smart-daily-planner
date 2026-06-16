const fs = require('fs');
const glob = require('glob'); // Need to install or just use find

const files = require('child_process').execSync('find src -name "*.tsx"').toString().trim().split('\n');

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    
    content = content.replace(/border-border\/([0-9]+)/g, (match, opStr) => {
        let op = parseInt(opStr, 10);
        let newOp = Math.min(100, op + 30); // Increase opacity by 30%
        changed = true;
        return `border-border/${newOp}`;
    });

    if (changed) {
        fs.writeFileSync(file, content);
    }
});
console.log('Done modifying border opacities.');
