const fs = require('fs');
let content = fs.readFileSync('src/components/app/ChecklistGroup.tsx', 'utf8');

if (!content.includes('autoFocusAdd?: boolean;')) {
  // Add to ChecklistGroup props
  content = content.replace(
    /onToggleSelect,\n\}: \{/g,
    'onToggleSelect,\n  autoFocusAdd = false,\n}: {'
  );
  
  content = content.replace(
    /onToggleSelect: \(id: string\) => void;\n\}/g,
    'onToggleSelect: (id: string) => void;\n  autoFocusAdd?: boolean;\n}'
  );
  
  // Pass to AddItemRow
  content = content.replace(
    /<AddItemRow onAdd=\{\(t\) => onAddItem\(t, group\.id\)\} \/>/g,
    '<AddItemRow onAdd={(t) => onAddItem(t, group.id)} autoFocus={autoFocusAdd} />'
  );
}

fs.writeFileSync('src/components/app/ChecklistGroup.tsx', content);
console.log('Added autoFocusAdd to ChecklistGroup props');
