const fs = require('fs');
let content = fs.readFileSync('src/components/app/ChecklistView.tsx', 'utf8');

if (!content.includes('autoFocusGroupId')) {
  content = content.replace(
    /const \[addingGroup, setAddingGroup\] = useState\(false\);/,
    'const [addingGroup, setAddingGroup] = useState(false);\n  const [autoFocusGroupId, setAutoFocusGroupId] = useState<string | null>(null);'
  );
  
  content = content.replace(
    /addGroup\(t\);\s+setGroupDraft\(""\);\s+requestAnimationFrame\(\(\) => \{\s+groupInputRef\.current\?\.focus\(\);\s+revealGroupInput\(\);\s+\}\);/g,
    `const created = addGroup(t);
    setGroupDraft("");
    setAddingGroup(false);
    if (created) {
      setAutoFocusGroupId(created.id);
    }`
  );
}

fs.writeFileSync('src/components/app/ChecklistView.tsx', content);
console.log('Fixed ChecklistView.tsx');
