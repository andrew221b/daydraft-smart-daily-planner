const fs = require('fs');
let content = fs.readFileSync('src/components/app/ChecklistView.tsx', 'utf8');

if (!content.includes('autoFocusAdd={autoFocusGroupId === g.id}')) {
  content = content.replace(
    /onAddItem=\{\(t, gid\) => addItem\(t, gid\)\}/g,
    'onAddItem={(t, gid) => addItem(t, gid)}\n            autoFocusAdd={autoFocusGroupId === g.id}'
  );
}

fs.writeFileSync('src/components/app/ChecklistView.tsx', content);
console.log('Added autoFocusAdd to ChecklistGroup in ChecklistView.tsx');
