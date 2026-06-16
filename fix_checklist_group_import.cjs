const fs = require('fs');
let content = fs.readFileSync('src/components/app/ChecklistGroup.tsx', 'utf8');

content = content.replace(
  'import { useRef, useState, type CSSProperties } from "react";',
  'import { useRef, useState, useEffect, type CSSProperties } from "react";'
);

fs.writeFileSync('src/components/app/ChecklistGroup.tsx', content);
console.log('Fixed imports');
