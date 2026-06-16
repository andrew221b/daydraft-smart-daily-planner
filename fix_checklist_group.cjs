const fs = require('fs');
let content = fs.readFileSync('src/components/app/ChecklistGroup.tsx', 'utf8');

// Add useEffect to imports
if (!content.includes('useEffect')) {
  content = content.replace(
    /import \{ useRef, useState, type CSSProperties \} from "react";/,
    'import { useRef, useState, useEffect, type CSSProperties } from "react";'
  );
}

// Fix AddItemRow
content = content.replace(
  /export function AddItemRow\(\{[\s\S]*?const submit = \(\) => \{/m,
  `export function AddItemRow({
  onAdd,
  placeholder = "Add item…",
  autoFocus = false,
}: {
  onAdd: (title: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reveal = (delay = 0) => {
    window.setTimeout(() => {
      try {
        inputRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
      } catch {}
    }, delay);
  };

  useEffect(() => {
    if (autoFocus) {
      setTimeout(() => {
        inputRef.current?.focus();
        reveal();
      }, 50);
    }
  }, [autoFocus]);

  const submit = () => {`
);

fs.writeFileSync('src/components/app/ChecklistGroup.tsx', content);
console.log('Fixed ChecklistGroup.tsx');
